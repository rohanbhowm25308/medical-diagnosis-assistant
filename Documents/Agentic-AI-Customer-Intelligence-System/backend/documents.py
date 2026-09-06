"""
documents.py
------------
Document Intelligence — PDF / DOCX upload, AI summary, and Q&A chat. This is
deliberately separate from the CSV analytics pipeline in main.py: there's no
dataframe here, just extracted text.

Handles three kinds of pages/content:
  1. Real selectable text (pdfplumber / python-docx paragraphs & tables)
  2. Scanned or handwritten pages / embedded images with no text layer
     -> rendered to an image (pdfplumber's own page.to_image(), backed by
     the pypdfium2 wheel — no external binary needed) and OCR'd (Tesseract
     via pytesseract)
  3. A mix of both within the same file — each PDF page and each DOCX
     embedded image is handled independently, so a notes PDF that's part
     typed text and part hand-drawn diagrams still gets fully extracted.

OCR needs the Tesseract-OCR *binary* installed on the machine (pip installs
only the Python wrapper) — see the TesseractNotFoundError handling below for
the exact install instructions surfaced to the user.
"""

import io
import re
from collections import Counter
import concurrent.futures

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from state import STATE
from agent import client, MODEL_NAME

router = APIRouter()

# On Windows especially, Tesseract-OCR often isn't added to PATH by its
# installer. Let the user point to it explicitly via backend/.env instead of
# having to fix their system PATH. This block runs at import time and prints
# a clear message to the terminal so OCR problems are visible immediately at
# server startup instead of only surfacing later as a failed upload.
import os
_tesseract_cmd = os.environ.get("TESSERACT_CMD", "").strip().strip('"').strip("'")
if _tesseract_cmd:
    if os.path.isfile(_tesseract_cmd):
        try:
            import pytesseract
            pytesseract.pytesseract.tesseract_cmd = _tesseract_cmd
            print(f"[documents.py] TESSERACT_CMD set from .env and file exists: {_tesseract_cmd}")
        except ImportError:
            print("[documents.py] TESSERACT_CMD is set, but pytesseract isn't installed — run `pip install pytesseract`.")
    else:
        print(
            f"[documents.py] WARNING: TESSERACT_CMD in .env points to '{_tesseract_cmd}', "
            f"but that file doesn't exist. Double-check the exact path to tesseract.exe."
        )
else:
    print("[documents.py] No TESSERACT_CMD set in .env — relying on Tesseract being on system PATH.")


@router.get("/api/ocr-status")
async def ocr_status():
    """Visit this in your browser (http://127.0.0.1:8000/api/ocr-status) to check
    whether OCR is actually working, without needing to upload a file to find out."""
    result = {
        "tesseract_cmd_env_var": _tesseract_cmd or None,
        "tesseract_cmd_file_exists": os.path.isfile(_tesseract_cmd) if _tesseract_cmd else None,
    }
    try:
        import pytesseract
        version = pytesseract.get_tesseract_version()
        result["ocr_ready"] = True
        result["tesseract_version"] = str(version)
        result["resolved_tesseract_path"] = pytesseract.pytesseract.tesseract_cmd
    except ImportError:
        result["ocr_ready"] = False
        result["error"] = "pytesseract Python package isn't installed. Run: pip install pytesseract"
    except Exception as e:
        result["ocr_ready"] = False
        result["error"] = (
            f"Tesseract binary could not be run: {e}. Either it isn't installed, isn't on PATH, "
            f"or TESSERACT_CMD in backend/.env points to the wrong location."
        )
    return result

MAX_CHARS = 60000       # cap extracted text so a huge PDF doesn't blow up memory/prompt size
OCR_TEXT_THRESHOLD = 20  # a page/image with fewer real chars than this is treated as "needs OCR"
OCR_MAX_PAGES = 60       # hard cap on how many PDF pages get OCR'd (keeps upload time bounded)
OCR_WORKERS = int(os.environ.get("OCR_WORKERS", "4"))  # parallel Tesseract processes; override in .env if needed
OCR_PAGE_TIMEOUT_SECONDS = 45  # a single stuck/corrupt page gets skipped instead of hanging the whole upload
OCR_DPI = 110            # measured ~23% faster than 150dpi with no accuracy loss (see documents.py notes)
DOCX_OCR_MAX_IMAGES = 25


