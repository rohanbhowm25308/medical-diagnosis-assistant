/* =========================================================================
   advanced.js — the 15 new AI features. Loaded AFTER script.js on the same
   page (both are classic, non-module scripts), so top-level `let`/`const`/
   `function` names declared in script.js — API_BASE, fetchWithTimeout,
   chatWindow, chatInput, addBubble, sendChat, downloadReport, escapeHtml,
   pieChartInstance, barChartInstance, runFullAnalysis, micBtn — are all
   directly usable here as bare identifiers (classic scripts share one
   global scope). Nothing in this file redeclares those names; functions
   that need new behavior are intentionally reassigned (they're plain
   `function` bindings, which are writable).
========================================================================= */

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 50; // r=50 in the gauge SVGs

/* ---------------------------------------------------------------------
   12. AI LIVE NOTIFICATIONS (toasts)
--------------------------------------------------------------------- */
function showToast(message, type = "info") {
  const stack = document.getElementById("aiToastStack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `ai-toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.animation = "toast-out 0.3s ease forwards";
    setTimeout(() => el.remove(), 300);
  }, 5000);
}

/* ---------------------------------------------------------------------
   9. AI TALKING AVATAR
--------------------------------------------------------------------- */
let avatarHideTimer = null;
function avatarSay(text) {
  const bubble = document.getElementById("aiAvatarBubble");
  if (bubble) {
    bubble.textContent = "🤖 " + text;
    bubble.style.display = "block";
    clearTimeout(avatarHideTimer);
    avatarHideTimer = setTimeout(() => { bubble.style.display = "none"; }, 7000);
  }
  speak(text);
}
document.getElementById("aiAvatarFace")?.addEventListener("click", () => {
  avatarSay("Hi! I'm your AI assistant. Upload a CSV, PDF, or DOCX file and I'll walk you through the analysis.");
});

function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  try {
    window.speechSynthesis.cancel(); // don't stack overlapping utterances
    const utter = new SpeechSynthesisUtterance(text.replace(/[🤖📊💰⚠️🎯📈🏆👥🔎📄📽🧠✅🔊]/gu, ""));
    utter.rate = 1.02;
    window.speechSynthesis.speak(utter);
  } catch { /* speech synthesis not critical to functionality */ }
}

/* ---------------------------------------------------------------------
   14. AI ACHIEVEMENT SYSTEM
--------------------------------------------------------------------- */
const ACHIEVEMENTS = [
  { id: "dataset_explorer", icon: "🏆", title: "Dataset Explorer", desc: "Uploaded your first dataset" },
  { id: "ai_analyst", icon: "🏆", title: "AI Analyst", desc: "Ran a full AI analysis" },
  { id: "ml_master", icon: "🏆", title: "ML Master", desc: "Viewed AI Consultant insights" },
  { id: "chat_master", icon: "🏆", title: "Chat Master", desc: "Asked the AI assistant a question" },
  { id: "anomaly_hunter", icon: "🏆", title: "Anomaly Hunter", desc: "Used the anomaly explainer" },
  { id: "simulator_pro", icon: "🏆", title: "Simulator Pro", desc: "Ran the What-If Simulator" },
];
const ACHIEVEMENTS_KEY = "agentic_ai_achievements_v1";

function getUnlockedAchievements() {
  try { return JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY)) || []; }
  catch { return []; }
}

function unlockAchievement(id) {
  const unlocked = getUnlockedAchievements();
  if (unlocked.includes(id)) { renderAchievements(); return; }
  unlocked.push(id);
  localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(unlocked));
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (def) showToast(`🏆 Achievement unlocked: ${def.title}!`, "good");
  renderAchievements();
}

function renderAchievements() {
  const unlocked = getUnlockedAchievements();
  const countEl = document.getElementById("achievementCount");
  if (countEl) countEl.textContent = unlocked.length;
  const list = document.getElementById("achievementsList");
  if (!list) return;
  list.innerHTML = ACHIEVEMENTS.map((a) => {
    const isUnlocked = unlocked.includes(a.id);
    return `
      <div class="ai-achievement-item ${isUnlocked ? "unlocked" : ""}">
        <div class="ai-achievement-icon">${isUnlocked ? a.icon : "🔒"}</div>
        <div>
          <div style="font-weight:600;">${a.title}</div>
          <div class="muted" style="font-size:0.72rem;">${a.desc}</div>
        </div>
      </div>`;
  }).join("");
}
document.getElementById("achievementsToggle")?.addEventListener("click", () => {
  const list = document.getElementById("achievementsList");
  list.style.display = list.style.display === "none" ? "block" : "none";
});
renderAchievements();

