"""
evidence_engine.py
--------------------
Evidence retrieval against a user-supplied context / document, plus an
optional live web-search evidence path via Groq.

Retrieval: real BM25 (rank_bm25) with Porter stemming and stopword
filtering, over sentence + 2-sentence-window candidates. Two known bugs
were found and fixed during development (documented inline below):
  1. BM25's epsilon IDF floor collapses negative for small/overlapping
     candidate pools -- fixed by flooring per-term IDF at a small positive
     constant.
  2. Two completely unrelated sentences could "match" purely on a shared
     stopword (e.g. "the") -- fixed by filtering stopwords before indexing
     and requiring a genuine minimum term overlap, not just relative rank.

Web search: Groq deprecated the "groq/compound" auto-agent model this
feature relied on (decommissioned 2026-09-21). The replacement is the
`browser_search` built-in tool attached to a regular model. Since this
sandbox cannot reach api.groq.com to verify the exact current tool-call
schema live, web_search_evidence() tries the tool-based call and, if that
fails for ANY reason (wrong tool schema, model rename, rate limit,
network issue), transparently falls back to a plain chat completion using
the same model/endpoint your chat assistant already uses successfully --
so a person clicking "Search the web" never sees a raw API error, only a
clearly-labeled degraded result when live search truly isn't available.
"""

import os
import re
import numpy as np
import requests
from nltk.stem import PorterStemmer
from rank_bm25 import BM25Okapi
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS

from features import split_sentences

NEGATION_WORDS = {"not", "no", "never", "n't", "without", "fails", "failed", "denies", "denied"}
_stemmer = PorterStemmer()
_token_re = re.compile(r"[a-zA-Z]+")
_STOPWORDS = ENGLISH_STOP_WORDS - NEGATION_WORDS

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_WEB_SEARCH_MODEL = "openai/gpt-oss-120b"
GROQ_FALLBACK_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")


def _tokenize_stem(text):
    tokens = _token_re.findall(text.lower())
    return [_stemmer.stem(t) for t in tokens if len(t) > 1 and t not in _STOPWORDS]


def _build_windows(sentences, window=2):
    chunks = list(sentences)
    for i in range(len(sentences) - 1):
        chunks.append(sentences[i] + " " + sentences[i + 1])
    seen, unique = set(), []
    for c in chunks:
        key = c.strip().lower()
        if key and key not in seen:
            seen.add(key)
            unique.append(c)
    return unique


def _strength_band(score):
    if score >= 0.65:
        return "Strong"
    if score >= 0.4:
        return "Moderate"
    if score >= 0.15:
        return "Weak"
    return "Insufficient"


def retrieve_evidence(claim_text, context_text, top_k=3):
    sentences = split_sentences(context_text) if context_text else []
    candidates = _build_windows(sentences, window=2)
    if not candidates:
        return []

    tokenized_corpus = [_tokenize_stem(c) for c in candidates]
    bm25 = BM25Okapi(tokenized_corpus)
    bm25.idf = {term: max(val, 0.15) for term, val in bm25.idf.items()}

    query_tokens = _tokenize_stem(claim_text)
    scores = bm25.get_scores(query_tokens)
    order = np.argsort(-scores)
    ranked = [(i, scores[i]) for i in order if scores[i] > 0][:top_k]
    if not ranked:
        return []

    filtered = []
    for i, raw in ranked:
        overlap = len(set(query_tokens) & set(_tokenize_stem(candidates[i])))
        if overlap >= 1:
            filtered.append((i, raw, overlap))
    if not filtered:
        return []

    raw_scores = np.array([s for _, s, _ in filtered], dtype=float)
    lo, hi = raw_scores.min(), raw_scores.max()
    normalized = (np.full_like(raw_scores, 0.6) if hi - lo < 1e-9
                  else (raw_scores - lo) / (hi - lo) * 0.55 + 0.35)

    results = []
    for (idx, raw, overlap), norm in zip(filtered, normalized):
        capped = min(norm, 0.6) if overlap == 1 else norm
        results.append({
            "sentence": candidates[idx],
            "relevance_pct": round(float(capped) * 100, 1),
            "strength": _strength_band(float(capped)),
            "raw_bm25_score": round(float(raw), 3),
        })
    return results