def _ocr_pil_image(img):
    """Core OCR call, given an already-open PIL Image. Returns (text, avg_confidence_0_to_100).
    Uses image_to_data (not image_to_string) so we get a real confidence score in the same pass.
    Converts to grayscale first — measurably faster for Tesseract with no accuracy loss (color
    isn't informative for typed/handwritten text) than leaving it as RGB."""
    import pytesseract

    if img.mode != "L":
        img = img.convert("L")
    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

    words, confs = [], []
    for word, conf in zip(data["text"], data["conf"]):
        if word.strip():
            words.append(word)
            try:
                c = int(conf)
                if c >= 0:
                    confs.append(c)
            except (TypeError, ValueError):
                pass
    text = " ".join(words)
    avg_conf = round(sum(confs) / len(confs), 1) if confs else 0.0
    return text, avg_conf


def _ocr_image_bytes(image_bytes: bytes):
    """OCR a single image given as raw bytes (used for DOCX embedded pictures)."""
    from PIL import Image
    img = Image.open(io.BytesIO(image_bytes))
    return _ocr_pil_image(img)


def _raise_ocr_unavailable(missing: str):
    raise HTTPException(
        status_code=500,
        detail=(
            f"This file has no selectable text (scanned/handwritten pages) and OCR isn't fully set up "
            f"on the server — missing {missing}. Run `pip install pytesseract Pillow`, then install "
            f"the Tesseract-OCR program itself (it's separate from the Python package): "
            f"Windows installer at https://github.com/UB-Mannheim/tesseract/wiki, "
            f"Mac: `brew install tesseract`, Linux: `apt install tesseract-ocr`. "
            f"Restart the server after installing."
        ),
    )


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
def _extract_pdf_text(raw: bytes):
    """Returns (full_text, page_count, ocr_used, avg_ocr_confidence_or_None, ocr_truncated).

    Rendering scanned/handwritten pages to an image uses pdfplumber's own
    built-in `page.to_image()` (backed by the pypdfium2 wheel — a pure pip
    install, no external binary or separate C-extension dependency), so PDF
    handling shares the exact same, already-proven pdfplumber install that
    text-based PDFs already use. No PyMuPDF/poppler involved.

    OCR itself (the slow part — each page is a separate external Tesseract
    process call) runs across OCR_WORKERS threads in parallel, since each
    page's OCR call is fully independent of the others. Page *rendering*
    stays sequential first, since pdfplumber/pypdfium2 page objects aren't
    guaranteed safe to touch concurrently from multiple threads — but
    rendering is a small fraction of the total time compared to OCR, so this
    doesn't cost much."""
    try:
        import pdfplumber
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="pdfplumber isn't installed on the server. Add 'pdfplumber' to requirements.txt.",
        )

    ocr_used = False
    ocr_confidences = []

    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        page_count = len(pdf.pages)
        page_texts = [(p.extract_text() or "").strip() for p in pdf.pages]

        pages_needing_ocr = [i for i, t in enumerate(page_texts) if len(t) < OCR_TEXT_THRESHOLD]
        ocr_truncated = len(pages_needing_ocr) > OCR_MAX_PAGES
        pages_to_process = pages_needing_ocr[:OCR_MAX_PAGES]

        if pages_to_process:
            try:
                import pytesseract as _pt
            except ImportError:
                _raise_ocr_unavailable("pytesseract")

            # 1) Render every page that needs OCR — sequential, but fast
            # (~0.2-0.3s/page) compared to OCR itself.
            rendered = {}
            for i in pages_to_process:
                try:
                    rendered[i] = pdf.pages[i].to_image(resolution=OCR_DPI).original
                except Exception:
                    continue  # one bad page shouldn't sink the whole upload

            # 2) OCR every rendered page in parallel — this is the slow part
            # (~2-3s/page), and each call is an independent Tesseract
            # process, so real wall-clock speedup scales with CPU cores.
            # Each page gets its own timeout so one stuck/corrupt page can't
            # hang the entire upload — it's just skipped instead.
            tesseract_missing = False
            with concurrent.futures.ThreadPoolExecutor(max_workers=OCR_WORKERS) as pool:
                future_to_page = {pool.submit(_ocr_pil_image, img): i for i, img in rendered.items()}
                for future in concurrent.futures.as_completed(future_to_page):
                    i = future_to_page[future]
                    try:
                        text, conf = future.result(timeout=OCR_PAGE_TIMEOUT_SECONDS)
                        if text.strip():
                            page_texts[i] = text
                            ocr_used = True
                            ocr_confidences.append(conf)
                    except _pt.TesseractNotFoundError:
                        tesseract_missing = True
                    except concurrent.futures.TimeoutError:
                        continue  # this one page took too long — skip it, keep the rest
                    except Exception:
                        continue

            if tesseract_missing:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Tesseract-OCR isn't installed (or isn't on PATH) on this machine. "
                        "Windows installer: https://github.com/UB-Mannheim/tesseract/wiki — "
                        "after installing, either add it to your system PATH or set "
                        "TESSERACT_CMD=C:\\Program Files\\Tesseract-OCR\\tesseract.exe in backend/.env, "
                        "then restart the server."
                    ),
                )

    full_text = "\n\n".join(t for t in page_texts if t.strip())
    avg_ocr_confidence = round(sum(ocr_confidences) / len(ocr_confidences), 1) if ocr_confidences else None
    return full_text, page_count, ocr_used, avg_ocr_confidence, ocr_truncated