/* ---------------------------------------------------------------------
   2. AI AUTO DASHBOARD — real A-to-Z process log, driven by CustomEvents
   dispatched from script.js's runFullAnalysis() at each real pipeline
   stage (ai:upload-clean-done, ai:analyze-done, ai:charts-done,
   ai:analysis-error), so every line reflects the actual result of that
   step instead of a fake timer.
--------------------------------------------------------------------- */
const LOADING_STEP_ORDER = ["cols", "clean", "train", "insights", "dash", "report"];

function markLoadingStep(stepKey, status) {
  const el = document.querySelector(`#aiLoadingSteps li[data-step="${stepKey}"]`);
  if (el) el.className = status; // "active" | "done"
}

function appendLogLine(text, tone = "info") {
  const log = document.getElementById("aiProcessLog");
  if (!log) return;
  const line = document.createElement("div");
  line.className = `log-line ${tone === "good" ? "good" : tone === "warn" ? "warn" : ""}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  line.textContent = `[${time}] ${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// These listeners are registered once and fire every time script.js's
// runFullAnalysis() reaches that stage, regardless of how it was triggered.
document.addEventListener("ai:upload-clean-done", (e) => {
  const steps = e.detail.steps || {};
  markLoadingStep("cols", "done");
  markLoadingStep("clean", "done");
  markLoadingStep("train", "active");
  appendLogLine(`✅ Columns detected and typed.`, "good");
  if (steps.missing_values) appendLogLine(`✅ Missing values: ${steps.missing_values.detail}`, "good");
  if (steps.duplicate_check) appendLogLine(`✅ Duplicates: ${steps.duplicate_check.detail}`, "good");
  if (steps.outlier_detection) appendLogLine(`✅ Outliers: ${steps.outlier_detection.detail}`, "good");
  if (steps.feature_engineering) appendLogLine(`✅ Feature engineering: ${steps.feature_engineering.detail}`, "good");
  appendLogLine(`🧠 Training K-Means, Decision Tree, and Random Forest...`);
});

document.addEventListener("ai:analyze-done", (e) => {
  const ml = e.detail;
  markLoadingStep("train", "done");
  markLoadingStep("insights", "active");
  appendLogLine(
    `✅ K-Means: ${ml.kmeans?.status === "done" ? `${ml.kmeans.clusters} clusters (silhouette ${ml.kmeans.silhouette})` : "skipped"}`,
    "good"
  );
  appendLogLine(`✅ Decision Tree accuracy: ${ml.decision_tree?.accuracy}%`, "good");
  appendLogLine(`✅ Random Forest accuracy: ${ml.random_forest?.accuracy}%`, "good");
  appendLogLine(`🏆 Best model: ${ml.best_model} (${ml.best_accuracy}%)`, "good");
  if (ml.feature_importance?.length) {
    appendLogLine(`✅ Top predictor: '${ml.feature_importance[0].feature}'`, "good");
  }
  appendLogLine(`📊 Generating dashboard charts...`);
});

document.addEventListener("ai:charts-done", () => {
  markLoadingStep("insights", "done");
  markLoadingStep("dash", "done");
  markLoadingStep("report", "active");
  appendLogLine(`✅ Charts rendered.`, "good");
  appendLogLine(`📝 Preparing AI consultant report, personas, and what-if simulator...`);
});

document.addEventListener("ai:analysis-error", (e) => {
  appendLogLine(`❌ ${e.detail.message}`, "warn");
});

async function runFullAnalysisWithOverlay() {
  document.getElementById("startAnalysisBtn").classList.remove("btn-ready-pulse");
  if (currentUploadType === "pdf" || currentUploadType === "docx") {
    return runDocumentAnalysisWithOverlay();
  }
  if (typeof hideDocIntelDashboard === "function") hideDocIntelDashboard();

  const overlay = document.getElementById("aiLoadingOverlay");
  const stepEls = Array.from(document.querySelectorAll("#aiLoadingSteps li"));
  const log = document.getElementById("aiProcessLog");
  overlay.style.display = "flex";
  stepEls.forEach((el) => (el.className = ""));
  log.innerHTML = "";
  markLoadingStep("cols", "active");
  appendLogLine("🚀 Starting AI pipeline...");

  try {
    await runFullAnalysis(); // defined in script.js — shared global scope, dispatches the events above
  } finally {
    if (document.getElementById("aiStatus").textContent === "Complete") {
      LOADING_STEP_ORDER.forEach((s) => markLoadingStep(s, "done"));
      appendLogLine("🎉 A-to-Z pipeline complete.", "good");
    }
    setTimeout(() => { overlay.style.display = "none"; }, 900);
  }

  if (document.getElementById("aiStatus").textContent !== "Complete") return;

  unlockAchievement("ai_analyst");
  showToast("🧠 AI analysis complete — building consultant insights...", "good");
  avatarSay("Analysis complete! I've generated insights, personas, and recommendations for you.");

  await Promise.all([loadConsultantData(), loadWhatifSchema()]);
  attachChartExplainers();
}
document.getElementById("startAnalysisBtn").onclick = runFullAnalysisWithOverlay;

/* ---------------------------------------------------------------------
   PDF/DOCX "Start AI Analysis" — same button, same overlay, but the
   pipeline is text extraction + AI summary instead of ML training.
   Populates the SAME AI Consultant section CSV analysis uses, and resets
   the CSV/ML-only widgets (gauges, recommendation cards, personas,
   what-if, executive summary) to an N/A state so nothing stale is shown.
--------------------------------------------------------------------- */
async function runDocumentAnalysisWithOverlay() {
  const overlay = document.getElementById("aiLoadingOverlay");
  const stepEls = Array.from(document.querySelectorAll("#aiLoadingSteps li"));
  const log = document.getElementById("aiProcessLog");
  const kindLabel = currentUploadType.toUpperCase();

  const docSteps = {
    cols: "Detecting File Type",
    clean: "Extracting Text",
    train: "Analyzing Content",
    insights: "Generating AI Summary",
    dash: "Formatting Results",
    report: "Preparing Report",
  };
  stepEls.forEach((el) => { el.textContent = docSteps[el.dataset.step]; el.className = ""; });

  overlay.style.display = "flex";
  log.innerHTML = "";
  markLoadingStep("cols", "done");
  markLoadingStep("clean", "active");
  appendLogLine(`🚀 Starting ${kindLabel} analysis pipeline...`);
  appendLogLine(`✅ File type detected: ${kindLabel}`, "good");

  const startBtn = document.getElementById("startAnalysisBtn");
  startBtn.disabled = true;
  document.getElementById("aiStatus").textContent = "Analyzing...";

  try {
    markLoadingStep("clean", "done");
    markLoadingStep("train", "active");
    appendLogLine("🧠 Reading through the document...");

    const res = await fetchWithTimeout(`${API_BASE}/api/document-summary`, {}, 90000);
    markLoadingStep("train", "done");
    markLoadingStep("insights", "active");

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Could not analyze the document.");
    }
    const data = await res.json();
    appendLogLine(`✅ Detected type: ${data.detected_type}`, "good");
    appendLogLine(`✅ ${data.word_count} words analyzed`, "good");
    if (data.ocr_used) {
      appendLogLine(`✅ OCR extraction confidence: ${data.extraction_confidence}%`, "good");
    }
    appendLogLine(`📝 Summary generated (${data.source === "ai" ? "AI" : "heuristic"}).`, "good");
    markLoadingStep("insights", "done");
    markLoadingStep("dash", "active");

    let quality = { score: data.extraction_confidence, grade: "Good", source: data.ocr_used ? "ocr" : "text" };
    try {
      const qRes = await fetchWithTimeout(`${API_BASE}/api/document-quality`, {}, 15000);
      if (qRes.ok) quality = await qRes.json();
    } catch { /* fall back to the estimate above */ }
    appendLogLine(`✅ Document quality score: ${quality.score}% (${quality.grade})`, "good");
    markLoadingStep("dash", "done");
    markLoadingStep("report", "done");
    appendLogLine("🎉 Document analysis complete.", "good");

    applyDocumentSummaryToUI(data, quality);
    if (typeof showDocIntelDashboard === "function") showDocIntelDashboard();
    document.getElementById("aiStatus").textContent = "Complete";
    updateLatestHistoryEntryAsDocument(data);

    unlockAchievement("ai_analyst");
    showToast(`🧠 ${kindLabel} summary ready.`, "good");
    avatarSay(`I've read through your ${kindLabel}! Check the AI Consultant section for the summary.`);
  } catch (err) {
    document.getElementById("aiStatus").textContent = "Error";
    appendLogLine(`❌ ${err.message}`, "warn");
    showToast(err.message, "warn");
  } finally {
    startBtn.disabled = false;
    setTimeout(() => { overlay.style.display = "none"; }, 900);
    // Restore CSV step labels for next time a CSV is analyzed.
    const csvLabels = {
      cols: "Detecting Columns", clean: "Cleaning Data", train: "Training Model",
      insights: "Finding Insights", dash: "Generating Dashboard", report: "Preparing Report",
    };
    stepEls.forEach((el) => { el.textContent = csvLabels[el.dataset.step]; });
  }
}

function applyDocumentSummaryToUI(data, quality) {
  // Insights list -> the document summary
  const heading = document.getElementById("consultantInsightsHeading");
  if (heading) heading.textContent = "📄 Document Summary";
  const lines = data.summary.split("\n").filter((l) => l.trim());
  document.getElementById("consultantInsights").innerHTML = lines.length
    ? lines.map((l) => `<li>${escapeHtml(l.replace(/^-\s*/, ""))}</li>`).join("")
    : `<li>${escapeHtml(data.summary)}</li>`;

  // Recommendation cards -> re-labeled as document facts (type + extraction method)
  document.getElementById("recommendationCards").innerHTML = `
    <div class="glass-card rec-card">
      <div class="rec-tag">Document Type</div>
      <div class="rec-icon">📄</div>
      <h5>${escapeHtml(data.detected_type)}</h5>
      <p>Detected automatically from the extracted content.</p>
    </div>
    <div class="glass-card rec-card">
      <div class="rec-tag">Extraction Method</div>
      <div class="rec-icon">${data.ocr_used ? "🔎" : "📝"}</div>
      <h5>${data.ocr_used ? "OCR (scanned/handwritten)" : "Selectable Text"}</h5>
      <p>${data.ocr_used
        ? "This file had image-only or handwritten pages — the AI read them with OCR."
        : "This file had real selectable text, extracted directly."}</p>
    </div>`;

  // Personas -> repurposed as "who this document is for" (#7's document equivalent)
  const audience = data.audience_personas || [];
  document.getElementById("personaCards").innerHTML = audience.length
    ? audience.map((a, i) => `
        <div class="glass-card persona-card">
          <div class="persona-avatar">${["🎓", "🧑‍🏫", "🧑‍💼", "🔬"][i % 4]}</div>
          <div class="persona-name">${escapeHtml(a.name)}</div>
          <div class="persona-row"><span>Why</span><span>${escapeHtml(a.desc)}</span></div>
          <div class="persona-badge">Likely Reader</div>
        </div>`).join("")
    : '<p class="muted">Could not infer a target audience for this document.</p>';

  // What-If Simulator -> repurposed as a quick follow-up question box (a
  // numeric "what if I change X" doesn't apply to free text, but an
  // interactive Q&A box does the same job: instant, specific answers).
  document.getElementById("whatifControls").innerHTML = `
    <p class="muted" style="margin-bottom:10px;">Ask a quick question about this document — same AI as the chat below, just handy right here.</p>
    <div class="whatif-field">
      <input type="text" id="whatifDocQuestion" placeholder='e.g. "What is recursion?" or "List the topics covered"'
             style="width:100%;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);color:var(--text);" />
    </div>
    <button class="btn btn-primary btn-sm" id="whatifDocAskBtn" style="margin-top:8px;">🔮 Ask</button>`;
  document.getElementById("whatifDocAskBtn").onclick = runDocumentWhatIf;
  document.getElementById("whatifDocQuestion").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runDocumentWhatIf();
  });
  document.getElementById("whatifClass").textContent = "--";
  document.getElementById("whatifConfidence").textContent = "Ask a question to see the answer here";
  document.getElementById("whatifCluster").textContent = "";
  document.getElementById("whatifClusterPct").textContent = "";

  // Health gauge -> repurposed as Document Quality Score (#6's document
  // equivalent), based on real extraction signal, not a fake number.
  setGauge("healthGaugeFill", "healthGaugeLabel", quality.score);
  document.getElementById("healthGaugeGrade").textContent = `${quality.grade} (${quality.source === "ocr" ? "OCR" : "text"} extraction)`;

  // Confidence gauge -> repurposed as extraction confidence (OCR confidence
  // when OCR was used, else a high fixed value for clean text extraction).
  setGauge("confidenceGaugeFill", "confidenceGaugeLabel", data.extraction_confidence);

  // Executive summary -> document-level facts
  document.getElementById("execSummaryGrid").innerHTML = `
    <div class="exec-item"><div class="exec-value">${escapeHtml(data.detected_type)}</div><div class="exec-label">Detected Type</div></div>
    <div class="exec-item"><div class="exec-value">${data.word_count.toLocaleString()}</div><div class="exec-label">Words Extracted</div></div>
    <div class="exec-item"><div class="exec-value">${data.ocr_used ? "OCR" : "Text"}</div><div class="exec-label">Extraction Method</div></div>
    <div class="exec-item"><div class="exec-value">${quality.score}%</div><div class="exec-label">Extraction Quality</div></div>
  `;

  document.getElementById("consultant").scrollIntoView({ behavior: "smooth" });
}

