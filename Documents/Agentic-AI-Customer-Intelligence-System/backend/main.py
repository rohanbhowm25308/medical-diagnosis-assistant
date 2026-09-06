import io
import json
import random
from pathlib import Path
import numpy as np
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
from fpdf import FPDF

from agent import ask_agent
from authenticity import compute_authenticity
from state import STATE
import advanced
import documents
import document_intelligence
import auth

app = FastAPI(title="Agentic AI CSV Intelligence API")
app.include_router(advanced.router)
app.include_router(documents.router)
app.include_router(document_intelligence.router)
app.include_router(auth.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this to your frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_cache_headers(request, call_next):
    """Every /api/* response is always freshly computed from the current
    STATE — this just makes sure no browser/proxy ever serves a cached
    copy of an old dataset's results."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response


# Every /api/* route requires a logged-in session, except the auth routes
# themselves (you obviously can't require a login to reach the login
# endpoint). The frontend's login.html gate + index.html guard rely on this
# to actually keep the dashboard and its data locked behind sign-in.
PUBLIC_API_PATHS = {"/api/login", "/api/login/google", "/api/logout", "/api/session", "/api/config"}


@app.middleware("http")
async def require_login(request, call_next):
    if request.url.path.startswith("/api/") and request.url.path not in PUBLIC_API_PATHS:
        if not auth.is_authenticated(request):
            return JSONResponse(status_code=401, content={"detail": "Not authenticated. Please log in."})
    return await call_next(request)


class ChatRequest(BaseModel):
    question: str


def _require_df():
    if STATE["clean_df"] is None:
        raise HTTPException(status_code=400, detail="No dataset uploaded yet.")
    return STATE["clean_df"]


def _smart_read_csv(contents: bytes, max_rows: int = None) -> pd.DataFrame:
    """Real-world 'CSV' files are inconsistent: some use semicolons (common
    in European-locale exports like the Customer Personality Analysis
    dataset), some use tabs, some aren't UTF-8. Instead of assuming comma +
    UTF-8 and silently mis-parsing everything into one garbage column, we
    detect the actual delimiter/encoding on a small SAMPLE first (cheap,
    constant-time regardless of file size), then do exactly ONE full parse
    with the winning settings — so this stays fast even on large files.

    If max_rows is set, the final parse is capped at that many rows — used
    for very large files on memory-constrained hosts (e.g. Render's free
    512MB tier), where loading the entire file could crash the process."""
    encodings_to_try = ["utf-8", "latin-1", "cp1252"]
    candidate_delimiters = [",", ";", "\t", "|"]
    SAMPLE_BYTES = 200_000  # enough for header + ~few hundred rows, independent of file size

    sample = contents[:SAMPLE_BYTES]
    best_combo = None
    best_score = -1

    for encoding in encodings_to_try:
        try:
            text_sample = sample.decode(encoding, errors="strict")
        except (UnicodeDecodeError, LookupError):
            continue

        first_line = text_sample.split("\n", 1)[0]
        for delim in candidate_delimiters:
            if first_line.count(delim) == 0:
                continue
            try:
                df_try = pd.read_csv(io.StringIO(text_sample), sep=delim, nrows=100)
            except Exception:
                continue

            score = df_try.shape[1] - df_try.isna().all().sum()
            if df_try.shape[1] > 1 and score > best_score:
                best_score = score
                best_combo = (encoding, delim)

        if best_combo and best_combo[0] == encoding:
            break  # found a working delimiter with this encoding, no need to try others

    if best_combo:
        encoding, delim = best_combo
        return pd.read_csv(io.BytesIO(contents), sep=delim, encoding=encoding, nrows=max_rows)

    # Nothing matched cleanly — fall back to pandas' own sniffing, then plain default
    try:
        return pd.read_csv(io.BytesIO(contents), sep=None, engine="python", nrows=max_rows)
    except Exception:
        return pd.read_csv(io.BytesIO(contents), nrows=max_rows)


@app.post("/api/upload")
async def upload_csv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")

    # Stream-read with an early cutoff instead of `await file.read()` for the
    # whole thing — on a memory-constrained host (e.g. Render's free 512MB
    # tier), fully loading a huge file before deciding to sample would still
    # risk an OOM crash. Reading in bounded chunks means we never hold more
    # than MAX_BYTES_TO_READ in memory, no matter how large the real file is.
    MAX_BYTES_TO_READ = 20 * 1024 * 1024  # 20MB safety cap
    CHUNK_SIZE = 1024 * 1024  # 1MB at a time

    chunks = []
    total_read = 0
    truncated = False
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        chunks.append(chunk)
        total_read += len(chunk)
        if total_read >= MAX_BYTES_TO_READ:
            truncated = True
            break

    contents = b"".join(chunks)
    was_sampled = truncated

    if truncated:
        # Trim back to the last complete line so pandas doesn't choke on a
        # broken final row cut off mid-line by the byte cutoff.
        last_newline = contents.rfind(b"\n")
        if last_newline != -1:
            contents = contents[: last_newline + 1]

    try:
        df = _smart_read_csv(contents)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

    if df.shape[1] < 2:
        raise HTTPException(
            status_code=400,
            detail="This file only parsed into 1 column — it may use an unusual delimiter or format. Please check the file.",
        )

    STATE["raw_df"] = df
    STATE["clean_df"] = None
    STATE["filename"] = file.filename
    STATE["chat_history"] = []  # new dataset -> old conversation no longer makes sense
    STATE["outlier_row_indices"] = []
    # New dataset invalidates any previously trained models/insights.
    STATE["last_ml_result"] = None
    STATE["trained_rf"] = None
    STATE["trained_kmeans"] = None
    STATE["rf_feature_cols"] = []
    STATE["kmeans_feature_cols"] = []
    STATE["label_encoders"] = {}
    STATE["feature_defaults"] = {}
    STATE["target_col"] = None
    STATE["target_was_binned"] = False
    STATE["cluster_profiles"] = []
    # A CSV upload replaces any previously uploaded PDF/DOCX document.
    STATE["document_text"] = None
    STATE["document_paragraphs"] = []
    STATE["document_filename"] = None
    STATE["document_kind"] = None
    STATE["document_chat_history"] = []
    STATE["document_ocr_used"] = False
    STATE["document_ocr_confidence"] = None
    STATE["document_unit_count"] = 0
    STATE["compare_document_text"] = None
    STATE["compare_document_filename"] = None

    preview = df.head(10).replace({np.nan: None}).to_dict(orient="records")

    return {
        "filename": file.filename,
        "size_kb": round(len(contents) / 1024, 1) if not was_sampled else None,
        "rows": int(df.shape[0]),
        "columns": int(df.shape[1]),
        "missing_values": int(df.isna().sum().sum()),
        "duplicate_rows": int(df.duplicated().sum()),
        "preview": preview,
        "column_names": list(df.columns),
        "was_sampled": was_sampled,
        "sample_note": (
            f"This file is larger than {MAX_BYTES_TO_READ // (1024*1024)}MB — only the first "
            f"~{df.shape[0]:,} rows were loaded to stay within server memory limits. "
            "Results below reflect this sample, not the full file."
            if was_sampled else None
        ),
    }


@app.post("/api/clean")
async def clean_dataset():
    """Runs the visible 'data cleaning pipeline' steps and returns step-by-step
    results so the frontend can animate each card."""
    if STATE["raw_df"] is None:
        raise HTTPException(status_code=400, detail="No dataset uploaded yet.")

    df = STATE["raw_df"].copy()
    steps = {}

    steps["dataset_uploaded"] = {"status": "done", "detail": STATE["filename"]}

    missing_before = int(df.isna().sum().sum())
    for col in df.columns:
        if df[col].dtype.kind in "biufc":  # numeric
            df[col] = df[col].fillna(df[col].median())
        else:
            mode = df[col].mode(dropna=True)
            df[col] = df[col].fillna(mode.iloc[0] if not mode.empty else "Unknown")
    steps["missing_values"] = {"status": "done", "detail": f"{missing_before} filled"}

    dup_before = int(df.duplicated().sum())
    df = df.drop_duplicates().reset_index(drop=True)
    steps["duplicate_check"] = {"status": "done", "detail": f"{dup_before} removed"}

    outlier_count = 0
    outlier_row_indices = set()
    for col in df.select_dtypes(include=[np.number]).columns:
        # Skip binary/low-cardinality numeric columns (flags, small-int
        # categories, rare-event labels like a fraud "Class" column). IQR
        # clipping treats them as continuous measurements and can silently
        # wipe out a legitimate minority class (e.g. clipping every "1" in
        # a 99.8%-zeros fraud flag down to 0) — clipping only makes sense
        # for genuinely continuous values.
        if df[col].nunique() <= 10:
            continue
        q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        mask = (df[col] < lower) | (df[col] > upper)
        outlier_count += int(mask.sum())
        outlier_row_indices.update(df.index[mask].tolist())
        df[col] = df[col].clip(lower, upper)
    steps["outlier_detection"] = {"status": "done", "detail": f"{outlier_count} capped"}
    STATE["outlier_row_indices"] = sorted(outlier_row_indices)[:200]  # cap for memory

    cat_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()
    steps["feature_engineering"] = {
        "status": "done",
        "detail": f"{len(cat_cols)} categorical columns identified",
    }

    STATE["clean_df"] = df
    steps["data_ready"] = {"status": "done", "detail": "Dataset ready for analysis"}

    return {"steps": steps, "rows": int(df.shape[0]), "columns": int(df.shape[1])}


def _compute_ml_analysis(df: pd.DataFrame) -> dict:
    """Quick unsupervised (always runs) + supervised ML. Shared by /api/analyze
    and /api/report so both always show the same numbers."""
    numeric_df = df.select_dtypes(include=[np.number])

    result = {
        "kmeans": {"status": "skipped", "clusters": 0},
        "decision_tree": {"status": "skipped", "accuracy": 0},
        "random_forest": {"status": "skipped", "accuracy": 0},
        "best_model": "None",
        "best_accuracy": 0,
        "customer_segments": 0,
        "high_value_count": 0,
        "avg_primary_metric": 0,
        "correlation": None,
        "feature_importance": [],
    }

    # --- Correlation matrix (capped columns so a very wide dataset doesn't
    # produce an unreadable/huge heatmap or slow pandas .corr() call) ---
    MAX_CORR_COLUMNS = 12
    corr_cols = numeric_df.columns[:MAX_CORR_COLUMNS].tolist()
    if len(corr_cols) >= 2:
        corr_matrix = numeric_df[corr_cols].corr().fillna(0).round(3)
        result["correlation"] = {
            "columns": corr_cols,
            "matrix": corr_matrix.values.tolist(),
        }

    # --- Unsupervised clustering (works on any numeric data) ---
    # k is chosen via silhouette score on a SAMPLE, not the full dataset —
    # silhouette_score is O(n^2), so running it on a 280k-row dataset can
    # take hours. We search for the best k on a bounded sample (fast), then
    # do exactly one final KMeans fit on the full data to label every row.
    SEARCH_SAMPLE_SIZE = 10000
    SILHOUETTE_SAMPLE_SIZE = 1500

    if numeric_df.shape[1] >= 1 and numeric_df.shape[0] >= 5:
        X = numeric_df.fillna(numeric_df.median())
        n_rows = X.shape[0]
        max_k = min(5, n_rows - 1)

        X_search = X.sample(SEARCH_SAMPLE_SIZE, random_state=42) if n_rows > SEARCH_SAMPLE_SIZE else X

        best_k, best_score = 2, -1
        for k in range(2, max_k + 1):
            km_try = KMeans(n_clusters=k, n_init=5, random_state=42)
            labels_try = km_try.fit_predict(X_search)
            if len(set(labels_try)) < 2:
                continue
            score = silhouette_score(
                X_search, labels_try,
                sample_size=min(SILHOUETTE_SAMPLE_SIZE, len(X_search)),
                random_state=42,
            )
            if score > best_score:
                best_k, best_score = k, score

        # One real fit on the full dataset with the winning k
        km_final = KMeans(n_clusters=best_k, n_init=10, random_state=42)
        labels = km_final.fit_predict(X)

        result["kmeans"] = {"status": "done", "clusters": int(best_k), "silhouette": round(float(best_score), 3)}
        result["customer_segments"] = int(best_k)

        cluster_means = pd.DataFrame(X).assign(_c=labels).groupby("_c").mean()
        top_cluster = cluster_means.mean(axis=1).idxmax()
        result["high_value_count"] = int((labels == top_cluster).sum())
        result["avg_primary_metric"] = round(float(numeric_df.iloc[:, 0].mean()), 2)

        # --- Persist the fitted model + per-cluster profiles for the What-If
        # Simulator and Persona Generator (advanced.py) so they can reuse this
        # exact clustering instead of retraining from scratch on every call. ---
        STATE["trained_kmeans"] = km_final
        STATE["kmeans_feature_cols"] = list(X.columns)
        for col in X.columns:
            STATE["feature_defaults"][col] = float(X[col].median())

        overall_mean_score = cluster_means.mean(axis=1)
        ranked_clusters = overall_mean_score.sort_values(ascending=False).index.tolist()
        cluster_tier_names = ["Premium", "High-Value", "Standard", "Occasional", "At-Risk"]
        profiles = []
        for rank, c in enumerate(ranked_clusters):
            member_mask = labels == c
            member_count = int(member_mask.sum())
            tier = cluster_tier_names[rank] if rank < len(cluster_tier_names) else f"Segment {rank+1}"
            # representative real row = the member closest to this cluster's centroid
            centroid = km_final.cluster_centers_[c]
            member_idx = np.where(member_mask)[0]
            dists = np.linalg.norm(X.iloc[member_idx].values - centroid, axis=1)
            rep_pos = member_idx[int(np.argmin(dists))] if len(member_idx) else None
            rep_row = df.iloc[rep_pos].replace({np.nan: None}).to_dict() if rep_pos is not None else {}
            profiles.append({
                "cluster_id": int(c),
                "tier": tier,
                "size": member_count,
                "pct_of_total": round(member_count / len(labels) * 100, 1),
                "feature_means": {col: round(float(v), 2) for col, v in cluster_means.loc[c].items()},
                "representative_row": rep_row,
            })
        STATE["cluster_profiles"] = profiles

    # --- Supervised models: scan ALL columns for a sensible classification
    # target instead of blindly assuming the LAST column is the label —
    # that assumption breaks completely on datasets where the last column
    # is a date, free-text, or ID field rather than an actual label. ---
    # For very large datasets, train on a capped sample — Decision
    # Tree/Random Forest accuracy plateaus well before using millions of
    # rows, and this keeps response times reasonable regardless of file size.
    TRAINING_SAMPLE_CAP = 15000
    MAX_FEATURE_CARDINALITY = 50  # columns with more unique values than this are
    # almost always free text/IDs, not real categorical features — including
    # them via LabelEncoder would turn arbitrary text into meaningless integer
    # codes that pollute feature importance and waste training time.

    def _is_id_like(series: pd.Series) -> bool:
        return series.nunique() == len(series)

    def _looks_like_free_text(series: pd.Series) -> bool:
        """A column with only a handful of unique values could still be
        free text (e.g. a small set of canned long responses) rather than
        a real category label. Real labels ('Positive', 'Male', 'Yes') are
        short; sentences aren't."""
        if series.dtype.kind not in "OU":
            return False
        sample = series.dropna().astype(str).head(200)
        if len(sample) == 0:
            return False
        return sample.str.len().mean() > 25

    MIN_SAMPLES_PER_CLASS = 4  # below this, a train/test split can easily put
    # a class into the test set that the model never saw during training —
    # guaranteeing wrong predictions and a misleading near-0% accuracy that
    # looks broken rather than "not enough data".

    def _pick_target_column(frame: pd.DataFrame):
        """Prefer a column that's already a clean label (2-10 unique values,
        not an ID, not disguised free text) AND has enough examples per
        class to actually be trainable. Falls back to binning a numeric
        column if no categorical candidate qualifies."""
        categorical_candidates = [
            c for c in reversed(frame.columns)
            if 2 <= frame[c].nunique() <= 10
            and not _is_id_like(frame[c])
            and not _looks_like_free_text(frame[c])
        ]
        # Among valid candidates, prefer the one with the best samples-per-class
        # ratio (most trainable), not just whichever appears last in the frame.
        viable = [
            c for c in categorical_candidates
            if len(frame) / frame[c].nunique() >= MIN_SAMPLES_PER_CLASS
        ]
        if viable:
            best = max(viable, key=lambda c: len(frame) / frame[c].nunique())
            return best, False
        if categorical_candidates:
            # Nothing meets the bar, but remember the best near-miss so we
            # can explain *why* it was skipped instead of failing silently.
            best = max(categorical_candidates, key=lambda c: len(frame) / frame[c].nunique())
            return best, False, "too_few_per_class"

        numeric_candidates = [
            c for c in reversed(frame.select_dtypes(include=[np.number]).columns)
            if not _is_id_like(frame[c]) and frame[c].nunique() >= 10
        ]
        if numeric_candidates:
            return numeric_candidates[0], True

        return None, False

    pick_result = _pick_target_column(df)
    target_col, target_is_binned = pick_result[0], pick_result[1]
    near_miss_reason = pick_result[2] if len(pick_result) > 2 else None

    result["ml_skip_reason"] = None

    if df.shape[0] < 20:
        result["ml_skip_reason"] = (
            f"Only {df.shape[0]} rows — need at least 20 for any classifier training. "
            "Clustering above still works since it doesn't need labeled examples."
        )
    elif target_col is None:
        result["ml_skip_reason"] = (
            "No column looks like a usable classification target (something with "
            "2-10 categories). This dataset may be better suited to clustering only."
        )
    elif near_miss_reason == "too_few_per_class":
        avg_per_class = round(df.shape[0] / df[target_col].nunique(), 1)
        result["ml_skip_reason"] = (
            f"Closest possible target ('{target_col}') only has ~{avg_per_class} examples "
            f"per category — too few to reliably train/test (need ~{MIN_SAMPLES_PER_CLASS}+). "
            "Try a larger dataset or one with a clearer, more common label column."
        )
        target_col = None  # don't attempt training on it

    if target_col is not None and df.shape[0] >= 20:
        work_df = df.sample(TRAINING_SAMPLE_CAP, random_state=42) if df.shape[0] > TRAINING_SAMPLE_CAP else df.copy()

        if target_is_binned:
            work_df[target_col] = pd.qcut(
                work_df[target_col], q=3, labels=["Low", "Medium", "High"], duplicates="drop"
            )

        if work_df[target_col].nunique() <= 10:
            excluded_columns = []
            feature_cols = []
            fitted_encoders = {}
            for col in work_df.columns:
                if col == target_col:
                    continue
                if _is_id_like(work_df[col]):
                    excluded_columns.append(col)  # ID columns have no real predictive meaning
                    continue
                if work_df[col].dtype.kind not in "biufc":  # non-numeric
                    if work_df[col].nunique() > MAX_FEATURE_CARDINALITY:
                        excluded_columns.append(col)
                        continue
                    le = LabelEncoder()
                    work_df[col] = le.fit_transform(work_df[col].astype(str))
                    fitted_encoders[col] = le
                feature_cols.append(col)

            X = work_df[feature_cols]
            y = work_df[target_col].astype(str)

            # Stratify keeps class proportions consistent between train/test —
            # critical for small/imbalanced data. Falls back to a plain split
            # if any class has too few members for stratification to work.
            class_counts = y.value_counts()
            can_stratify = (class_counts >= 2).all()

            if X.shape[1] >= 1:
                X_train, X_test, y_train, y_test = train_test_split(
                    X, y, test_size=0.25, random_state=42,
                    stratify=y if can_stratify else None,
                )

                dt = DecisionTreeClassifier(max_depth=6, random_state=42)
                dt.fit(X_train, y_train)
                dt_acc = accuracy_score(y_test, dt.predict(X_test))
                result["decision_tree"] = {"status": "done", "accuracy": round(dt_acc * 100, 1)}

                rf = RandomForestClassifier(n_estimators=30, max_depth=8, random_state=42, n_jobs=-1)
                rf.fit(X_train, y_train)
                rf_acc = accuracy_score(y_test, rf.predict(X_test))
                result["random_forest"] = {"status": "done", "accuracy": round(rf_acc * 100, 1)}

                # Feature importance: which columns actually drove the prediction
                importances = sorted(
                    zip(X.columns, rf.feature_importances_.tolist()),
                    key=lambda x: x[1],
                    reverse=True,
                )
                result["feature_importance"] = [
                    {"feature": f, "importance": round(v, 4)} for f, v in importances[:10]
                ]

                if rf_acc >= dt_acc:
                    result["best_model"] = "Random Forest"
                    result["best_accuracy"] = result["random_forest"]["accuracy"]
                else:
                    result["best_model"] = "Decision Tree"
                    result["best_accuracy"] = result["decision_tree"]["accuracy"]

                result["target_column"] = target_col
                result["target_was_binned"] = target_is_binned
                result["training_rows_used"] = int(len(X_train) + len(X_test))
                result["excluded_columns"] = excluded_columns

                # --- Persist for the What-If Simulator (advanced.py) ---
                STATE["trained_rf"] = rf
                STATE["rf_feature_cols"] = feature_cols
                STATE["label_encoders"] = fitted_encoders
                STATE["target_col"] = target_col
                STATE["target_was_binned"] = target_is_binned
                for col in feature_cols:
                    if col in fitted_encoders:
                        STATE["feature_defaults"][col] = float(X[col].mode(dropna=True).iloc[0]) if not X[col].mode(dropna=True).empty else 0.0
                    else:
                        STATE["feature_defaults"][col] = float(X[col].median())

    if result["best_model"] == "None" and result["kmeans"]["status"] == "done":
        result["best_model"] = "K-Means Clustering"
        result["best_accuracy"] = 100.0

    result["dataset_rows"] = int(df.shape[0])
    STATE["last_ml_result"] = result
    return result


@app.post("/api/analyze")
async def analyze_dataset():
    df = _require_df()
    return _compute_ml_analysis(df)


@app.get("/api/authenticity")
async def authenticity_check():
    """Heuristic check for whether the uploaded CSV looks like organic
    real-world data or synthetically generated/demo data. Runs on the RAW
    upload (before cleaning), since operations like outlier-clipping would
    distort the statistical patterns this looks for."""
    if STATE["raw_df"] is None:
        raise HTTPException(status_code=400, detail="No dataset uploaded yet.")
    return compute_authenticity(STATE["raw_df"])


def _pick_categorical_column(df, cat_cols, exclude=None):
    """Prefer a column that actually looks categorical (a handful of
    repeated values) over an ID-like column where every value is unique —
    those make useless pie/bar charts even though they're technically
    non-numeric."""
    candidates = [c for c in cat_cols if c != exclude]
    if not candidates:
        return None
    good = [c for c in candidates if 2 <= df[c].nunique() <= 20]
    return good[0] if good else candidates[0]


@app.get("/api/chart-data")
async def chart_data():
    df = _require_df()

    cat_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()

    pie = {}
    bar = {}

    # --- PIE: prefer a categorical column's value counts. If the dataset
    # has no categorical columns at all (pure numeric), fall back to
    # binning the first numeric column into quartile ranges so pie always
    # has something meaningful to show. ---
    pie_col = _pick_categorical_column(df, cat_cols)
    if pie_col:
        vc = df[pie_col].value_counts().head(6)
        pie = {"label": pie_col, "data": {str(k): int(v) for k, v in vc.items()}}
    elif num_cols:
        col = num_cols[0]
        try:
            binned = pd.qcut(df[col], q=4, duplicates="drop")
        except (ValueError, IndexError):
            binned = pd.cut(df[col].dropna(), bins=min(4, df[col].nunique()) or 1)
        vc = binned.value_counts().sort_index()
        pie = {"label": f"{col} (ranges)", "data": {str(k): int(v) for k, v in vc.items()}}

    # --- BAR: prefer a numeric column's histogram. Use a different column
    # than pie's when there's a choice, so the two charts don't just
    # duplicate each other. If there are no numeric columns at all (pure
    # categorical dataset), fall back to a categorical value-count bar. ---
    if num_cols:
        if not cat_cols and len(num_cols) > 1:
            col = num_cols[1]  # pie already used num_cols[0] above
        else:
            col = num_cols[0]
        counts, bins = np.histogram(df[col].dropna(), bins=8)
        bar = {
            "label": col,
            "bins": [f"{round(bins[i],1)}-{round(bins[i+1],1)}" for i in range(len(bins) - 1)],
            "counts": counts.tolist(),
        }
    else:
        bar_col = _pick_categorical_column(df, cat_cols, exclude=pie_col)
        if bar_col:
            vc = df[bar_col].value_counts().head(10)
            bar = {"label": bar_col, "bins": [str(x) for x in vc.index], "counts": vc.values.tolist()}

    return {"pie": pie, "bar": bar}


MAX_HISTORY_TURNS = 6  # keep last N exchanges so the prompt doesn't grow unbounded


@app.post("/api/chat")
async def chat(req: ChatRequest):
    df = _require_df()
    result = ask_agent(df, req.question, prior_history=STATE["chat_history"])

    STATE["chat_history"].append({"role": "user", "content": req.question})
    STATE["chat_history"].append({"role": "assistant", "content": result["answer"]})
    # Cap history length (2 messages per turn) so long sessions don't blow up the prompt
    STATE["chat_history"] = STATE["chat_history"][-(MAX_HISTORY_TURNS * 2):]

    return result


@app.post("/api/chat/clear")
async def clear_chat_history():
    STATE["chat_history"] = []
    return {"status": "cleared"}


@app.post("/api/explain-anomaly")
async def explain_anomaly():
    """Picks a row flagged as a statistical outlier during cleaning (or a
    random row if none were flagged) and asks the agent to explain, in
    plain English, why it stands out from the rest of the dataset."""
    df = _require_df()

    if STATE["outlier_row_indices"]:
        row_index = random.choice(STATE["outlier_row_indices"])
        context_note = "This row was flagged as a statistical outlier (outside the normal IQR range) in at least one numeric column."
    else:
        row_index = random.choice(df.index.tolist())
        context_note = "No strong outliers were detected in this dataset, so this is a randomly picked row — explain how it compares to the average row anyway."

    row_index = int(row_index)
    if row_index not in df.index:
        row_index = int(df.index[0])

    question = (
        f"Look at row index {row_index} using df.loc[{row_index}]. {context_note} "
        f"Compare its values to df.describe() for context, then explain in 2-4 plain-English "
        f"sentences what makes this row unusual (or note if it's actually fairly typical)."
    )

    result = ask_agent(df, question, prior_history=None)  # standalone, not part of chat memory
    result["row_index"] = row_index
    return result


@app.get("/api/status")
async def status():
    df_for_status = STATE["raw_df"]  # reflects upload state, not just post-cleaning state
    return {
        "dataset_loaded": df_for_status is not None,
        "filename": STATE["filename"],
        "rows": int(df_for_status.shape[0]) if df_for_status is not None else 0,
        "document_loaded": STATE.get("document_text") is not None,
        "document_filename": STATE.get("document_filename"),
        "document_kind": STATE.get("document_kind"),  # "pdf" | "docx"
        "document_unit_count": STATE.get("document_unit_count"),
    }


@app.get("/api/report")
async def generate_report():
    """Builds a real downloadable PDF summarizing the dataset + ML results.
    Generated entirely server-side with fpdf2 — no external JS library or
    CDN involved, so it can't be broken by a blocked CDN like Chart.js was."""
    df = _require_df()
    ml = _compute_ml_analysis(df)

    pdf = FPDF()
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(20, 30, 60)
    pdf.cell(0, 12, "Agentic AI - Dataset Intelligence Report", ln=True)

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(90, 90, 90)
    pdf.cell(0, 8, f"Dataset: {STATE['filename']}", ln=True)
    pdf.ln(4)

    def section_title(text):
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(20, 100, 140)
        pdf.cell(0, 10, text, ln=True)
        pdf.set_text_color(30, 30, 30)
        pdf.set_font("Helvetica", "", 11)

    def kv_line(label, value):
        pdf.cell(70, 8, str(label), border=0)
        pdf.cell(0, 8, str(value), ln=True)

    # --- Dataset overview ---
    section_title("Dataset Overview")
    kv_line("Rows:", df.shape[0])
    kv_line("Columns:", df.shape[1])
    kv_line("Column names:", ", ".join(df.columns.astype(str)))
    pdf.ln(4)

    # --- Cleaning summary ---
    section_title("Data Cleaning Summary")
    kv_line("Missing values remaining:", int(df.isna().sum().sum()))
    kv_line("Duplicate rows remaining:", int(df.duplicated().sum()))
    pdf.ln(4)

    # --- ML results ---
    section_title("Machine Learning Results")
    kv_line("K-Means clusters found:", ml["kmeans"].get("clusters", 0))
    kv_line("Decision Tree accuracy:", f"{ml['decision_tree'].get('accuracy', 0)}%")
    kv_line("Random Forest accuracy:", f"{ml['random_forest'].get('accuracy', 0)}%")
    kv_line("Best performing model:", ml["best_model"])
    kv_line("Best accuracy:", f"{ml['best_accuracy']}%")
    if ml.get("target_column"):
        note = " (auto-binned into Low/Medium/High)" if ml.get("target_was_binned") else ""
        kv_line("Target column used:", f"{ml['target_column']}{note}")
    pdf.ln(4)

    # --- Sample data preview ---
    section_title("Sample Rows (first 5)")
    pdf.set_font("Courier", "", 8)
    preview_text = df.head(5).to_string()
    for line in preview_text.split("\n"):
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(0, 5, line)

    pdf_bytes = bytes(pdf.output())

    filename = f"{(STATE['filename'] or 'dataset').rsplit('.', 1)[0]}_AI_Report.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Serve the frontend from this same FastAPI app -----------------
# This MUST be the last thing registered: Starlette matches routes in
# registration order, so every /api/... route above is checked first, and
# this catch-all only serves frontend files for anything else. Having one
# app serve both frontend and backend means no CORS setup is needed and
# deployment (e.g. on Render) is a single service instead of two.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")