def _extract_docx_text(raw: bytes):
    """Returns (full_text, paragraph_count, ocr_used, avg_ocr_confidence_or_None)."""
    try:
        import docx
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="python-docx isn't installed on the server. Add 'python-docx' to requirements.txt.",
        )
    doc = docx.Document(io.BytesIO(raw))
    paras = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:  # transcripts/records are often stored as tables
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                paras.append(" | ".join(cells))

    # OCR embedded pictures (scanned pages or handwritten notes pasted into the doc) — in parallel,
    # same reasoning as the PDF path: each image's OCR call is fully independent.
    ocr_used = False
    ocr_confidences = []
    try:
        image_rels = [r for r in doc.part.rels.values() if "image" in r.reltype]
    except Exception:
        image_rels = []

    if image_rels:
        try:
            import pytesseract as _pt
        except ImportError:
            _raise_ocr_unavailable("pytesseract")

        blobs = []
        for rel in image_rels[:DOCX_OCR_MAX_IMAGES]:
            try:
                blobs.append(rel.target_part.blob)
            except Exception:
                continue

        tesseract_missing = False
        with concurrent.futures.ThreadPoolExecutor(max_workers=OCR_WORKERS) as pool:
            futures = [pool.submit(_ocr_image_bytes, blob) for blob in blobs]
            for future in concurrent.futures.as_completed(futures):
                try:
                    text, conf = future.result(timeout=OCR_PAGE_TIMEOUT_SECONDS)
                    if text.strip():
                        paras.append(text)
                        ocr_used = True
                        ocr_confidences.append(conf)
                except _pt.TesseractNotFoundError:
                    tesseract_missing = True
                except concurrent.futures.TimeoutError:
                    continue  # this one image took too long — skip it, keep the rest
                except Exception:
                    continue  # one bad image shouldn't sink the whole upload

        if tesseract_missing:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Tesseract-OCR isn't installed (or isn't on PATH). Windows installer: "
                    "https://github.com/UB-Mannheim/tesseract/wiki — restart the server after installing."
                ),
            )

    avg_ocr_confidence = round(sum(ocr_confidences) / len(ocr_confidences), 1) if ocr_confidences else None
    return "\n".join(paras), len(doc.paragraphs), ocr_used, avg_ocr_confidence


