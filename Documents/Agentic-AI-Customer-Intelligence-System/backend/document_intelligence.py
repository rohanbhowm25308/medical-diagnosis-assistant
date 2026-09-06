"""
document_intelligence.py
-------------------------
The "AI Document Intelligence Dashboard" — the 8 features the user picked as
their recommended hackathon set, built on top of documents.py's extraction
pipeline:
  1. AI Document Summary (upgraded: purpose, key points, important info, action items)
  2. Ask Anything — already lives in documents.py's /api/document-chat
  3. AI Key Information Extraction (people, orgs, dates, money, locations, references)
  4. Smart Document Navigation (detected sections)
  5. Document Comparison (Document A vs Document B)
  6. AI Notes Generator (concepts, key takeaways, possible questions)
  7. AI Quiz Generator (MCQ / short-answer / interview questions)
  8. Document Intelligence Score

Every feature tries the LLM first (for quality) and falls back to a
heuristic implementation when no GROQ_API_KEY is configured or the LLM call
fails — so the whole dashboard still works, just with simpler output,
without an API key.
"""

import io
import re
import json
import difflib
from collections import Counter

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from state import STATE
from agent import client, MODEL_NAME
from documents import (
    _extract_pdf_text,
    _extract_docx_text,
    _guess_document_type,
    _heuristic_summary,
)

router = APIRouter()


def _require_document_text() -> str:
    if not STATE.get("document_text"):
        raise HTTPException(status_code=400, detail="No document uploaded yet.")
    return STATE["document_text"]


def _call_llm_json(prompt: str, max_tokens: int = 900, temperature: float = 0.3):
    """Ask the LLM for a JSON response. Returns the parsed object, or None if
    no client is configured, the call fails, or the response isn't valid
    JSON (callers fall back to a heuristic in every case)."""
    if client is None:
        return None
    try:
        resp = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        return json.loads(resp.choices[0].message.content)
    except Exception:
        pass
    # Retry without forcing JSON mode (some models/SDKs reject the param) and
    # pull the first {...} or [...] blob out of whatever text comes back.
    try:
        resp = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": prompt + "\n\nRespond with ONLY valid JSON, no other text."}],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        text = resp.choices[0].message.content
        match = re.search(r"[\{\[].*[\}\]]", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# 1. AI Document Summary (upgraded)
# ---------------------------------------------------------------------------
@router.get("/api/document-intel/summary")
async def document_intel_summary():
    text = _require_document_text()
    doc_type = _guess_document_type(text)

    result = _call_llm_json(
        f"You are analyzing a {doc_type.lower()}. Based ONLY on the text below, return a JSON object with:\n"
        f'"executive_summary" (2-3 sentence overview), "main_purpose" (1 sentence), '
        f'"key_points" (array of 4-6 short strings), "important_information" (array of 2-4 short strings — '
        f'critical facts, warnings, or requirements), "action_items" (array of 0-4 short strings — '
        f"things a reader should do; empty array if none apply). "
        f"Only use information present in the text — never invent details.\n\nDOCUMENT:\n{text[:12000]}"
    )
    if result and isinstance(result, dict):
        return {
            "detected_type": doc_type,
            "word_count": len(text.split()),
            "executive_summary": result.get("executive_summary", ""),
            "main_purpose": result.get("main_purpose", ""),
            "key_points": result.get("key_points", []) or [],
            "important_information": result.get("important_information", []) or [],
            "action_items": result.get("action_items", []) or [],
            "source": "ai",
        }

    # Heuristic fallback: reuse the frequency-scored sentence extractor and
    # split its output across the same buckets as best we can.
    sentences = _heuristic_summary(text, n_sentences=6)
    return {
        "detected_type": doc_type,
        "word_count": len(text.split()),
        "executive_summary": " ".join(sentences[:2]) if sentences else "Not enough text to summarize.",
        "main_purpose": sentences[0] if sentences else "",
        "key_points": sentences[2:6] if len(sentences) > 2 else sentences,
        "important_information": [],
        "action_items": [],
        "source": "heuristic",
    }


# ---------------------------------------------------------------------------
# 3. AI Key Information Extraction
# ---------------------------------------------------------------------------
DATE_PATTERN = re.compile(
    r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}"
    r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}"
    r"|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+\d{4}"
    r"|\b(?:19|20)\d{2}\b)",
    re.IGNORECASE,
)
MONEY_PATTERN = re.compile(r"(?:[$₹€£]\s?[\d,]+(?:\.\d+)?(?:\s?(?:million|billion|k|K|M|B))?"
                            r"|\b[\d,]+(?:\.\d+)?\s?(?:USD|INR|EUR|GBP|Rs\.?|dollars|rupees))")