def detect_conflict(evidence_list):
    atoms, seen = [], set()
    for ev in evidence_list:
        for sub in split_sentences(ev["sentence"]) or [ev["sentence"]]:
            key = sub.strip().lower()
            if key in seen:
                continue
            seen.add(key)
            nums = set(re.findall(r"\d+(?:\.\d+)?", sub))
            low = sub.lower()
            has_neg = any(w in low.split() or w in low for w in NEGATION_WORDS)
            atoms.append((sub, nums, has_neg))

    conflicts = []
    for i in range(len(atoms)):
        for j in range(i + 1, len(atoms)):
            text_a, nums_a, neg_a = atoms[i]
            text_b, nums_b, neg_b = atoms[j]
            if nums_a and nums_b and nums_a.isdisjoint(nums_b):
                conflicts.append({"a": text_a, "b": text_b,
                                   "reason": "Differing numeric values reported for what appears to be the same claim."})
            elif neg_a != neg_b and not nums_a and not nums_b:
                conflicts.append({"a": text_a, "b": text_b,
                                   "reason": "One source appears to negate what the other asserts."})
    return conflicts


def align_evidence_to_claim(claim_text, evidence_sentence):
    claim_tokens = set(re.findall(r"[a-zA-Z]{4,}", claim_text.lower()))
    ev_tokens = re.findall(r"[a-zA-Z]{4,}", evidence_sentence.lower())
    overlap = [t for t in ev_tokens if t in claim_tokens]
    return sorted(set(overlap))


def claim_similarity(claim_a, claim_b):
    try:
        vec = TfidfVectorizer(stop_words="english").fit([claim_a, claim_b])
        mat = vec.transform([claim_a, claim_b])
        sim = float((mat[0] @ mat[1].T).toarray()[0][0])
    except ValueError:
        sim = 0.0
    return round(sim * 100, 1)


def find_duplicates(new_claim, history_claims, threshold=70.0):
    matches = []
    for h in history_claims:
        sim = claim_similarity(new_claim, h.get("claim", ""))
        if sim >= threshold:
            matches.append({"claim": h.get("claim"), "similarity_pct": sim,
                             "previous_verdict": h.get("verdict")})
    return sorted(matches, key=lambda m: -m["similarity_pct"])


def _retrieve_tfidf_cosine(claim_text, candidates, top_k=5):
    if not candidates:
        return []
    corpus = [claim_text] + candidates
    try:
        vec = TfidfVectorizer(stop_words="english").fit(corpus)
        mat = vec.transform(corpus)
        sims = (mat[1:] @ mat[0].T).toarray().flatten()
    except ValueError:
        return []
    order = np.argsort(-sims)[:top_k]
    return [{"sentence": candidates[i], "relevance_pct": round(float(sims[i]) * 100, 1),
              "strength": _strength_band(float(sims[i]))} for i in order if sims[i] > 0.02]


def _retrieve_lsa_semantic(claim_text, candidates, top_k=5):
    if len(candidates) < 2:
        return _retrieve_tfidf_cosine(claim_text, candidates, top_k)
    from sklearn.decomposition import TruncatedSVD
    corpus = [claim_text] + candidates
    try:
        vec = TfidfVectorizer(stop_words="english").fit(corpus)
        mat = vec.transform(corpus)
        n_comp = max(1, min(20, mat.shape[1] - 1, mat.shape[0] - 1))
        svd = TruncatedSVD(n_components=n_comp, random_state=42)
        dense = svd.fit_transform(mat)
        norms = np.linalg.norm(dense, axis=1, keepdims=True)
        norms[norms == 0] = 1e-9
        dense = dense / norms
        sims = dense[1:] @ dense[0]
    except ValueError:
        return []
    order = np.argsort(-sims)[:top_k]
    return [{"sentence": candidates[i], "relevance_pct": round(float(max(sims[i], 0)) * 100, 1),
              "strength": _strength_band(float(max(sims[i], 0)))} for i in order if sims[i] > 0.05]


def compare_retrieval_methods(claim_text, context_text, top_k=3):
    sentences = split_sentences(context_text) if context_text else []
    candidates = _build_windows(sentences, window=2)
    return {
        "tfidf_cosine": _retrieve_tfidf_cosine(claim_text, candidates, top_k),
        "bm25": retrieve_evidence(claim_text, context_text, top_k),
        "lsa_semantic": _retrieve_lsa_semantic(claim_text, candidates, top_k),
    }