@router.post("/api/upload-document")
async def upload_document(file: UploadFile = File(...)):
    name = (file.filename or "").lower()
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if not (name.endswith(".pdf") or name.endswith(".docx")):
        raise HTTPException(status_code=400, detail="Only .pdf and .docx files are supported here.")

    try:
        ocr_truncated = False
        if name.endswith(".pdf"):
            # Run off the event loop — OCR can take a while, and this keeps the
            # server responsive to other requests (health checks, etc.) while it works.
            text, unit_count, ocr_used, ocr_confidence, ocr_truncated = await run_in_threadpool(_extract_pdf_text, raw)
            doc_kind = "pdf"
        else:
            text, unit_count, ocr_used, ocr_confidence = await run_in_threadpool(_extract_docx_text, raw)
            doc_kind = "docx"
    except HTTPException:
        raise  # intentional, already-clear errors (missing Tesseract, etc.) pass through as-is
    except Exception as e:
        # Safety net: anything unexpected still returns a clean error instead
        # of a raw crash/timeout that looks like the upload silently died.
        raise HTTPException(status_code=500, detail=f"Unexpected error while reading the file: {e}")

    text = text.strip()
    if not text:
        raise HTTPException(
            status_code=400,
            detail="Couldn't extract any readable content, even with OCR — the file may be blank, "
                   "corrupted, or too low-resolution to read.",
        )
    text = text[:MAX_CHARS]
    paragraphs = [p.strip() for p in re.split(r"\n+", text) if len(p.strip()) > 20]

    STATE["document_text"] = text
    STATE["document_paragraphs"] = paragraphs
    STATE["document_filename"] = file.filename
    STATE["document_kind"] = doc_kind
    STATE["document_chat_history"] = []
    STATE["document_ocr_used"] = ocr_used
    STATE["document_ocr_confidence"] = ocr_confidence
    STATE["document_unit_count"] = unit_count
    STATE["compare_document_text"] = None  # a new primary document invalidates any pending comparison
    STATE["compare_document_filename"] = None
    # A document upload replaces any previously uploaded CSV dataset.
    STATE["raw_df"] = None
    STATE["clean_df"] = None
    STATE["filename"] = None
    STATE["chat_history"] = []
    STATE["last_ml_result"] = None
    STATE["trained_rf"] = None
    STATE["trained_kmeans"] = None
    STATE["cluster_profiles"] = []

    return {
        "filename": file.filename,
        "kind": doc_kind,
        "unit_count": unit_count,  # page count for PDF, paragraph count for DOCX
        "word_count": len(text.split()),
        "preview": text[:400],
        "ocr_used": ocr_used,
        "ocr_confidence": ocr_confidence,
        "ocr_truncated": ocr_truncated,
    }


# ---------------------------------------------------------------------------
# Document Quality Score — the document equivalent of the CSV Health Score.
# Based on real extraction signal (words per page/paragraph, OCR confidence
# when OCR was used) rather than a fake/placeholder number.
# ---------------------------------------------------------------------------
@router.get("/api/document-quality")
async def document_quality():
    if not STATE.get("document_text"):
        raise HTTPException(status_code=400, detail="No document uploaded yet.")

    word_count = len(STATE["document_text"].split())
    unit_count = max(STATE.get("document_unit_count") or 1, 1)
    ocr_used = STATE.get("document_ocr_used", False)
    ocr_confidence = STATE.get("document_ocr_confidence")

    density = word_count / unit_count
    density_score = min(100.0, density / 60 * 100)  # ~60 words/unit is a solid baseline

    if ocr_used and ocr_confidence is not None:
        score = round(0.5 * density_score + 0.5 * ocr_confidence, 1)
        source = "ocr"
    else:
        score = round(density_score, 1)
        source = "text"

    if score >= 85:
        grade = "Excellent"
    elif score >= 65:
        grade = "Good"
    elif score >= 45:
        grade = "Fair"
    else:
        grade = "Needs Attention"

    return {
        "score": score,
        "grade": grade,
        "source": source,  # "ocr" or "text" — which extraction path produced this document
        "ocr_used": ocr_used,
        "ocr_confidence": ocr_confidence,
        "word_count": word_count,
        "unit_count": unit_count,
    }