async function runDocumentWhatIf() {
  const input = document.getElementById("whatifDocQuestion");
  const question = input.value.trim();
  if (!question) return;
  document.getElementById("whatifClass").textContent = "...";
  document.getElementById("whatifConfidence").textContent = "Thinking...";
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/document-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }, 90000);
    const data = await res.json();
    if (!res.ok) {
      document.getElementById("whatifClass").textContent = "--";
      document.getElementById("whatifConfidence").textContent = data.detail || "Something went wrong.";
      return;
    }
    document.getElementById("whatifClass").textContent = "✅ Answered";
    document.getElementById("whatifConfidence").textContent = data.answer;
    unlockAchievement("simulator_pro");
  } catch (err) {
    document.getElementById("whatifClass").textContent = "--";
    document.getElementById("whatifConfidence").textContent = err.message || "Could not reach the backend.";
  }
}

/* ---------------------------------------------------------------------
   Upload -> achievement + type-appropriate follow-up, as soon as the
   file is ready. Fires for CSV, PDF, and DOCX alike (same input element),
   branching on currentUploadType (set by script.js's upload handlers).
--------------------------------------------------------------------- */
document.addEventListener("ai:document-upload-done", (e) => {
  const data = e.detail;
  if (data.ocr_used) {
    showToast(`🔎 OCR extracted text from scanned/handwritten pages (${data.ocr_confidence}% confidence).`, "good");
    avatarSay(`This looked like scanned or handwritten pages, so I used OCR to read it — got ${data.ocr_confidence}% confidence!`);
  }
  if (data.ocr_truncated) {
    showToast("⚠️ This PDF is long — only the first batch of image-only pages were OCR'd.", "warn");
  }
});