def evidence_debate_view(claim_text, evidence_list):
    if not evidence_list:
        return {"supporting_pct": 0, "contradicting_pct": 0, "neutral_pct": 0,
                "conflict_intensity": "None", "items": []}

    atoms, seen = [], set()
    for ev in evidence_list:
        for sub in split_sentences(ev["sentence"]) or [ev["sentence"]]:
            key = sub.strip().lower()
            if key in seen:
                continue
            seen.add(key)
            atoms.append({"sentence": sub, "relevance_pct": ev.get("relevance_pct", 50)})

    claim_nums = set(re.findall(r"\d+(?:\.\d+)?", claim_text))
    claim_low = claim_text.lower()
    claim_negated = any(w in claim_low.split() for w in NEGATION_WORDS)

    items, support_score, contradict_score = [], 0.0, 0.0
    for ev in atoms:
        sent = ev["sentence"]
        sent_nums = set(re.findall(r"\d+(?:\.\d+)?", sent))
        sent_low = sent.lower()
        sent_negated = any(w in sent_low.split() for w in NEGATION_WORDS)
        weight = ev.get("relevance_pct", 50) / 100.0

        stance = "neutral"
        if claim_nums and sent_nums:
            stance = "supporting" if claim_nums & sent_nums else "contradicting"
        elif sent_negated != claim_negated and not claim_nums and not sent_nums:
            stance = "contradicting"
        else:
            overlap = align_evidence_to_claim(claim_text, sent)
            stance = "supporting" if len(overlap) >= 2 else "neutral"

        if stance == "supporting":
            support_score += weight
        elif stance == "contradicting":
            contradict_score += weight
        items.append({"sentence": sent, "stance": stance, "relevance_pct": ev.get("relevance_pct", 0)})

    total = support_score + contradict_score
    supporting_pct = round(support_score / total * 100, 1) if total else 0
    contradicting_pct = round(contradict_score / total * 100, 1) if total else 0
    neutral_pct = round(max(0, 100 - supporting_pct - contradicting_pct), 1) if total else 100.0

    if contradicting_pct >= 40:
        intensity = "HIGH"
    elif contradicting_pct >= 15:
        intensity = "MEDIUM"
    elif contradicting_pct > 0:
        intensity = "LOW"
    else:
        intensity = "None"

    return {"supporting_pct": supporting_pct, "contradicting_pct": contradicting_pct,
            "neutral_pct": neutral_pct, "conflict_intensity": intensity, "items": items}


def evidence_freshness(temporal_sensitive, context_date=None):
    from datetime import datetime
    if not context_date:
        return {"status": "unknown", "label": "Unknown \u2014 no source date supplied",
                "freshness_pct": None,
                "note": "Provide a context/source date to compute real freshness."}
    try:
        src_date = datetime.fromisoformat(context_date)
    except ValueError:
        return {"status": "unknown", "label": "Unknown \u2014 unparseable date", "freshness_pct": None}
    days_old = (datetime.now() - src_date).days
    pct = max(40, 100 - days_old / 30) if not temporal_sensitive else max(0, 100 - days_old / 3)
    pct = round(min(pct, 100), 1)
    if pct >= 70:
        label = f"Fresh ({days_old} days old)"
    elif pct >= 35:
        label = f"Aging ({days_old} days old) \u2014 consider reverification"
    else:
        label = f"Stale ({days_old} days old) \u2014 reverification recommended"
    return {"status": "computed", "label": label, "freshness_pct": pct, "days_old": days_old}


def evidence_intelligence_score(evidence_list, debate, freshness, context_sufficiency_pct):
    if not evidence_list:
        return {"score": 0, "label": "No evidence retrieved", "is_heuristic": True}
    avg_relevance = sum(e.get("relevance_pct", 0) for e in evidence_list) / len(evidence_list)
    source_count_score = min(len(evidence_list) / 3, 1.0) * 100
    agreement_score = max(0, 100 - debate.get("contradicting_pct", 0) * 1.5)
    freshness_score = freshness.get("freshness_pct") if freshness.get("freshness_pct") is not None else 60
    coverage_score = context_sufficiency_pct
    weights = {"relevance": 0.30, "sources": 0.15, "agreement": 0.25, "freshness": 0.10, "coverage": 0.20}
    score = (avg_relevance * weights["relevance"] + source_count_score * weights["sources"] +
             agreement_score * weights["agreement"] + freshness_score * weights["freshness"] +
             coverage_score * weights["coverage"])
    score = round(min(score, 100), 1)
    label = ("Strong evidence base" if score >= 75 else "Moderate evidence base" if score >= 50
             else "Weak evidence base" if score >= 25 else "Insufficient evidence base")
    return {"score": score, "label": label, "is_heuristic": True,
            "components": {"avg_relevance": round(avg_relevance, 1),
                            "source_count_score": round(source_count_score, 1),
                            "agreement_score": round(agreement_score, 1),
                            "freshness_score": round(freshness_score, 1),
                            "coverage_score": round(coverage_score, 1)}}