# ---------------------------------------------------------------------------
# AI Summary
# ---------------------------------------------------------------------------
TYPE_KEYWORDS = {
    "Academic Transcript / Records": ["gpa", "semester", "credit", "grade", "transcript", "cgpa", "marks obtained"],
    "Lecture / Study Notes": ["chapter", "lecture", "definition", "unit ", "topic:", "syllabus"],
    "Resume / CV": ["experience", "skills", "education", "resume", "curriculum vitae", "objective"],
    "Research Paper / Report": ["abstract", "introduction", "conclusion", "references", "methodology"],
    "Assignment / Question Paper": ["question", "marks:", "answer the following", "instructions:", "time allowed"],
}

# Heuristic fallback for "who this document is for" when there's no LLM
# available, or as a fast default before/alongside the AI-generated summary.
AUDIENCE_MAP = {
    "Academic Transcript / Records": [
        {"name": "Student", "desc": "Tracking their own grades and academic progress"},
        {"name": "Academic Advisor", "desc": "Reviewing performance for guidance or eligibility checks"},
    ],
    "Lecture / Study Notes": [
        {"name": "Student Learning the Topic", "desc": "Using this as a study guide or revision reference"},
        {"name": "Instructor / TA", "desc": "Using this as teaching or quiz material"},
    ],
    "Resume / CV": [
        {"name": "Recruiter / Hiring Manager", "desc": "Screening for relevant skills and experience"},
    ],
    "Research Paper / Report": [
        {"name": "Researcher / Student", "desc": "Citing or building on this work"},
        {"name": "Reviewer", "desc": "Evaluating methodology and conclusions"},
    ],
    "Assignment / Question Paper": [
        {"name": "Student", "desc": "Preparing answers or practicing for an exam"},
    ],
    "General Document": [
        {"name": "General Reader", "desc": "Looking for the key information in this document"},
    ],
}


def _guess_document_type(text: str) -> str:
    low = text.lower()
    best_type, best_score = "General Document", 0
    for label, kws in TYPE_KEYWORDS.items():
        score = sum(low.count(k) for k in kws)
        if score > best_score:
            best_type, best_score = label, score
    return best_type


def _heuristic_summary(text: str, n_sentences: int = 5):
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if 25 < len(s.strip()) < 300]
    if not sentences:
        return []
    words = re.findall(r"[a-zA-Z]{4,}", text.lower())
    freq = Counter(words)
    for stop in ("this", "that", "with", "from", "have", "were", "been", "which",
                 "their", "there", "would", "could", "about", "these", "those"):
        freq.pop(stop, None)

    scored = []
    for s in sentences:
        s_words = re.findall(r"[a-zA-Z]{4,}", s.lower())
        score = sum(freq.get(w, 0) for w in s_words) / (len(s_words) + 1)
        scored.append((score, s))
    top_sentences = {s for _, s in sorted(scored, key=lambda x: -x[0])[:n_sentences]}
    return [s for s in sentences if s in top_sentences][:n_sentences]  # keep original order


@router.get("/api/document-summary")
async def document_summary():
    if not STATE.get("document_text"):
        raise HTTPException(status_code=400, detail="No document uploaded yet.")
    text = STATE["document_text"]
    doc_type = _guess_document_type(text)
    audience = AUDIENCE_MAP.get(doc_type, AUDIENCE_MAP["General Document"])
    ocr_used = STATE.get("document_ocr_used", False)
    ocr_confidence = STATE.get("document_ocr_confidence")
    extraction_confidence = ocr_confidence if (ocr_used and ocr_confidence is not None) else 98.0

    if client is not None:
        try:
            prompt = (
                f"You are analyzing a {doc_type.lower()}. Summarize it in 4-6 concise bullet points, "
                f"then list up to 5 key facts, names, dates, or numbers worth remembering. "
                f"Only use information present in the text — never invent details.\n\nDOCUMENT:\n{text[:12000]}"
            )
            resp = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=600,
            )
            return {
                "detected_type": doc_type,
                "word_count": len(text.split()),
                "summary": resp.choices[0].message.content,
                "source": "ai",
                "audience_personas": audience,
                "extraction_confidence": extraction_confidence,
                "ocr_used": ocr_used,
            }
        except Exception:
            pass  # fall through to the heuristic summary below

    bullets = _heuristic_summary(text)
    return {
        "detected_type": doc_type,
        "word_count": len(text.split()),
        "summary": "\n".join(f"- {b}" for b in bullets) or "Not enough text to summarize.",
        "source": "heuristic",
        "audience_personas": audience,
        "extraction_confidence": extraction_confidence,
        "ocr_used": ocr_used,
    }


