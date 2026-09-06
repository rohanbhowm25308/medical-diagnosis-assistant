"""
authenticity.py
----------------
Heuristic "does this data look organically real or synthetically
generated" scorer.

IMPORTANT HONESTY NOTE: this can NEVER prove whether a CSV is "real" or
"fake" — that's not something statistics on the data alone can determine.
What it CAN do is flag patterns that are common in synthetically generated
/ demo / tutorial datasets (perfectly uniform distributions, equal-weight
random categories, gapless sequential IDs, poor Benford's Law fit) versus
patterns typical of organically collected real-world data. Treat the score
as a signal worth a second look, not a verdict.
"""

import numpy as np
import pandas as pd
from scipy import stats


MAX_SAMPLE_ROWS = 20000  # cap statistical tests so runtime never scales with file size
MAX_COLS_CHECKED = 12


def _leading_digits_vectorized(values):
    """Vectorized leading-digit extraction (avoids slow row-wise .apply()
    on large datasets)."""
    v = np.abs(values.astype(float))
    v = v[v > 0]
    if len(v) == 0:
        return np.array([])
    exponents = np.floor(np.log10(v))
    normalized = v / (10 ** exponents)
    digits = np.floor(normalized).astype(int)
    return np.clip(digits, 1, 9)  # guard against float rounding edge cases


def _benford_component(df, num_cols):
    """Real-world numeric data (populations, financial amounts, physical
    measurements) tends to loosely follow Benford's Law for leading digits.
    Purely synthetic/random data usually doesn't. Returns (score 0-1, detail) or None."""
    benford_expected = pd.Series({d: np.log10(1 + 1 / d) for d in range(1, 10)})
    best = None
    for col in num_cols[:MAX_COLS_CHECKED]:
        vals = df[col].dropna()
        if len(vals) > MAX_SAMPLE_ROWS:
            vals = vals.sample(MAX_SAMPLE_ROWS, random_state=42)
        if len(vals) < 200:
            continue
        digits = _leading_digits_vectorized(vals.to_numpy())
        if len(digits) < 200:
            continue
        observed = pd.Series(digits).value_counts(normalize=True).reindex(range(1, 10), fill_value=0)
        mad = float((observed - benford_expected).abs().mean())
        compliance = max(0.0, 1 - mad / 0.09)
        if best is None or mad < best[1]:
            best = (compliance, mad, col)
    if best is None:
        return None
    return {"score": best[0], "column": best[2], "mad": round(best[1], 4)}


def _uniformity_component(df, num_cols):
    """Synthetic demo data is often generated with np.random.uniform() or
    randint(), which is statistically indistinguishable from a true uniform
    distribution. Real-world measurements are almost never uniform."""
    suspicions = []
    checked_cols = []
    for col in num_cols[:MAX_COLS_CHECKED]:
        vals = df[col].dropna()
        if vals.nunique() < 20 or len(vals) < 100:
            continue
        if len(vals) > MAX_SAMPLE_ROWS:
            vals = vals.sample(MAX_SAMPLE_ROWS, random_state=42)
        lo, hi = vals.min(), vals.max()
        if hi - lo <= 0:
            continue
        _, p_value = stats.kstest(vals, "uniform", args=(lo, hi - lo))
        suspicions.append(p_value)
        checked_cols.append(col)
    if not suspicions:
        return None
    avg_p = float(np.mean(suspicions))
    score = max(0.0, 1 - avg_p)
    return {"score": score, "columns_checked": checked_cols, "avg_p_value": round(avg_p, 4)}


def _categorical_component(df, cat_cols):
    """Synthetic categorical data (np.random.choice with equal weights) tends
    to have near-equal category frequencies. Real-world categories almost
    always follow a skewed/Zipf-like distribution."""
    entropies = []
    checked_cols = []
    for col in cat_cols[:MAX_COLS_CHECKED]:
        vc = df[col].value_counts()
        k = len(vc)
        if k < 2 or k > 50:
            continue
        probs = vc / vc.sum()
        entropy = float(-(probs * np.log(probs)).sum())
        max_entropy = np.log(k)
        relative_entropy = entropy / max_entropy if max_entropy > 0 else 0
        entropies.append(relative_entropy)
        checked_cols.append(col)
    if not entropies:
        return None
    avg_rel_entropy = float(np.mean(entropies))
    score = max(0.0, 1 - avg_rel_entropy)
    return {"score": score, "columns_checked": checked_cols, "avg_relative_entropy": round(avg_rel_entropy, 3)}


def _sequential_id_component(df):
    """A column that's a perfectly gapless sequential integer range (very
    common in demo/tutorial datasets, less common in real-world exports
    which usually have gaps from deletions, filtering, sampling etc.)."""
    flagged = []
    for col in df.columns[:60]:  # bound cost on very wide datasets
        s = df[col].dropna()
        if not pd.api.types.is_integer_dtype(s) and not (
            pd.api.types.is_float_dtype(s) and (s == s.round()).all()
        ):
            continue
        if s.nunique() != len(s) or len(s) < 20:
            continue  # not a full-cardinality ID-like column
        sorted_vals = np.sort(s.astype(int).unique())
        is_sequential = np.array_equal(sorted_vals, np.arange(sorted_vals[0], sorted_vals[0] + len(sorted_vals)))
        if is_sequential:
            flagged.append(col)
    score = 0.4 if flagged else 1.0  # penalty, not disqualifying
    return {"score": score, "sequential_columns": flagged}


def compute_authenticity(df: pd.DataFrame) -> dict:
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    cat_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()

    components = {}
    weights = {}

    benford = _benford_component(df, num_cols)
    if benford:
        components["benford_law"] = benford
        weights["benford_law"] = 30

    uniformity = _uniformity_component(df, num_cols)
    if uniformity:
        components["numeric_distribution"] = uniformity
        weights["numeric_distribution"] = 30

    categorical = _categorical_component(df, cat_cols)
    if categorical:
        components["categorical_distribution"] = categorical
        weights["categorical_distribution"] = 20

    seq = _sequential_id_component(df)
    components["sequential_ids"] = seq
    weights["sequential_ids"] = 20

    total_weight = sum(weights.values())
    weighted_score = sum(components[k]["score"] * weights[k] for k in weights) / total_weight * 100

    if weighted_score >= 70:
        verdict = "Likely Real / Organic Data"
    elif weighted_score >= 45:
        verdict = "Mixed Signals"
    else:
        verdict = "Likely Synthetic / Generated Data"

    return {
        "authenticity_score": round(weighted_score, 1),
        "synthetic_likelihood": round(100 - weighted_score, 1),
        "verdict": verdict,
        "components": components,
    }