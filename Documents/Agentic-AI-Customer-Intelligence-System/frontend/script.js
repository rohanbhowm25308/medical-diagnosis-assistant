// Empty string = same-origin relative paths (e.g. fetch("/api/upload")).
// This works both locally and after deployment (Render, etc.) without any
// hardcoded URL, because the backend now serves this frontend directly —
// see FRONTEND_DIR mount at the bottom of backend/main.py.
const API_BASE = "";

// Wraps fetch with a timeout so a slow/hung backend can never leave a
// button or status stuck forever with no feedback. 90s default because
// free-tier hosts (Render, etc.) can take 50+ seconds to wake from sleep —
// too short a timeout here would misreport a normal cold start as a failure.
async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Check your backend is running and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ---------------------------------------------------------------------
   PARTICLE BACKGROUND (dots drifting, faint connecting lines) — the
   original style, restored per request.
--------------------------------------------------------------------- */
const canvas = document.getElementById("particles");
const ctx = canvas.getContext("2d");
let particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = document.body.scrollHeight;
}

function initParticles() {
  const count = Math.floor((canvas.width * canvas.height) / 18000);
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r: Math.random() * 1.5 + 0.5,
  }));
}

function drawParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(148, 197, 255, 0.8)";

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
    if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i], b = particles[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 110) {
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.12 * (1 - dist / 110)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  requestAnimationFrame(drawParticles);
}

window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });
resizeCanvas();
initParticles();
drawParticles();

/* ---------------------------------------------------------------------
   NAV / SCROLL HELPERS
--------------------------------------------------------------------- */
document.getElementById("navUploadBtn").onclick = () => document.getElementById("csvInput").click();
document.getElementById("heroUploadBtn").onclick = () => document.getElementById("csvInput").click();
document.getElementById("chooseFileBtn").onclick = () => document.getElementById("csvInput").click();
document.getElementById("getStartedBtn").onclick = () =>
  document.getElementById("features").scrollIntoView({ behavior: "smooth" });