document.getElementById("csvInput").addEventListener("change", () => {
  waitForDatasetReady().then((ready) => {
    if (!ready) return;
    unlockAchievement("dataset_explorer");

    if (currentUploadType === "csv") {
      showToast("📦 Dataset uploaded — AI is ready to analyze.", "good");
      avatarSay('Dataset uploaded! Click "Start AI Analysis" whenever you\'re ready.');
      loadHealthScore();
      resetSmartSearch();
    } else {
      const label = currentUploadType.toUpperCase();
      showToast(`📄 ${label} uploaded — AI is ready to summarize it.`, "good");
      avatarSay(`Got your ${label}! Click "Start AI Analysis" and I'll summarize it for you.`);
    }
  });
});

function waitForDatasetReady(maxAttempts = 40) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      if (document.getElementById("statDataset").textContent === "Ready") return resolve(true);
      if (attempts >= maxAttempts) return resolve(false);
      setTimeout(check, 400);
    };
    check();
  });
}

async function loadHealthScore() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/health-score`, {}, 20000);
    if (!res.ok) return;
    const data = await res.json();
    setGauge("healthGaugeFill", "healthGaugeLabel", data.score);
    document.getElementById("healthGaugeGrade").textContent = data.grade;
  } catch { /* non-critical */ }
}

function resetSmartSearch() {
  document.getElementById("smartSearchResultWrap").style.display = "none";
  document.getElementById("smartSearchNote").style.display = "none";
}

/* ---------------------------------------------------------------------
   Gauge helper — shared by the Health Score (#6) and AI Confidence
   Meter (#13)
--------------------------------------------------------------------- */
function setGauge(fillId, labelId, pct) {
  const fill = document.getElementById(fillId);
  const label = document.getElementById(labelId);
  const clamped = Math.max(0, Math.min(100, pct || 0));
  if (fill) fill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE * (1 - clamped / 100);
  if (label) label.textContent = `${Math.round(clamped)}%`;
}

/* ---------------------------------------------------------------------
   1/5/6/7/13/15. AI CONSULTANT — insights, recommendation cards,
   health + confidence gauges, executive summary, personas
--------------------------------------------------------------------- */
async function loadConsultantData() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/ai-consultant`, {}, 30000);
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById("consultantInsightsHeading").textContent = "📊 Top Insights";

    // Insights (#1)
    document.getElementById("consultantInsights").innerHTML = data.insights
      .map((i) => `<li>💡 ${escapeHtml(i)}</li>`)
      .join("");

    // Recommendation cards (#5)
    document.getElementById("recommendationCards").innerHTML = data.recommendation_cards
      .map((c) => `
        <div class="glass-card rec-card">
          <div class="rec-tag">${escapeHtml(c.tag)}</div>
          <div class="rec-icon">${c.icon}</div>
          <h5>${escapeHtml(c.title)}</h5>
          <p>${escapeHtml(c.body)}</p>
        </div>`)
      .join("");

    // Health gauge (#6)
    setGauge("healthGaugeFill", "healthGaugeLabel", data.health.score);
    document.getElementById("healthGaugeGrade").textContent = data.health.grade;

    // Confidence gauge (#13) — reuses the accuracy already computed by analyze
    const confText = document.getElementById("aiConfidence").textContent.replace("%", "");
    setGauge("confidenceGaugeFill", "confidenceGaugeLabel", parseFloat(confText) || 0);

    // Executive summary (#15)
    const ex = data.executive_summary;
    document.getElementById("execSummaryGrid").innerHTML = `
      <div class="exec-item"><div class="exec-value">${ex.business_score}/100</div><div class="exec-label">Business Score</div></div>
      <div class="exec-item"><div class="exec-value">${escapeHtml(ex.revenue_risk)}</div><div class="exec-label">Revenue Risk</div></div>
      <div class="exec-item"><div class="exec-value">${escapeHtml(ex.customer_satisfaction)}</div><div class="exec-label">Customer Satisfaction</div></div>
      <div class="exec-item"><div class="exec-value">${escapeHtml(ex.growth_opportunity)}</div><div class="exec-label">Growth Opportunity</div></div>
      <div class="exec-action" style="grid-column: 1 / -1;">🎯 Recommended Action: ${escapeHtml(ex.recommended_action)}</div>
    `;

    // Personas (#7)
    document.getElementById("personaCards").innerHTML = data.personas.length
      ? data.personas.map((p) => `
          <div class="glass-card persona-card">
            <div class="persona-avatar">${p.avatar}</div>
            <div class="persona-name">${escapeHtml(p.name)}</div>
            ${p.age != null ? `<div class="persona-row"><span>Age</span><span>${escapeHtml(String(p.age))}</span></div>` : ""}
            ${p.income != null ? `<div class="persona-row"><span>Income</span><span>${escapeHtml(String(p.income))}</span></div>` : ""}
            ${p.traits.map((t) => `<div class="persona-row"><span>Trait</span><span>${escapeHtml(t)}</span></div>`).join("")}
            <div class="persona-row"><span>Segment size</span><span>${p.segment_pct}%</span></div>
            <div class="persona-badge">${escapeHtml(p.prediction)}</div>
          </div>`).join("")
      : '<p class="muted">Not enough numeric data to generate personas.</p>';

    unlockAchievement("ml_master");
  } catch (err) {
    showToast("Couldn't load AI Consultant insights.", "warn");
  }
}