# ---------------------------------------------------------------------------
# Document Chat (lightweight retrieval, no vector DB needed for a demo)
# ---------------------------------------------------------------------------
class DocChatRequest(BaseModel):
    question: str


def _retrieve_relevant_paragraphs(question: str, paragraphs, top_k: int = 5):
    q_words = set(re.findall(r"[a-zA-Z]{3,}", question.lower()))
    if not q_words:
        return paragraphs[:top_k]
    scored = []
    for p in paragraphs:
        overlap = sum(1 for w in re.findall(r"[a-zA-Z]{3,}", p.lower()) if w in q_words)
        if overlap:
            scored.append((overlap, p))
    if not scored:
        return paragraphs[:top_k]
    scored.sort(key=lambda x: -x[0])
    return [p for _, p in scored[:top_k]]


@router.post("/api/document-chat")
async def document_chat(req: DocChatRequest):
    if not STATE.get("document_text"):
        raise HTTPException(status_code=400, detail="No document uploaded yet.")
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Empty question.")

    paragraphs = STATE.get("document_paragraphs", [])
    relevant = _retrieve_relevant_paragraphs(req.question, paragraphs)
    context = "\n\n".join(relevant) if relevant else STATE["document_text"][:4000]

    filename = STATE.get("document_filename") or "the uploaded file"
    kind = (STATE.get("document_kind") or "document").upper()
    word_count = len(STATE["document_text"].split())
    file_meta = f"Filename: {filename} | Type: {kind} | Length: {word_count} words"

    if client is None:
        preview = "\n\n".join(relevant[:3]) if relevant else "No closely matching passage was found."
        return {
            "answer": f"(AI chat is disabled — no GROQ_API_KEY configured.) File: {file_meta}\n\nClosest matching passage(s):\n\n{preview}",
            "source": "heuristic",
        }

    history = STATE.get("document_chat_history", [])
    messages = [{
        "role": "system",
        "content": (
            "You answer questions about an uploaded document. You're given the file's metadata "
            "(filename, type, length) plus excerpts from its actual content. "
            "For questions ABOUT THE FILE ITSELF (its name, whether it's a PDF/DOCX, how long it is, "
            "whether one was uploaded at all) — answer directly and confidently from the metadata provided; "
            "don't refuse these just because that detail isn't repeated inside the body text. "
            "For questions about the SUBJECT MATTER/CONTENT — rely only on the excerpts, and say so "
            "honestly if the excerpts don't contain the answer, rather than guessing."
        ),
    }]
    messages += history[-6:]
    messages.append({
        "role": "user",
        "content": f"FILE METADATA:\n{file_meta}\n\nDOCUMENT EXCERPTS:\n{context}\n\nQUESTION: {req.question}",
    })

    try:
        resp = client.chat.completions.create(
            model=MODEL_NAME, messages=messages, temperature=0.2, max_tokens=500,
        )
        answer = resp.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    history.append({"role": "user", "content": req.question})
    history.append({"role": "assistant", "content": answer})
    STATE["document_chat_history"] = history[-12:]

    return {"answer": answer, "source": "ai"}


@router.post("/api/document-chat/clear")
async def clear_document_chat():
    STATE["document_chat_history"] = []
    return {"status": "cleared"}