/* ---------------------------------------------------------------------
   BACKEND STATUS CHECK — handles free-tier cold starts (Render, etc.)
   gracefully instead of treating a sleeping server as "offline". A sleeping
   free-tier instance can take 50+ seconds to wake up; we poll patiently
   and show the user what's happening instead of a confusing failure.
--------------------------------------------------------------------- */
async function checkBackend() {
  const statPill = document.getElementById("statBackend");
  const banner = document.getElementById("coldStartBanner");

  const MAX_ATTEMPTS = 15;
  const RETRY_DELAY_MS = 4000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/status`, {}, 10000);
      if (res.ok) {
        statPill.textContent = "Online";
        statPill.className = "pill pill-done";
        if (banner) banner.style.display = "none";
        try {
          const data = await res.json();
          syncStateFromStatus(data);
        } catch { /* non-critical — worst case the user just re-uploads */ }
        return;
      }
    } catch {
      // fall through to retry
    }

    // First failure: show the "waking up" banner instead of "offline" —
    // this is almost always just a cold start, not a real problem.
    if (banner) {
      banner.style.display = "flex";
      banner.querySelector(".cold-start-text").textContent =
        `⏳ Waking up the server (free tier can take up to a minute)... attempt ${attempt}/${MAX_ATTEMPTS}`;
    }
    statPill.textContent = "Waking up...";
    statPill.className = "pill pill-warn";

    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }

  // All retries exhausted — now it's fair to call it actually offline
  statPill.textContent = "Offline";
  statPill.className = "pill";
  statPill.style.background = "rgba(248,113,113,0.15)";
  statPill.style.color = "#f87171";
  if (banner) {
    banner.querySelector(".cold-start-text").textContent =
      "⚠️ Couldn't reach the backend after several attempts. It may genuinely be down — check your Render service.";
  }
}
checkBackend();

/* ---------------------------------------------------------------------
   UPLOAD — dispatches to the CSV pipeline or the PDF/DOCX document
   pipeline based on the file extension. Both share the same upload zone,
   the same "Start AI Analysis" button, and the same chat assistant —
   see advanced.js for how those branch on `currentUploadType`.
--------------------------------------------------------------------- */
let insightsGenerated = 0;
let currentUploadType = "csv"; // "csv" | "pdf" | "docx" — read by advanced.js
let anyFileUploaded = false;   // gates the chat's "nothing uploaded yet" message

/* Re-sync the frontend with whatever the backend actually has in memory.
   This matters because the backend's STATE outlives a single page load —
   if you upload a file, then reload/reopen the page (or the dev server's
   --reload restarts the frontend serving), the browser's JS variables reset
   to defaults even though the backend still remembers your file. Without
   this, the chat would wrongly say "nothing uploaded" right after a reload
   even though your PDF/CSV is still sitting in the backend. */
function syncStateFromStatus(data) {
  if (anyFileUploaded) return; // this session already has a fresh upload — don't override it

  if (data.dataset_loaded) {
    currentUploadType = "csv";
    anyFileUploaded = true;
    document.getElementById("datasetName").textContent = data.filename || "Previously uploaded dataset";
    document.getElementById("uploadStatus").textContent = "Uploaded (from previous session)";
    document.getElementById("statDataset").textContent = "Ready";
    document.getElementById("statDataset").className = "pill pill-done";
    document.getElementById("previewRowsLabel").textContent = "Preview Rows";
    setDatasetTypeBadge("CSV");
    document.getElementById("smartSearchRow").style.display = "flex";
    document.getElementById("startAnalysisBtn").disabled = false;
    document.getElementById("startAnalysisBtn").classList.add("btn-ready-pulse");
    if (typeof showToast === "function") {
      showToast(`📦 Found your previous upload: ${data.filename}. You can chat about it or click Start AI Analysis.`, "good");
    }
  } else if (data.document_loaded) {
    currentUploadType = data.document_kind; // "pdf" | "docx"
    anyFileUploaded = true;
    document.getElementById("datasetName").textContent = data.document_filename || "Previously uploaded document";
    document.getElementById("uploadStatus").textContent = "Uploaded (from previous session)";
    document.getElementById("statDataset").textContent = "Ready";
    document.getElementById("statDataset").className = "pill pill-done";
    document.getElementById("previewRowsLabel").textContent = data.document_kind === "pdf" ? "Pages" : "Paragraphs";
    document.getElementById("previewRows").textContent = data.document_unit_count ?? "";
    document.getElementById("smartSearchRow").style.display = "none";
    setDatasetTypeBadge(data.document_kind.toUpperCase());
    document.getElementById("startAnalysisBtn").disabled = false;
    document.getElementById("startAnalysisBtn").classList.add("btn-ready-pulse");
    if (typeof showToast === "function") {
      showToast(`📄 Found your previous upload: ${data.document_filename}. You can chat about it or click Start AI Analysis.`, "good");
    }
  }
}

document.getElementById("csvInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf") || name.endsWith(".docx")) {
    await handleDocumentUpload(file, name.endsWith(".pdf") ? "pdf" : "docx");
  } else if (name.endsWith(".csv")) {
    await handleCsvUpload(file);
  } else {
    alert("Only .csv, .pdf, and .docx files are supported.");
  }
  e.target.value = ""; // allow re-selecting the same file later
});

async function handleCsvUpload(file) {
  currentUploadType = "csv";
  const chooseBtn = document.getElementById("chooseFileBtn");
  const statusEl = document.getElementById("uploadStatus");
  const startBtn = document.getElementById("startAnalysisBtn");
  startBtn.disabled = true; // don't invite a click until the upload actually finishes

  document.getElementById("fileNameLabel").textContent = file.name;
  chooseBtn.disabled = true; // prevent a second upload from starting mid-flight
  setDatasetTypeBadge("CSV");
  document.getElementById("previewRowsLabel").textContent = "Preview Rows";
  document.getElementById("smartSearchRow").style.display = "flex";
  if (typeof hideDocIntelDashboard === "function") hideDocIntelDashboard();
  // is bigger than this, the server only keeps the first chunk anyway — so
  // slicing it down HERE, before upload, means we don't waste time actually
  // transmitting the rest over a slow connection just to have it discarded.
  const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB
  let uploadBlob = file;

  if (file.size > MAX_UPLOAD_BYTES) {
    statusEl.textContent = "Trimming large file...";
    uploadBlob = file.slice(0, MAX_UPLOAD_BYTES, file.type);
  }

  statusEl.textContent = "Uploading...";

  const formData = new FormData();
  formData.append("file", uploadBlob, file.name); // keep the original filename

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/upload`,
      { method: "POST", body: formData },
      120000
    );

    if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
    const data = await res.json();

    document.getElementById("datasetSize").textContent = data.was_sampled ? "20+ MB" : `${data.size_kb} KB`;
    statusEl.textContent = data.was_sampled ? "Uploaded (sampled)" : "Uploaded";
    document.getElementById("datasetName").textContent = data.filename;
    document.getElementById("previewRows").textContent = data.rows;
    document.getElementById("statDataset").textContent = "Ready";
    document.getElementById("statDataset").className = "pill pill-done";
    anyFileUploaded = true;
    document.dispatchEvent(new CustomEvent("ai:upload-done", { detail: data }));

    document.getElementById("totalFeatures").textContent = data.columns;
    document.getElementById("totalRecords").textContent = data.rows;
    document.getElementById("missingValues").textContent = data.missing_values;
    document.getElementById("duplicateRows").textContent = data.duplicate_rows;

    if (data.was_sampled) {
      alert(
        "Heads up: " + data.sample_note +
        "\n\nThis keeps the app responsive on limited-memory hosting. " +
        "Run it locally for full-file analysis of very large datasets."
      );
    }

    renderPreviewTable(data.column_names, data.preview);
    addHistoryEntry({ ...data, type: "CSV" });
    checkAuthenticity();
    startBtn.disabled = false;
    startBtn.classList.add("btn-ready-pulse");
  } catch (err) {
    statusEl.textContent = "Upload failed";
    document.getElementById("datasetName").textContent = "Upload Failed";
    renderUploadError(err.message);
    if (typeof showToast === "function") {
      showToast("Upload failed — see the details in the Preview panel.", "warn");
    } else {
      alert(err.message);
    }
  } finally {
    chooseBtn.disabled = false;
  }
}