/* ---------------------------------------------------------------------
   8. AI WHAT-IF SIMULATOR
--------------------------------------------------------------------- */
let whatifFieldDefs = [];

async function loadWhatifSchema() {
  const controls = document.getElementById("whatifControls");
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/whatif/schema`, {}, 20000);
    if (!res.ok) {
      controls.innerHTML = '<p class="muted">Not enough trained model data for the simulator on this dataset.</p>';
      return;
    }
    const data = await res.json();
    whatifFieldDefs = data.fields;

    if (!whatifFieldDefs.length) {
      controls.innerHTML = '<p class="muted">No usable features found for simulation.</p>';
      return;
    }

    controls.innerHTML = whatifFieldDefs.map((f) => {
      if (f.type === "numeric") {
        const mid = f.mean;
        return `
          <div class="whatif-field">
            <label>${escapeHtml(f.name)} <span id="whatifVal_${escapeAttr(f.name)}">${mid}</span></label>
            <input type="range" min="${f.min}" max="${f.max}" step="${((f.max - f.min) / 100) || 1}"
                   value="${mid}" data-field="${escapeAttr(f.name)}" class="whatif-range" />
          </div>`;
      }
      return `
        <div class="whatif-field">
          <label>${escapeHtml(f.name)}</label>
          <select data-field="${escapeAttr(f.name)}" class="whatif-select">
            ${f.options.map((o) => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join("")}
          </select>
        </div>`;
    }).join("") + `<button class="btn btn-primary btn-sm" id="whatifPredictBtn" style="margin-top:8px;">🔮 Predict</button>`;

    controls.querySelectorAll(".whatif-range").forEach((input) => {
      input.addEventListener("input", () => {
        document.getElementById(`whatifVal_${cssEscape(input.dataset.field)}`).textContent = input.value;
      });
    });
    document.getElementById("whatifPredictBtn").onclick = runWhatIf;
  } catch (err) {
    controls.innerHTML = `<p class="muted">${escapeHtml(err.message || "Could not load the simulator.")}</p>`;
  }
}

async function runWhatIf() {
  const values = {};
  document.querySelectorAll("#whatifControls [data-field]").forEach((el) => {
    values[el.dataset.field] = el.value;
  });
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/whatif`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    }, 20000);
    if (!res.ok) { showToast("What-If prediction failed.", "warn"); return; }
    const data = await res.json();

    if (data.predicted_class !== undefined) {
      document.getElementById("whatifClass").textContent = data.predicted_class;
      document.getElementById("whatifConfidence").textContent =
        `${data.class_probability}% confidence (${data.confidence_label}) for "${data.target_column}"`;
    }
    if (data.cluster_tier !== undefined) {
      document.getElementById("whatifCluster").textContent = data.cluster_tier;
      document.getElementById("whatifClusterPct").textContent =
        data.cluster_pct_of_total != null ? `${data.cluster_pct_of_total}% of customers are in this segment` : "";
    }
    unlockAchievement("simulator_pro");
  } catch (err) {
    showToast(err.message || "Could not reach the backend for What-If prediction.", "warn");
  }
}

