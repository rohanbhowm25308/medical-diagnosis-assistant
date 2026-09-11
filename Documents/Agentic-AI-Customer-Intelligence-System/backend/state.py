"""
state.py
--------
Single shared in-memory "database" for the whole backend. Split out of
main.py so both main.py and advanced.py (the new AI features module) can
read/write it without a circular import.
"""

STATE = {
    "raw_df": None,
    "clean_df": None,
    "filename": None,
    "chat_history": [],  # list of {"role": "user"/"assistant", "content": str} — cleared on new upload
    "outlier_row_indices": [],  # populated by /api/clean, used by the anomaly explainer

    # --- populated by /api/analyze, consumed by advanced.py (What-If Simulator,
    # Persona Generator, Executive Summary, etc.) so those features don't have
    # to retrain models from scratch on every request. ---
    "last_ml_result": None,      # the full dict returned by _compute_ml_analysis
    "trained_rf": None,          # fitted RandomForestClassifier (or None)
    "trained_kmeans": None,      # fitted KMeans (or None)
    "rf_feature_cols": [],       # column order the RF model expects
    "kmeans_feature_cols": [],   # numeric column order the KMeans model expects
    "label_encoders": {},        # {column_name: fitted LabelEncoder} for categorical RF features
    "feature_defaults": {},      # {column_name: median/mode} used to fill unspecified What-If inputs
    "target_col": None,
    "target_was_binned": False,
    "cluster_profiles": [],      # per-cluster summary stats, built after KMeans fit

    # --- Document Intelligence (PDF/DOCX) — separate from the CSV pipeline
    # above. A user can upload lecture notes, transcripts, records, etc. and
    # chat with them without ever touching a dataframe. ---
    "document_text": None,
    "document_paragraphs": [],
    "document_filename": None,
    "document_kind": None,          # "pdf" or "docx"
    "document_chat_history": [],
    "document_ocr_used": False,      # True if any page/image needed OCR (scanned/handwritten content)
    "document_ocr_confidence": None, # average Tesseract confidence (0-100) across OCR'd pages/images
    "document_unit_count": 0,        # page count (PDF) or paragraph count (DOCX)
    "compare_document_text": None,   # "Document B" for the comparison feature — separate from the primary document
    "compare_document_filename": None,

    # --- AI Autonomous Investigation (investigation.py) — history of past
    # investigations, most recent last, used by the Audit Timeline. ---
    "investigation_history": [],

    # --- Model Health Center (enterprise.py) — held from the last /api/analyze
    # run so precision/recall/F1 can be computed without retraining. ---
    "rf_y_test": [],
    "rf_pred_test": [],

    # --- AI Data Drift (enterprise.py) — a second dataset uploaded purely for
    # comparison against the currently active one. ---
    "drift_baseline_df": None,
    "drift_baseline_filename": None,
    "drift_last_result": None,

    # --- AI Kill Switch (enterprise.py) — when False, every AI-agent endpoint
    # (investigate, chat, chat-based features) refuses to run. Real gate, not
    # cosmetic: checked inside the endpoints themselves. ---
    "kill_switch_enabled": True,

    # --- AI Cost & Performance Monitor (enterprise.py) — one entry per LLM
    # call made anywhere in the app, so the dashboard reflects real usage. ---
    "ops_log": [],

    # --- AI Governance Center (enterprise.py) ---
    "autonomy_level": 2,  # 1=Assist, 2=Approve (default), 3=Autonomous
}