async function handleDocumentUpload(file, kind) {
  currentUploadType = kind; // "pdf" | "docx"
  const chooseBtn = document.getElementById("chooseFileBtn");
  const statusEl = document.getElementById("uploadStatus");
  const startBtn = document.getElementById("startAnalysisBtn");
  startBtn.disabled = true; // don't invite a click until the upload actually finishes

  document.getElementById("fileNameLabel").textContent = file.name;
  chooseBtn.disabled = true;
  setDatasetTypeBadge(kind.toUpperCase());
  document.getElementById("previewRowsLabel").textContent = kind === "pdf" ? "Pages" : "Paragraphs";
  document.getElementById("smartSearchRow").style.display = "none"; // CSV-only feature
  resetSmartSearch();
  statusEl.textContent = kind === "pdf" ? "Uploading & reading pages (OCR may take a bit for scanned/handwritten PDFs)..." : "Uploading & reading document...";

  const formData = new FormData();
  formData.append("file", file, file.name);

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/upload-document`,
      { method: "POST", body: formData },
      300000 // OCR on image-heavy PDFs can take a while — give it real room
    );
    if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
    const data = await res.json();

    document.getElementById("datasetSize").textContent = `${(file.size / 1024).toFixed(1)} KB`;
    statusEl.textContent = data.ocr_used ? `Uploaded (OCR, ${data.ocr_confidence}% confidence)` : "Uploaded";
    document.getElementById("datasetName").textContent = data.filename;
    document.getElementById("previewRows").textContent = data.unit_count;
    document.getElementById("statDataset").textContent = "Ready";
    document.getElementById("statDataset").className = "pill pill-done";
    anyFileUploaded = true;
    document.dispatchEvent(new CustomEvent("ai:upload-done", { detail: data }));

    // These are CSV/ML-specific stat pills — show "—" instead of stale numbers.
    ["totalFeatures", "totalRecords", "missingValues", "duplicateRows"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "—";
    });

    renderDocumentPreview(data.preview, data.word_count, kind);
    addHistoryEntry({
      filename: data.filename,
      type: kind.toUpperCase(),
      rows: data.unit_count,
      columns: data.word_count,
      sizeKb: +(file.size / 1024).toFixed(1),
    });
    document.dispatchEvent(new CustomEvent("ai:document-upload-done", { detail: data }));
    startBtn.disabled = false;
    startBtn.classList.add("btn-ready-pulse");
  } catch (err) {
    statusEl.textContent = "Upload failed";
    document.getElementById("datasetName").textContent = "Upload Failed";
    renderUploadError(err.message);
    if (typeof showToast === "function") {
      showToast("Upload failed — see the details in the Preview panel.", "warn");
    } else {
      alert(err.message); // fallback if advanced.js hasn't loaded for some reason
    }
  } finally {
    chooseBtn.disabled = false;
  }
}

function renderUploadError(message) {
  const thead = document.querySelector("#previewTable thead");
  const tbody = document.querySelector("#previewTable tbody");
  // Turn any URL in the message into a clickable link so install
  // instructions (like the Tesseract-OCR guide) aren't just dead text.
  const linked = escapeHtml(message).replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent2);text-decoration:underline;">$1</a>'
  );
  thead.innerHTML = `<tr><th>⚠️ Upload Failed</th></tr>`;
  tbody.innerHTML = `<tr><td style="white-space:pre-wrap;line-height:1.6;">${linked}</td></tr>`;
}

function setDatasetTypeBadge(label) {
  const badge = document.getElementById("datasetTypeBadge");
  badge.textContent = label;
  badge.style.display = "inline-block";
  badge.className = `pill mt ${label === "CSV" ? "pill-done" : "pill-doc"}`;
}

function renderDocumentPreview(previewText, wordCount, kind) {
  const thead = document.querySelector("#previewTable thead");
  const tbody = document.querySelector("#previewTable tbody");
  thead.innerHTML = `<tr><th>${kind.toUpperCase()} Preview (${wordCount} words total)</th></tr>`;
  tbody.innerHTML = `<tr><td style="white-space:pre-wrap;">${escapeHtml(previewText)}...</td></tr>`;
}

function renderPreviewTable(columns, rows) {
  const thead = document.querySelector("#previewTable thead");
  const tbody = document.querySelector("#previewTable tbody");
  thead.innerHTML = `<tr>${columns.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  tbody.innerHTML = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${r[c] ?? ""}</td>`).join("")}</tr>`)
    .join("");
}