function escapeAttr(str) { return String(str).replace(/"/g, "&quot;"); }
function cssEscape(str) { return String(str).replace(/[^a-zA-Z0-9_-]/g, "_"); }

/* ---------------------------------------------------------------------
   11. AI SMART SEARCH
--------------------------------------------------------------------- */
async function runSmartSearch() {
  const query = document.getElementById("smartSearchInput").value.trim();
  if (!query) return;
  const noteEl = document.getElementById("smartSearchNote");
  const wrap = document.getElementById("smartSearchResultWrap");
  noteEl.style.display = "block";
  noteEl.textContent = "🔎 Searching...";

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/smart-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }, 20000);
    if (!res.ok) {
      noteEl.textContent = (await res.json()).detail || "Search failed.";
      wrap.style.display = "none";
      return;
    }
    const data = await res.json();
    noteEl.textContent = `🤖 ${data.note} — ${data.matched_rows} row(s) shown.`;

    const thead = document.querySelector("#smartSearchTable thead");
    const tbody = document.querySelector("#smartSearchTable tbody");
    thead.innerHTML = `<tr>${data.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
    tbody.innerHTML = data.rows
      .map((r) => `<tr>${data.columns.map((c) => `<td>${r[c] ?? ""}</td>`).join("")}</tr>`)
      .join("");
    wrap.style.display = "block";
  } catch (err) {
    noteEl.textContent = err.message || "Could not reach the backend for smart search.";
    wrap.style.display = "none";
  }
}
document.getElementById("smartSearchBtn").onclick = runSmartSearch;
document.getElementById("smartSearchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSmartSearch();
});

/* ---------------------------------------------------------------------
   4. AI EXPLAIN CHARTS — click a pie slice or bar to get a plain-English
   explanation, generated entirely client-side from the chart's own data.
--------------------------------------------------------------------- */
function attachChartExplainers() {
  if (typeof pieChartInstance !== "undefined" && pieChartInstance) {
    pieChartInstance.options.onClick = (evt, elements) => {
      if (!elements.length) return;
      explainChartSegment(pieChartInstance, elements[0].index, "pieExplain");
    };
    pieChartInstance.canvas.style.cursor = "pointer";
    pieChartInstance.update("none");
  }
  if (typeof barChartInstance !== "undefined" && barChartInstance) {
    barChartInstance.options.onClick = (evt, elements) => {
      if (!elements.length) return;
      explainChartSegment(barChartInstance, elements[0].index, "barExplain");
    };
    barChartInstance.canvas.style.cursor = "pointer";
    barChartInstance.update("none");
  }
}

function explainChartSegment(chart, index, targetElId) {
  const dataset = chart.data.datasets[0];
  const labels = chart.data.labels;
  const values = dataset.data;
  const label = labels[index];
  const value = values[index];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const pct = ((value / total) * 100).toFixed(1);

  let maxIdx = 0;
  values.forEach((v, i) => { if (v > values[maxIdx]) maxIdx = i; });

  let text = `"${label}" accounts for ${pct}% of this breakdown (${value} of ${total}).`;
  if (maxIdx !== index) {
    const maxPct = ((values[maxIdx] / total) * 100).toFixed(1);
    text += ` The largest group is "${labels[maxIdx]}" at ${maxPct}%.`;
  } else {
    text += ` This is the largest group in the chart.`;
  }

  const el = document.getElementById(targetElId);
  if (el) el.textContent = "🤖 " + text;
  avatarSay(text);
}

/* ---------------------------------------------------------------------
   10. AI AUTO PRESENTATION GENERATOR
--------------------------------------------------------------------- */
async function downloadPresentation() {
  if (currentUploadType !== "csv") {
    showToast("The PPTX presentation is generated from CSV analysis only — upload a CSV to use this.", "warn");
    return;
  }
  const btn = document.getElementById("presentationBtn");
  const original = btn.textContent;
  btn.textContent = "Generating...";
  btn.disabled = true;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/presentation`, {}, 30000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Could not generate presentation. Run AI Analysis first.");
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    a.download = match ? match[1] : "AI_Presentation.pptx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast("📽 Presentation downloaded.", "good");
  } catch (err) {
    showToast(err.message, "warn");
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}
document.getElementById("presentationBtn").onclick = downloadPresentation;