ORG_KEYWORDS = ("Inc", "Ltd", "LLC", "Corp", "Corporation", "Company", "University", "Institute",
                "Department", "Ministry", "Association", "Foundation", "Group", "Organization")
REFERENCE_PATTERN = re.compile(r"(\[\d+\]|\(\w+,?\s*\d{4}\)|https?://\S+)")
NAME_PATTERN = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b")


def _extract_entities_heuristic(text: str):
    flat = re.sub(r"\s+", " ", text)  # normalize whitespace so name-matching doesn't cross line breaks
    dates = list(dict.fromkeys(m for m in DATE_PATTERN.findall(flat)))[:15]
    money = list(dict.fromkeys(MONEY_PATTERN.findall(flat)))[:15]
    refs = list(dict.fromkeys(m[0] if isinstance(m, tuple) else m for m in REFERENCE_PATTERN.findall(flat)))[:15]

    candidates = list(dict.fromkeys(NAME_PATTERN.findall(flat)))
    SENTENCE_STARTERS = {"This", "That", "These", "Those", "We", "Our", "It", "They", "He", "She",
                          "His", "Her", "Its", "The", "There", "Here", "In", "On", "At", "For"}
    HEADING_WORDS = {"Introduction", "Objectives", "Methodology", "Results", "Recommendations",
                      "Conclusion", "Summary", "Abstract", "Background", "Overview", "Discussion"}
    candidates = [
        c for c in candidates
        if not any(w in SENTENCE_STARTERS or w in HEADING_WORDS for w in c.split())
    ]
    orgs, people, locations = [], [], []
    for c in candidates:
        if any(kw in c for kw in ORG_KEYWORDS):
            orgs.append(c)
        else:
            people.append(c)  # best-effort — can't reliably tell person vs. place without real NLP
    return {
        "people": people[:15],
        "organizations": orgs[:15],
        "dates": dates,
        "monetary_values": money,
        "locations": locations,  # left empty in heuristic mode — too unreliable to guess
        "references": refs,
    }


@router.get("/api/document-intel/entities")
async def document_intel_entities():
    text = _require_document_text()

    result = _call_llm_json(
        "Extract key entities from the document text below. Return a JSON object with these exact keys, "
        'each an array of short strings: "people" (person names), "organizations" (companies, institutions), '
        '"dates" (dates or years mentioned), "monetary_values" (amounts of money), '
        '"locations" (places), "references" (citations, URLs, or document references). '
        "Only include things that actually appear in the text. Keep each array to at most 15 items.\n\n"
        f"DOCUMENT:\n{text[:12000]}"
    )
    if result and isinstance(result, dict):
        entities = {k: (result.get(k) or [])[:15] for k in
                    ("people", "organizations", "dates", "monetary_values", "locations", "references")}
        source = "ai"
    else:
        entities = _extract_entities_heuristic(text)
        source = "heuristic"

    counts = {k: len(v) for k, v in entities.items()}
    return {"entities": entities, "counts": counts, "source": source}


# ---------------------------------------------------------------------------
# 4. Smart Document Navigation (section detection)
# ---------------------------------------------------------------------------
HEADING_KEYWORDS = ("chapter", "section", "introduction", "conclusion", "abstract", "summary",
                    "recommendation", "methodology", "results", "objective", "background",
                    "overview", "discussion", "appendix", "references")