/* ---------------------------------------------------------------------
   START AI ANALYSIS: clean -> analyze -> chart data, with animated steps
--------------------------------------------------------------------- */
document.getElementById("startAnalysisBtn").onclick = runFullAnalysis;
document.getElementById("reportBtn").onclick = downloadReport;

async function downloadReport() {
  if (typeof currentUploadType !== "undefined" && currentUploadType !== "csv") {
    alert("The PDF report is generated from CSV analysis only. Upload a CSV to use this — for documents, use the AI Summary in the AI Consultant section instead.");
    return;
  }
  const btn = document.getElementById("reportBtn");
  const originalText = btn.textContent;
  btn.textContent = "Generating...";
  btn.disabled = true;

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/report`, {}, 30000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Could not generate report. Upload a dataset first.");
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Try to use the filename the server suggested, otherwise fall back
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    a.download = match ? match[1] : "AI_Report.pdf";

    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function setProgress(pct, label) {
  document.getElementById("progressFill").style.width = `${pct}%`;
  document.getElementById("progressLabel").textContent = label;
}

function markStep(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "pill pill-done";
}

let analysisInFlight = false;

async function runFullAnalysis() {
  if (analysisInFlight) return; // ignore double-clicks / overlapping runs
  analysisInFlight = true;

  const startBtn = document.getElementById("startAnalysisBtn");
  const reportBtn = document.getElementById("reportBtn");
  startBtn.disabled = true;
  reportBtn.disabled = true;

  document.getElementById("aiStatus").textContent = "Running";

  try {
    await setProgress(10, "Cleaning dataset...");
    const cleanRes = await fetchWithTimeout(`${API_BASE}/api/clean`, { method: "POST" });
    if (!cleanRes.ok) throw new Error((await cleanRes.json()).detail || "Cleaning failed");
    const cleanData = await cleanRes.json();

    markStep("stepUploaded", "Done");
    markStep("stepMissing", cleanData.steps.missing_values.detail);
    markStep("stepDup", cleanData.steps.duplicate_check.detail);
    markStep("stepOutlier", cleanData.steps.outlier_detection.detail);
    markStep("stepFeature", cleanData.steps.feature_engineering.detail);
    markStep("stepReady", "Ready");
    document.dispatchEvent(new CustomEvent("ai:upload-clean-done", { detail: cleanData }));

    // ML training (silhouette search + Random Forest) can take longer on
    // big datasets, so this step gets a longer timeout than the others.
    await setProgress(50, "Training models...");
    const analyzeRes = await fetchWithTimeout(
      `${API_BASE}/api/analyze`,
      { method: "POST" },
      120000
    );
    if (!analyzeRes.ok) throw new Error((await analyzeRes.json()).detail || "Analysis failed");
    const ml = await analyzeRes.json();

    document.getElementById("mlKmeans").textContent = ml.kmeans.status === "done" ? `${ml.kmeans.clusters} clusters` : "Skipped";
    document.getElementById("mlDT").textContent = `${ml.decision_tree.accuracy}%`;
    document.getElementById("mlRF").textContent = `${ml.random_forest.accuracy}%`;
    document.getElementById("mlSegments").textContent = ml.customer_segments;
    document.getElementById("bestModel").textContent = ml.best_model;
    document.getElementById("bestAccuracy").textContent = `${ml.best_accuracy}%`;
    document.getElementById("aiConfidence").textContent = `${ml.best_accuracy}%`;

    const skipNote = document.getElementById("mlSkipNote");
    if (ml.ml_skip_reason) {
      skipNote.textContent = `ℹ️ ${ml.ml_skip_reason}`;
      skipNote.style.display = "block";
    } else {
      skipNote.style.display = "none";
    }

    renderCorrelationHeatmap(ml.correlation);
    renderFeatureImportance(ml.feature_importance);
    document.dispatchEvent(new CustomEvent("ai:analyze-done", { detail: ml }));

    await setProgress(80, "Building charts...");
    const chartRes = await fetchWithTimeout(`${API_BASE}/api/chart-data`);
    const chartData = await chartRes.json();
    renderCharts(chartData);
    document.dispatchEvent(new CustomEvent("ai:charts-done", { detail: chartData }));

    await setProgress(100, "Analysis complete");
    document.getElementById("aiStatus").textContent = "Complete";

    insightsGenerated++;
    document.getElementById("statInsights").textContent = insightsGenerated;
    updateLatestHistoryEntry(ml);
  } catch (err) {
    document.getElementById("aiStatus").textContent = "Error";
    document.dispatchEvent(new CustomEvent("ai:analysis-error", { detail: { message: err.message } }));
    alert(err.message);
  } finally {
    analysisInFlight = false;
    startBtn.disabled = false;
    reportBtn.disabled = false;
  }
}

/* ---------------------------------------------------------------------
   CHARTS
--------------------------------------------------------------------- */
let pieChartInstance, barChartInstance;

function renderCharts(data) {
  const pieCtx = document.getElementById("pieChart");
  const barCtx = document.getElementById("barChart");

  if (pieChartInstance) pieChartInstance.destroy();
  if (barChartInstance) barChartInstance.destroy();

  if (data.pie && data.pie.data) {
    pieChartInstance = new Chart(pieCtx, {
      type: "doughnut",
      data: {
        labels: Object.keys(data.pie.data),
        datasets: [{
          data: Object.values(data.pie.data),
          backgroundColor: ["#38bdf8", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa"],
        }],
      },
      options: { plugins: { legend: { labels: { color: "#e8f1ff" } } } },
    });
  }

  if (data.bar && data.bar.counts) {
    barChartInstance = new Chart(barCtx, {
      type: "bar",
      data: {
        labels: data.bar.bins,
        datasets: [{ label: data.bar.label, data: data.bar.counts, backgroundColor: "#38bdf8" }],
      },
      options: {
        scales: {
          x: { ticks: { color: "#94a3b8" } },
          y: { ticks: { color: "#94a3b8" } },
        },
        plugins: { legend: { labels: { color: "#e8f1ff" } } },
      },
    });
  }
}

/* ---------------------------------------------------------------------
   CHAT (agent)
--------------------------------------------------------------------- */
const chatWindow = document.getElementById("chatWindow");
const chatInput = document.getElementById("chatInput");

document.getElementById("chatSendBtn").onclick = sendChat;
chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

function addBubble(text, cls) {
  const div = document.createElement("div");
  div.className = `chat-bubble ${cls}`;
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return div;
}

let chatChartCounter = 0;

function addChartBubble(chart) {
  const wrap = document.createElement("div");
  wrap.className = "chat-chart-wrap";
  const canvasId = `chatChart${chatChartCounter++}`;
  wrap.innerHTML = `<canvas id="${canvasId}"></canvas>`;
  chatWindow.appendChild(wrap);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  const ctx = document.getElementById(canvasId);
  const colors = ["#38bdf8", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb923c", "#f472b6"];
  new Chart(ctx, {
    type: chart.type === "pie" ? "doughnut" : chart.type,
    data: {
      labels: chart.labels,
      datasets: [
        {
          label: chart.label,
          data: chart.values,
          backgroundColor: chart.type === "line" ? "rgba(56,189,248,0.2)" : colors,
          borderColor: "#38bdf8",
        },
      ],
    },
    options: {
      plugins: { legend: { display: chart.type !== "bar", labels: { color: "#e8f1ff" } } },
      scales: chart.type === "pie" ? {} : { x: { ticks: { color: "#94a3b8" } }, y: { ticks: { color: "#94a3b8" } } },
    },
  });
}

async function sendChat() {
  const question = chatInput.value.trim();
  if (!question) return;

  if (!anyFileUploaded) {
    addBubble(question, "user");
    chatInput.value = "";
    addBubble("Please upload a CSV, PDF, or DOCX file first — then I can answer questions about it!", "bot");
    return;
  }

  addBubble(question, "user");
  chatInput.value = "";
  addBubble("Thinking...", "bot");

  const isDocument = currentUploadType === "pdf" || currentUploadType === "docx";
  const endpoint = isDocument ? "/api/document-chat" : "/api/chat";

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}${endpoint}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      },
      90000 // agentic tool-calling can take several round-trips to the model — give it real room
    );
    chatWindow.removeChild(chatWindow.lastChild); // remove "Thinking..."

    if (!res.ok) {
      addBubble((await res.json()).detail || "Something went wrong.", "bot");
      return;
    }
    const data = await res.json();
    if (data.trace && data.trace.length) {
      addBubble(`🔧 Ran ${data.trace.length} pandas quer${data.trace.length > 1 ? "ies" : "y"} to find the answer.`, "trace");
    }
    addBubble(data.answer, "bot");
    if (data.chart && data.chart.labels) {
      addChartBubble(data.chart);
    }
  } catch (err) {
    chatWindow.removeChild(chatWindow.lastChild);
    // err.message already distinguishes a real timeout ("Request timed out...")
    // from a genuine connection failure — show it instead of a generic guess.
    addBubble(err.message || "Could not reach the backend. Is the server running?", "bot");
  }
}

/* ---------------------------------------------------------------------
   ANOMALY EXPLAINER
--------------------------------------------------------------------- */
document.getElementById("explainAnomalyBtn").onclick = async () => {
  const btn = document.getElementById("explainAnomalyBtn");
  btn.disabled = true;
  addBubble("🔎 Picking a row and analyzing why it stands out...", "bot");

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/explain-anomaly`, { method: "POST" }, 90000);
    chatWindow.removeChild(chatWindow.lastChild);

    if (!res.ok) {
      addBubble((await res.json()).detail || "Couldn't check for anomalies.", "bot");
      return;
    }
    const data = await res.json();
    addBubble(`Row ${data.row_index}: ${data.answer}`, "bot");
  } catch (err) {
    chatWindow.removeChild(chatWindow.lastChild);
    addBubble(err.message || "Could not reach the backend for the anomaly check.", "bot");
  } finally {
    btn.disabled = false;
  }
};