/* ---------------------------------------------------------------------
   3. AI VOICE ASSISTANT — replaces script.js's plain "fill the text box"
   mic handler with one that understands a few spoken commands and
   auto-sends everything else. Also adds spoken replies (feature #9/#3
   overlap: the avatar + voice-reply toggle both use speak()).
--------------------------------------------------------------------- */
const AdvSpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
if (AdvSpeechRecognitionAPI && micBtn) {
  const advRecognition = new AdvSpeechRecognitionAPI();
  advRecognition.lang = "en-US";
  advRecognition.interimResults = false;
  advRecognition.maxAlternatives = 1;
  let advListening = false;

  advRecognition.onstart = () => {
    advListening = true;
    micBtn.classList.add("listening");
    micBtn.textContent = "🔴";
  };
  advRecognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    chatInput.value = transcript;
    handleVoiceCommand(transcript);
  };
  advRecognition.onerror = () => {
    addBubble("Couldn't hear that clearly — try again or type your question.", "bot");
  };
  advRecognition.onend = () => {
    advListening = false;
    micBtn.classList.remove("listening");
    micBtn.textContent = "🎤";
  };
  micBtn.onclick = () => { advListening ? advRecognition.stop() : advRecognition.start(); };
}

function handleVoiceCommand(transcript) {
  const t = transcript.toLowerCase();

  if (t.includes("generate report") || t.includes("download report")) {
    addBubble(transcript, "user"); chatInput.value = "";
    addBubble("📄 Generating your AI report now...", "bot");
    downloadReport();
    return;
  }
  if (t.includes("presentation") || t.includes("powerpoint") || t.includes("slides")) {
    addBubble(transcript, "user"); chatInput.value = "";
    addBubble("📽 Generating your AI presentation now...", "bot");
    downloadPresentation();
    return;
  }
  if (t.includes("segmentation") || t.includes("segments") || t.includes("clusters") || t.includes("personas")) {
    addBubble(transcript, "user"); chatInput.value = "";
    addBubble("👥 Here's your customer segmentation.", "bot");
    document.getElementById("consultant").scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (t.includes("analyze") && (t.includes("dataset") || t.includes("data"))) {
    addBubble(transcript, "user"); chatInput.value = "";
    addBubble("🧠 Starting AI analysis...", "bot");
    document.getElementById("startAnalysisBtn").click();
    return;
  }
  if (t.includes("health score") || t.includes("data quality")) {
    addBubble(transcript, "user"); chatInput.value = "";
    addBubble("💚 Here's the dataset health score.", "bot");
    document.getElementById("consultant").scrollIntoView({ behavior: "smooth" });
    return;
  }

  sendChat(); // default: treat it as a normal question for the agent
}

/* Wrap sendChat (a plain top-level `function` in script.js, so it's
   reassignable) to track the Chat Master achievement without touching
   script.js itself. */
const _originalSendChat = sendChat;
sendChat = async function () {
  if (chatInput.value.trim()) unlockAchievement("chat_master");
  return _originalSendChat();
};

/* Wrap addBubble so bot replies are spoken aloud when the "Voice replies"
   toggle is checked — covers chat answers, anomaly explanations, etc. */
const _originalAddBubble = addBubble;
addBubble = function (text, cls) {
  const el = _originalAddBubble(text, cls);
  const toggle = document.getElementById("voiceReplyToggle");
  if (cls === "bot" && toggle?.checked && text && text !== "Thinking...") {
    speak(text);
  }
  return el;
};

/* Track the Anomaly Hunter achievement without touching script.js. */
const _explainAnomalyBtn = document.getElementById("explainAnomalyBtn");
const _originalAnomalyHandler = _explainAnomalyBtn.onclick;
_explainAnomalyBtn.onclick = function (e) {
  unlockAchievement("anomaly_hunter");
  return _originalAnomalyHandler.call(this, e);
};