HEADING_LINE_RE = re.compile(r"^\s*(?:(?:chapter|section)\s+)?\d{1,2}[\.\)]\s*[A-Za-z]")


def _looks_like_heading(line: str) -> bool:
    line = line.strip()
    if not line or len(line) > 70:
        return False
    low = line.lower()
    if HEADING_LINE_RE.match(line):
        return True
    if any(low.startswith(kw) or low == kw for kw in HEADING_KEYWORDS):
        return True
    words = line.split()
    if 1 <= len(words) <= 8 and (line.isupper() or line.istitle()):
        return True
    return False


def _detect_sections_heuristic(text: str):
    lines = [l for l in text.split("\n") if l.strip()]
    sections = []
    current_title, current_body = None, []

    for line in lines:
        if _looks_like_heading(line):
            if current_title is not None:
                sections.append({"title": current_title, "preview": " ".join(current_body)[:300]})
            current_title = line.strip()
            current_body = []
        else:
            current_body.append(line.strip())

    if current_title is not None:
        sections.append({"title": current_title, "preview": " ".join(current_body)[:300]})
    elif current_body:
        sections.append({"title": "Full Document", "preview": " ".join(current_body)[:300]})

    return sections[:20]


@router.get("/api/document-intel/sections")
async def document_intel_sections():
    text = _require_document_text()

    result = _call_llm_json(
        "Identify the main sections of this document. Return a JSON object with key \"sections\", an array "
        'of objects each with "title" (short heading) and "summary" (one sentence about that section). '
        "Order them as they appear in the document. At most 12 sections.\n\n"
        f"DOCUMENT:\n{text[:12000]}"
    )
    if result and isinstance(result, dict) and result.get("sections"):
        sections = [
            {"title": s.get("title", f"Section {i+1}"), "preview": s.get("summary", "")}
            for i, s in enumerate(result["sections"][:20])
        ]
        return {"sections": sections, "source": "ai"}

    sections = _detect_sections_heuristic(text)
    return {"sections": sections, "source": "heuristic"}


# ---------------------------------------------------------------------------
# 6. AI Notes Generator
# ---------------------------------------------------------------------------
STOPWORDS = {"this", "that", "with", "from", "have", "were", "been", "which", "their", "there",
             "would", "could", "about", "these", "those", "your", "will", "into", "than", "when"}


def _extract_concepts_heuristic(text: str, n: int = 8):
    words = re.findall(r"\b[A-Z][a-zA-Z]{3,}\b", text)
    freq = Counter(w for w in words if w.lower() not in STOPWORDS)
    return [w for w, _ in freq.most_common(n)]


@router.get("/api/document-intel/notes")
async def document_intel_notes():
    text = _require_document_text()

    result = _call_llm_json(
        "Create study notes from this document. Return a JSON object with: "
        '"concepts" (array of 5-8 short important concept names), '
        '"key_takeaways" (array of 4-6 short sentences), '
        '"possible_questions" (array of 4-6 questions a reader might ask about this content). '
        "Only use information present in the text.\n\n"
        f"DOCUMENT:\n{text[:12000]}"
    )
    if result and isinstance(result, dict):
        return {
            "concepts": result.get("concepts", []) or [],
            "key_takeaways": result.get("key_takeaways", []) or [],
            "possible_questions": result.get("possible_questions", []) or [],
            "source": "ai",
        }

    concepts = _extract_concepts_heuristic(text)
    takeaways = _heuristic_summary(text, n_sentences=5)
    questions = [f"What does the document say about {c}?" for c in concepts[:5]] or \
                ["What is the main topic of this document?"]
    return {
        "concepts": concepts,
        "key_takeaways": takeaways,
        "possible_questions": questions,
        "source": "heuristic",
    }


# ---------------------------------------------------------------------------
# 7. AI Quiz Generator
# ---------------------------------------------------------------------------
class QuizRequest(BaseModel):
    count: int = 5
    qtype: str = "mcq"  # "mcq" | "short" | "interview"