/* ---------------------------------------------------------------------
   CLEAR CHAT (also clears server-side memory so old context isn't reused)
--------------------------------------------------------------------- */
document.getElementById("clearChatBtn").onclick = async () => {
  chatWindow.innerHTML =
    '<div class="chat-bubble bot">👋 Chat cleared. Ask me anything about your dataset.</div>';
  try {
    await fetchWithTimeout(`${API_BASE}/api/chat/clear`, { method: "POST" }, 10000);
  } catch (err) {
    // non-critical if this fails — worst case old history lingers server-side
  }
};

/* ---------------------------------------------------------------------
   VOICE INPUT (Web Speech API — Chrome/Edge only, gracefully hides
   the mic button on unsupported browsers instead of erroring)
--------------------------------------------------------------------- */
const micBtn = document.getElementById("micBtn");
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognitionAPI) {
  micBtn.style.display = "none";
} else {
  const recognition = new SpeechRecognitionAPI();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  let isListening = false;

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("listening");
    micBtn.textContent = "🔴";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    chatInput.value = transcript;
  };

  recognition.onerror = () => {
    addBubble("Couldn't hear that clearly — try again or type your question.", "bot");
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("listening");
    micBtn.textContent = "🎤";
  };

  micBtn.onclick = () => {
    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  };
}