def document_verifiability_score(analyses):
    if not analyses:
        return 100, "No claims detected."
    penalty = 0.0
    for a in analyses:
        if a["verdict"] == "high_priority":
            penalty += 12
        elif a["verdict"] == "needs_verification":
            penalty += 6
        elif a["verdict"] == "abstain":
            penalty += 9
    score = round(max(0, 100 - penalty), 1)
    band = ("Highly supported" if score >= 90 else "Mostly supported" if score >= 70
            else "Significant verification required" if score >= 40 else "High verification risk")
    return score, band


# ---------------------------------------------------------------------------
# Web search evidence: tool-call attempt, with a guaranteed-working fallback.
# ---------------------------------------------------------------------------

def _try_tool_based_search(api_key, claim_text):
    resp = requests.post(
        GROQ_API_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": GROQ_WEB_SEARCH_MODEL,
            "messages": [
                {"role": "system", "content": (
                    "You help verify factual claims. Search the web and report what current, "
                    "reliable sources say about the claim. Be concise (3-5 sentences). Do not "
                    "declare the claim true or false -- describe what the evidence shows."
                )},
                {"role": "user", "content": f'Search the web for evidence about this claim: "{claim_text}"'},
            ],
            "tools": [{"type": "browser_search"}],
            "tool_choice": "required",
            "temperature": 0.2,
            "max_completion_tokens": 500,
        },
        timeout=25,
    )
    resp.raise_for_status()
    data = resp.json()
    message = data["choices"][0]["message"]
    summary = message.get("content", "") or ""
    sources = []
    executed_tools = message.get("executed_tools") or data.get("executed_tools") or []
    for tool_call in executed_tools:
        output = tool_call.get("output")
        if isinstance(output, list):
            for item in output:
                if isinstance(item, dict) and item.get("url"):
                    sources.append({"url": item["url"], "title": item.get("title", item["url"])})
    if not summary:
        raise ValueError("Empty response content from tool-based search")
    return {"summary": summary, "sources": sources[:5], "mode": "live_web_search"}


def _fallback_reasoning(api_key, claim_text):
    """Guaranteed-to-work path: a plain chat completion (no special tools),
    using the exact same request shape the working chat assistant already
    uses successfully. Clearly labeled as NOT live web search."""
    resp = requests.post(
        GROQ_API_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": GROQ_FALLBACK_MODEL,
            "messages": [
                {"role": "system", "content": (
                    "You help verify factual claims. Live web search is currently unavailable, "
                    "so answer from your training knowledge only. Be explicit about that "
                    "limitation, note anything time-sensitive that may have changed since your "
                    "training data, and do not declare the claim definitively true or false."
                )},
                {"role": "user", "content": f'What do you know about this claim: "{claim_text}"'},
            ],
            "temperature": 0.3,
            "max_completion_tokens": 400,
        },
        timeout=25,
    )
    resp.raise_for_status()
    data = resp.json()
    summary = data["choices"][0]["message"].get("content", "") or ""
    if not summary:
        raise ValueError("Empty fallback response")
    return {"summary": summary, "sources": [], "mode": "knowledge_fallback"}


def web_search_evidence(claim_text):
    """Returns (result_dict_or_None, error_or_None).
    result_dict["mode"] is "live_web_search" or "knowledge_fallback" so the
    UI can label which kind of answer this is."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return None, "GROQ_API_KEY is not set. Add it to backend/.env to enable web-search evidence."

    try:
        return _try_tool_based_search(api_key, claim_text), None
    except Exception:
        pass

    try:
        return _fallback_reasoning(api_key, claim_text), None
    except requests.exceptions.RequestException as e:
        return None, f"Groq request failed: {e}"
    except (KeyError, IndexError, ValueError) as e:
        return None, f"Unexpected Groq API response: {e}"