def _generate_mcq_heuristic(text: str, count: int):
    sentences = _heuristic_summary(text, n_sentences=count * 2)
    concepts = _extract_concepts_heuristic(text, n=count * 3)
    questions = []
    for i, s in enumerate(sentences[:count]):
        words = [w for w in re.findall(r"\b[A-Z][a-zA-Z]{3,}\b", s) if w.lower() not in STOPWORDS]
        answer = words[0] if words else (concepts[i % len(concepts)] if concepts else "the document")
        distractors = [c for c in concepts if c != answer][:3]
        while len(distractors) < 3:
            distractors.append(f"Option {len(distractors) + 1}")
        options = distractors + [answer]
        questions.append({
            "question": f"Which term is most closely associated with: \"{s[:120]}\"?",
            "options": options,
            "correct_index": options.index(answer),
            "explanation": f"This relates to '{answer}', mentioned in the document.",
        })
    return questions


@router.post("/api/document-intel/quiz")
async def document_intel_quiz(req: QuizRequest):
    text = _require_document_text()
    count = max(1, min(req.count, 10))
    qtype = req.qtype if req.qtype in ("mcq", "short", "interview") else "mcq"

    if qtype == "mcq":
        prompt = (
            f"Create exactly {count} multiple-choice questions testing understanding of this document. "
            'Return a JSON object with key "questions", an array of objects each with: '
            '"question", "options" (array of exactly 4 strings), "correct_index" (0-3), '
            '"explanation" (why that answer is correct). Base everything only on the document text.\n\n'
            f"DOCUMENT:\n{text[:12000]}"
        )
    elif qtype == "short":
        prompt = (
            f"Create exactly {count} short-answer questions testing understanding of this document. "
            'Return a JSON object with key "questions", an array of objects each with '
            '"question" and "sample_answer" (1-2 sentences). Base everything only on the document text.\n\n'
            f"DOCUMENT:\n{text[:12000]}"
        )
    else:
        prompt = (
            f"Create exactly {count} interview-style questions someone might be asked about this document's "
            'subject matter. Return a JSON object with key "questions", an array of objects each with '
            '"question" and "sample_answer" (2-3 sentences covering what a strong answer would include).\n\n'
            f"DOCUMENT:\n{text[:12000]}"
        )

    result = _call_llm_json(prompt, max_tokens=1200)
    if result and isinstance(result, dict) and result.get("questions"):
        return {"questions": result["questions"][:count], "qtype": qtype, "source": "ai"}

    if qtype == "mcq":
        questions = _generate_mcq_heuristic(text, count)
    else:
        sentences = _heuristic_summary(text, n_sentences=count)
        questions = [
            {"question": f"Explain the significance of: \"{s[:100]}\"", "sample_answer": s}
            for s in sentences
        ] or [{"question": "What is this document about?", "sample_answer": "See the document summary."}]

    return {"questions": questions, "qtype": qtype, "source": "heuristic"}


# ---------------------------------------------------------------------------
# 5. Document Comparison
# ---------------------------------------------------------------------------
@router.post("/api/document-intel/upload-compare")
async def upload_compare_document(file: UploadFile = File(...)):
    """Uploads a SECOND document (Document B) without touching the primary
    document (Document A) in STATE, so the two can be diffed against each
    other."""
    if not STATE.get("document_text"):
        raise HTTPException(status_code=400, detail="Upload the first document before adding one to compare.")

    name = (file.filename or "").lower()
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if not (name.endswith(".pdf") or name.endswith(".docx")):
        raise HTTPException(status_code=400, detail="Only .pdf and .docx files are supported here.")

    try:
        if name.endswith(".pdf"):
            text, unit_count, ocr_used, ocr_confidence, _ = await run_in_threadpool(_extract_pdf_text, raw)
        else:
            text, unit_count, ocr_used, ocr_confidence = await run_in_threadpool(_extract_docx_text, raw)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error while reading the file: {e}")

    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Couldn't extract any readable content from this file.")

    STATE["compare_document_text"] = text[:60000]
    STATE["compare_document_filename"] = file.filename

    return {"filename": file.filename, "word_count": len(text.split())}