/* ---------------------------------------------------------------------
   UPLOAD HISTORY (session-only — resets on page reload, no backend/DB)
--------------------------------------------------------------------- */
let uploadHistory = [];

function addHistoryEntry(uploadData) {
  uploadHistory.unshift({
    filename: uploadData.filename,
    type: uploadData.type || "CSV", // "CSV" | "PDF" | "DOCX"
    sizeKb: uploadData.size_kb ?? uploadData.sizeKb,
    rows: uploadData.rows,
    columns: uploadData.columns,
    time: new Date(),
    analysis: null, // filled in later if "Start AI Analysis" is run
  });
  renderHistory();
}

function updateLatestHistoryEntry(mlResult) {
  if (uploadHistory.length === 0) return;
  uploadHistory[0].analysis = {
    bestModel: mlResult.best_model,
    bestAccuracy: mlResult.best_accuracy,
    clusters: mlResult.customer_segments,
  };
  renderHistory();
}

function updateLatestHistoryEntryAsDocument(summaryData) {
  if (uploadHistory.length === 0) return;
  uploadHistory[0].analysis = { docSummary: summaryData.detected_type };
  renderHistory();
}

const HISTORY_ICONS = { CSV: "📊", PDF: "📕", DOCX: "📘" };

function renderHistory() {
  const list = document.getElementById("historyList");

  if (uploadHistory.length === 0) {
    list.innerHTML = '<p class="muted" id="historyEmpty">No files uploaded yet this session.</p>';
    return;
  }

  list.innerHTML = uploadHistory
    .map((entry) => {
      const timeStr = entry.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const icon = HISTORY_ICONS[entry.type] || "📄";
      const isCsv = entry.type === "CSV";

      let badge = '<div class="history-badge pending">Not analyzed yet</div>';
      if (entry.analysis?.bestModel) {
        badge = `<div class="history-badge done">✓ ${entry.analysis.bestModel} · ${entry.analysis.bestAccuracy}%</div>`;
      } else if (entry.analysis?.docSummary) {
        badge = `<div class="history-badge done">✓ Summarized (${entry.analysis.docSummary})</div>`;
      }

      const meta = isCsv
        ? `${entry.rows.toLocaleString()} rows · ${entry.columns} columns · ${entry.sizeKb != null ? entry.sizeKb + " KB" : "20+ MB (sampled)"} · ${timeStr}`
        : `${entry.rows} ${entry.type === "PDF" ? "pages" : "paragraphs"} · ${entry.columns} words · ${entry.sizeKb} KB · ${timeStr}`;

      return `
        <div class="history-item">
          <div class="history-icon">${icon}</div>
          <div class="history-info">
            <div class="history-filename">${escapeHtml(entry.filename)} <span class="pill history-type-pill">${entry.type}</span></div>
            <div class="history-meta">${meta}</div>
          </div>
          ${badge}
        </div>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById("clearHistoryBtn").onclick = () => {
  uploadHistory = [];
  renderHistory();
};

/* ---------------------------------------------------------------------
   DATA AUTHENTICITY CHECK
--------------------------------------------------------------------- */
const AUTH_SIGNAL_LABELS = {
  benford_law: "Benford's Law fit (numeric leading digits)",
  numeric_distribution: "Numeric distribution shape",
  categorical_distribution: "Category frequency balance",
  sequential_ids: "Sequential ID columns",
};

async function checkAuthenticity() {
  const circle = document.getElementById("authScoreCircle");
  const number = document.getElementById("authScoreNumber");
  const verdict = document.getElementById("authVerdict");
  const subtext = document.getElementById("authSubtext");
  const signalsEl = document.getElementById("authSignals");

  number.textContent = "…";
  verdict.textContent = "Checking...";
  subtext.textContent = "Running statistical signal checks on the uploaded data.";
  signalsEl.innerHTML = "";
  circle.className = "auth-score-circle";

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/authenticity`, {}, 20000);
    if (!res.ok) throw new Error((await res.json()).detail || "Authenticity check failed");
    const data = await res.json();

    number.textContent = `${Math.round(data.authenticity_score)}%`;
    verdict.textContent = data.verdict;
    subtext.textContent = `Estimated ${data.synthetic_likelihood}% likelihood of synthetic/generated patterns.`;

    circle.className =
      "auth-score-circle " + (data.authenticity_score >= 70 ? "high" : data.authenticity_score >= 45 ? "mid" : "low");

    signalsEl.innerHTML = Object.entries(data.components)
      .map(([key, val]) => {
        const label = AUTH_SIGNAL_LABELS[key] || key;
        const pct = Math.round(val.score * 100);
        let detail = "";
        if (key === "sequential_ids") {
          detail = val.sequential_columns.length
            ? `Found in: ${val.sequential_columns.join(", ")}`
            : "No gapless sequential ID columns found";
        } else if (val.columns_checked) {
          detail = `Checked: ${val.columns_checked.slice(0, 4).join(", ")}${val.columns_checked.length > 4 ? "…" : ""}`;
        }
        return `
          <div class="auth-signal-row">
            <div>
              <div class="auth-signal-label">${label}</div>
              <div class="auth-signal-detail">${detail}</div>
            </div>
            <div class="pill ${pct >= 70 ? "pill-done" : pct >= 45 ? "" : "pill-warn"}">${pct}%</div>
          </div>`;
      })
      .join("");
  } catch (err) {
    verdict.textContent = "Check failed";
    subtext.textContent = err.message;
    number.textContent = "?";
  }
}

/* ---------------------------------------------------------------------
   CORRELATION HEATMAP + FEATURE IMPORTANCE
--------------------------------------------------------------------- */
function correlationColor(value) {
  // -1 (red) -> 0 (dark neutral) -> +1 (blue/teal)
  if (value >= 0) {
    const alpha = Math.abs(value);
    return `rgba(56, 189, 248, ${0.15 + alpha * 0.75})`;
  }
  const alpha = Math.abs(value);
  return `rgba(248, 113, 113, ${0.15 + alpha * 0.75})`;
}

function renderCorrelationHeatmap(correlation) {
  const wrap = document.getElementById("correlationHeatmap");
  if (!correlation || !correlation.columns || correlation.columns.length < 2) {
    wrap.innerHTML = '<p class="muted">Not enough numeric columns for a correlation heatmap.</p>';
    return;
  }

  const { columns, matrix } = correlation;
  let html = '<table class="heatmap-table"><thead><tr><th></th>';
  columns.forEach((c) => (html += `<th>${escapeHtml(c)}</th>`));
  html += "</tr></thead><tbody>";

  matrix.forEach((row, i) => {
    html += `<tr><th>${escapeHtml(columns[i])}</th>`;
    row.forEach((val) => {
      html += `<td><div class="heatmap-cell" style="background:${correlationColor(val)}; padding:6px 10px;">${val.toFixed(2)}</div></td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  wrap.innerHTML = html;
}

function renderFeatureImportance(importanceList) {
  const list = document.getElementById("featureImportanceList");
  if (!importanceList || importanceList.length === 0) {
    list.innerHTML = '<p class="muted">Feature importance needs a trained classifier — check the ML Dashboard above for status.</p>';
    return;
  }

  const maxImportance = Math.max(...importanceList.map((f) => f.importance));
  list.innerHTML = importanceList
    .map((f) => {
      const pct = maxImportance > 0 ? (f.importance / maxImportance) * 100 : 0;
      return `
        <div class="importance-row">
          <div class="importance-label" title="${escapeHtml(f.feature)}">${escapeHtml(f.feature)}</div>
          <div class="importance-bar-track"><div class="importance-bar-fill" style="width:${pct}%"></div></div>
          <div class="importance-pct">${(f.importance * 100).toFixed(1)}%</div>
        </div>`;
    })
    .join("");
}