def _compare_heuristic(text_a: str, text_b: str):
    paras_a = [p.strip() for p in text_a.split("\n") if len(p.strip()) > 15]
    paras_b = [p.strip() for p in text_b.split("\n") if len(p.strip()) > 15]

    sm = difflib.SequenceMatcher(None, paras_a, paras_b)
    added, removed, common, changed = [], [], [], []

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            common.extend(paras_a[i1:i2])
        elif tag == "delete":
            removed.extend(paras_a[i1:i2])
        elif tag == "insert":
            added.extend(paras_b[j1:j2])
        elif tag == "replace":
            a_chunk, b_chunk = paras_a[i1:i2], paras_b[j1:j2]
            for a, b in zip(a_chunk, b_chunk):
                ratio = difflib.SequenceMatcher(None, a, b).ratio()
                if ratio > 0.4:
                    changed.append({"before": a[:200], "after": b[:200]})
                else:
                    removed.append(a)
                    added.append(b)
            if len(a_chunk) > len(b_chunk):
                removed.extend(a_chunk[len(b_chunk):])
            elif len(b_chunk) > len(a_chunk):
                added.extend(b_chunk[len(a_chunk):])

    return {
        "added": added[:20], "removed": removed[:20],
        "changed": changed[:20], "common": common[:10],
    }


@router.get("/api/document-intel/compare")
async def document_intel_compare():
    text_a = _require_document_text()
    text_b = STATE.get("compare_document_text")
    if not text_b:
        raise HTTPException(status_code=400, detail="Upload a second document to compare against first.")

    diff = _compare_heuristic(text_a, text_b)

    summary = None
    result = _call_llm_json(
        "Compare these two documents and summarize the key differences in a JSON object with key "
        '"summary" (2-4 sentences describing what meaningfully changed between them).\n\n'
        f"DOCUMENT A:\n{text_a[:6000]}\n\nDOCUMENT B:\n{text_b[:6000]}",
        max_tokens=400,
    )
    if result and isinstance(result, dict):
        summary = result.get("summary")

    return {
        "document_a": STATE.get("document_filename"),
        "document_b": STATE.get("compare_document_filename"),
        "diff": diff,
        "ai_summary": summary,
        "source": "ai" if summary else "heuristic",
    }


# ---------------------------------------------------------------------------
# 8. Document Intelligence Score
# ---------------------------------------------------------------------------
@router.get("/api/document-intel/score")
async def document_intel_score():
    text = _require_document_text()

    from documents import document_quality  # reuse the extraction-quality scorer directly
    quality = await document_quality()

    sections = await document_intel_sections()
    entities = await document_intel_entities()

    section_count = len(sections["sections"])
    entity_total = sum(entities["counts"].values())

    structure_score = 100 if section_count >= 3 else (60 if section_count >= 1 else 20)
    density_score = quality["score"]
    entity_score = min(100, entity_total * 6)
    clarity_score = quality["score"]  # extraction quality doubles as a clarity proxy

    overall = round(0.3 * structure_score + 0.3 * density_score + 0.2 * entity_score + 0.2 * clarity_score)
    overall = max(0, min(100, overall))

    checklist = {
        "well_structured": section_count >= 3,
        "high_information_density": density_score >= 65,
        "clear_content": clarity_score >= 65,
        "important_sections_detected": section_count >= 2,
        "key_entities_extracted": entity_total >= 3,
    }

    return {
        "score": overall,
        "checklist": checklist,
        "breakdown": {
            "structure_score": structure_score,
            "density_score": round(density_score, 1),
            "entity_score": entity_score,
            "clarity_score": round(clarity_score, 1),
        },
        "section_count": section_count,
        "entity_total": entity_total,
    }
