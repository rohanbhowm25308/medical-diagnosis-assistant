/* =========================================================================
   doc-intel.js — the AI Document Intelligence Dashboard (Summary, Key Info,
   Sections, Notes, Quiz, Compare, Score). Loaded after advanced.js, shares
   the same global scope as script.js/advanced.js (classic scripts), so
   API_BASE, fetchWithTimeout, escapeHtml, showToast, avatarSay, and
   currentUploadType are all directly usable here without importing.
========================================================================= */

let docIntelLoadedTabs = new Set(); // which tabs have already fetched their data this session
let docIntelActiveQuiz = null;      // { questions, qtype, currentIndex, score }

/* ---------------------------------------------------------------------
   Tab switching
--------------------------------------------------------------------- */
document.querySelectorAll(".doc-intel-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".doc-intel-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".doc-intel-panel").forEach((p) => (p.style.display = "none"));
    document.getElementById(`docIntelPanel-${tab}`).style.display = "block";

    if (!docIntelLoadedTabs.has(tab)) {
      docIntelLoadedTabs.add(tab);
      loadDocIntelTab(tab);
    }
  });
});

function loadDocIntelTab(tab) {
  if (tab === "summary") loadDocIntelSummary();
  else if (tab === "entities") loadDocIntelEntities();
  else if (tab === "sections") loadDocIntelSections();
  else if (tab === "notes") loadDocIntelNotes();
  else if (tab === "score") loadDocIntelScore();
  // "quiz" and "compare" are user-triggered (buttons), not auto-loaded on tab open
}

/* Called from advanced.js's runDocumentAnalysisWithOverlay once analysis
   completes, so the dashboard appears and the Summary tab (the default
   active one) loads immediately without waiting for a click. */
function showDocIntelDashboard() {
  document.getElementById("docIntel").style.display = "block";
  docIntelLoadedTabs = new Set(); // fresh document -> old tab data is stale, force reload on next view
  document.querySelectorAll(".doc-intel-tab").forEach((b) => b.classList.remove("active"));
  document.querySelector('.doc-intel-tab[data-tab="summary"]').classList.add("active");
  document.querySelectorAll(".doc-intel-panel").forEach((p) => (p.style.display = "none"));
  document.getElementById("docIntelPanel-summary").style.display = "block";
  docIntelLoadedTabs.add("summary");
  loadDocIntelSummary();

  // Reset panels that depend on per-document state
  document.getElementById("docQuizArea").innerHTML = '<p class="muted">Choose a type and click "Generate Quiz".</p>';
  document.getElementById("docCompareArea").innerHTML = "";
  document.getElementById("docCompareStatus").textContent = "";
  docIntelActiveQuiz = null;
}

function hideDocIntelDashboard() {
  document.getElementById("docIntel").style.display = "none";
}

/* ---------------------------------------------------------------------
   1. AI Document Summary
--------------------------------------------------------------------- */
async function loadDocIntelSummary() {
  const panel = document.getElementById("docIntelPanel-summary");
  panel.innerHTML = '<p class="muted">🧠 Generating summary...</p>';
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/document-intel/summary`, {}, 90000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.detail || "Could not generate summary.")}</p>`;
      return;
    }
    const data = await res.json();
    const block = (title, content, isList) => {
      if (!content || (Array.isArray(content) && content.length === 0)) {
        return `<div class="doc-summary-block empty"><h5>${title}</h5><p>Not identified in this document.</p></div>`;
      }
      const body = isList
        ? `<ul>${content.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
        : `<p>${escapeHtml(content)}</p>`;
      return `<div class="doc-summary-block"><h5>${title}</h5>${body}</div>`;
    };
    panel.innerHTML = `
      <div class="doc-summary-grid">
        ${block("📄 Executive Summary", data.executive_summary, false)}
        ${block("🎯 Main Purpose", data.main_purpose, false)}
        ${block("🔑 Key Points", data.key_points, true)}
        ${block("⚠️ Important Information", data.important_information, true)}
        ${block("📌 Action Items", data.action_items, true)}
      </div>`;
  } catch (err) {
    panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.message || "Could not reach the backend.")}</p>`;
  }
}

/* ---------------------------------------------------------------------
   3. AI Key Information Extraction
--------------------------------------------------------------------- */
async function loadDocIntelEntities() {
  const panel = document.getElementById("docIntelPanel-entities");
  panel.innerHTML = '<p class="muted">🔍 Extracting key information...</p>';
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/document-intel/entities`, {}, 90000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.detail || "Could not extract entities.")}</p>`;
      return;
    }
    const data = await res.json();
    const cards = [
      { key: "people", icon: "👤", label: "People" },
      { key: "organizations", icon: "🏢", label: "Organizations" },
      { key: "dates", icon: "📅", label: "Important Dates" },
      { key: "monetary_values", icon: "💰", label: "Monetary Values" },
      { key: "locations", icon: "📍", label: "Locations" },
      { key: "references", icon: "🔗", label: "References" },
    ];
    panel.innerHTML = `<div class="doc-entity-grid">${cards.map((c) => {
      const items = data.entities[c.key] || [];
      return `
        <div class="doc-entity-card">
          <div class="entity-header">
            <span><span class="entity-icon">${c.icon}</span> <span class="entity-label">${c.label}</span></span>
            <span class="entity-count">${data.counts[c.key] || 0}</span>
          </div>
          ${items.length ? `<ul>${items.map((i) => `<li>${escapeHtml(String(i))}</li>`).join("")}</ul>` : '<p class="muted" style="font-size:0.8rem;">None found</p>'}
        </div>`;
    }).join("")}</div>`;
  } catch (err) {
    panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.message || "Could not reach the backend.")}</p>`;
  }
}

/* ---------------------------------------------------------------------
   4. Smart Document Navigation (sections)
--------------------------------------------------------------------- */
async function loadDocIntelSections() {
  const panel = document.getElementById("docIntelPanel-sections");
  panel.innerHTML = '<p class="muted">📑 Detecting sections...</p>';
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/document-intel/sections`, {}, 90000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.detail || "Could not detect sections.")}</p>`;
      return;
    }
    const data = await res.json();
    if (!data.sections.length) {
      panel.innerHTML = '<p class="muted">No distinct sections were detected in this document.</p>';
      return;
    }
    panel.innerHTML = `<div class="doc-section-list">${data.sections.map((s, i) => `
      <div class="doc-section-item" data-idx="${i}">
        <span class="section-num">${String(i + 1).padStart(2, "0")}</span>
        <span class="section-title">${escapeHtml(s.title)}</span>
        <div class="section-preview">${escapeHtml(s.preview || "No preview available.")}</div>
      </div>`).join("")}</div>`;
    panel.querySelectorAll(".doc-section-item").forEach((item) => {
      item.addEventListener("click", () => item.classList.toggle("expanded"));
    });
  } catch (err) {
    panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.message || "Could not reach the backend.")}</p>`;
  }
}

/* ---------------------------------------------------------------------
   6. AI Notes Generator
--------------------------------------------------------------------- */
async function loadDocIntelNotes() {
  const panel = document.getElementById("docIntelPanel-notes");
  panel.innerHTML = '<p class="muted">📝 Generating notes...</p>';
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/document-intel/notes`, {}, 90000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.detail || "Could not generate notes.")}</p>`;
      return;
    }
    const data = await res.json();
    const concepts = (data.concepts || []).map((c) => `<span class="doc-concept-pill">${escapeHtml(c)}</span>`).join("");
    const takeaways = (data.key_takeaways || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    const questions = (data.possible_questions || []).map((q) => `<li>${escapeHtml(q)}</li>`).join("");
    panel.innerHTML = `
      <div class="doc-notes-grid">
        <div class="doc-summary-block"><h5>📚 Important Concepts</h5><div>${concepts || '<p class="muted">None identified.</p>'}</div></div>
        <div class="doc-summary-block"><h5>⭐ Key Takeaways</h5><ul>${takeaways || '<li class="muted">None identified.</li>'}</ul></div>
        <div class="doc-summary-block"><h5>❓ Possible Questions</h5><ul>${questions || '<li class="muted">None generated.</li>'}</ul></div>
      </div>`;
  } catch (err) {
    panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.message || "Could not reach the backend.")}</p>`;
  }
}

/* ---------------------------------------------------------------------
   7. AI Quiz Generator (interactive)
--------------------------------------------------------------------- */
document.getElementById("docQuizGenerateBtn")?.addEventListener("click", async () => {
  const qtype = document.getElementById("docQuizType").value;
  const count = parseInt(document.getElementById("docQuizCount").value, 10);
  const area = document.getElementById("docQuizArea");
  area.innerHTML = '<p class="muted">🎯 Generating quiz...</p>';

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/document-intel/quiz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, qtype }),
    }, 120000); // heaviest LLM call here — generating multiple structured questions takes longer
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      area.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.detail || "Could not generate quiz.")}</p>`;
      return;
    }
    const data = await res.json();
    if (!data.questions || !data.questions.length) {
      area.innerHTML = '<p class="muted">Could not generate any questions from this document.</p>';
      return;
    }
    docIntelActiveQuiz = { questions: data.questions, qtype: data.qtype, currentIndex: 0, score: 0, answered: [] };
    renderQuizQuestion(area);
    unlockAchievement("simulator_pro"); // reuses the existing "hands-on interactive feature" achievement
  } catch (err) {
    area.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.message || "Could not reach the backend.")}</p>`;
  }
});

function renderQuizQuestion(area) {
  const quiz = docIntelActiveQuiz;
  if (quiz.currentIndex >= quiz.questions.length) {
    renderQuizResults(area);
    return;
  }
  const q = quiz.questions[quiz.currentIndex];
  const progress = `Question ${quiz.currentIndex + 1} of ${quiz.questions.length}`;

  if (quiz.qtype === "mcq") {
    area.innerHTML = `
      <div class="doc-quiz-question">
        <p class="muted" style="font-size:0.78rem;">${progress}</p>
        <div class="quiz-q-title">${escapeHtml(q.question)}</div>
        ${q.options.map((opt, i) => `<button class="doc-quiz-option" data-idx="${i}">${escapeHtml(opt)}</button>`).join("")}
        <div class="doc-quiz-explanation" id="docQuizExplain" style="display:none;"></div>
      </div>`;
    area.querySelectorAll(".doc-quiz-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (quiz.answered[quiz.currentIndex] !== undefined) return; // already answered
        const chosen = parseInt(btn.dataset.idx, 10);
        quiz.answered[quiz.currentIndex] = chosen;
        const correct = chosen === q.correct_index;
        if (correct) quiz.score++;
        area.querySelectorAll(".doc-quiz-option").forEach((b, i) => {
          b.disabled = true;
          if (i === q.correct_index) b.classList.add("correct");
          else if (i === chosen) b.classList.add("incorrect");
        });
        const explainEl = document.getElementById("docQuizExplain");
        explainEl.style.display = "block";
        explainEl.textContent = `${correct ? "✅ Correct!" : "❌ Not quite."} ${q.explanation || ""}`;
        setTimeout(() => {
          quiz.currentIndex++;
          renderQuizQuestion(area);
        }, 1600);
      });
    });
  } else {
    area.innerHTML = `
      <div class="doc-quiz-question doc-quiz-shortanswer">
        <p class="muted" style="font-size:0.78rem;">${progress}</p>
        <div class="quiz-q-title">${escapeHtml(q.question)}</div>
        <textarea placeholder="Type your answer here (optional) — then reveal the sample answer..."></textarea>
        <button class="btn btn-outline btn-sm mt" id="docQuizRevealBtn">Show Sample Answer</button>
        <div class="doc-quiz-sample" id="docQuizSample">${escapeHtml(q.sample_answer || "")}</div>
        <button class="btn btn-primary btn-sm mt" id="docQuizNextBtn">Next Question →</button>
      </div>`;
    document.getElementById("docQuizRevealBtn").addEventListener("click", () => {
      document.getElementById("docQuizSample").style.display = "block";
    });
    document.getElementById("docQuizNextBtn").addEventListener("click", () => {
      quiz.currentIndex++;
      renderQuizQuestion(area);
    });
  }
}

function renderQuizResults(area) {
  const quiz = docIntelActiveQuiz;
  if (quiz.qtype === "mcq") {
    const pct = Math.round((quiz.score / quiz.questions.length) * 100);
    area.innerHTML = `
      <div class="doc-quiz-score">
        <div class="score-value">${quiz.score}/${quiz.questions.length}</div>
        <p class="muted">${pct}% correct</p>
        <button class="btn btn-outline btn-sm mt" id="docQuizRetryBtn">Generate a New Quiz</button>
      </div>`;
  } else {
    area.innerHTML = `
      <div class="doc-quiz-score">
        <div class="score-value">✅</div>
        <p class="muted">You've gone through all ${quiz.questions.length} questions.</p>
        <button class="btn btn-outline btn-sm mt" id="docQuizRetryBtn">Generate a New Quiz</button>
      </div>`;
  }
  document.getElementById("docQuizRetryBtn").addEventListener("click", () => {
    area.innerHTML = '<p class="muted">Choose a type and click "Generate Quiz".</p>';
    docIntelActiveQuiz = null;
  });
}

/* ---------------------------------------------------------------------
   5. Document Comparison
--------------------------------------------------------------------- */
document.getElementById("docCompareUploadBtn")?.addEventListener("click", () => {
  document.getElementById("docCompareInput").click();
});

document.getElementById("docCompareInput")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("docCompareStatus");
  const area = document.getElementById("docCompareArea");
  statusEl.textContent = "Uploading & reading Document B...";
  area.innerHTML = "";

  const formData = new FormData();
  formData.append("file", file, file.name);

  try {
    const uploadRes = await fetchWithTimeout(`${API_BASE}/api/document-intel/upload-compare`, {
      method: "POST", body: formData,
    }, 300000);
    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      statusEl.textContent = "";
      area.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.detail || "Upload failed.")}</p>`;
      return;
    }
    const uploadData = await uploadRes.json();
    statusEl.textContent = `Comparing with ${uploadData.filename}...`;

    const cmpRes = await fetchWithTimeout(`${API_BASE}/api/document-intel/compare`, {}, 90000);
    statusEl.textContent = "";
    if (!cmpRes.ok) {
      const err = await cmpRes.json().catch(() => ({}));
      area.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.detail || "Comparison failed.")}</p>`;
      return;
    }
    const data = await cmpRes.json();
    renderCompareResults(area, data);
    showToast("🔄 Document comparison ready.", "good");
  } catch (err) {
    statusEl.textContent = "";
    area.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.message || "Could not reach the backend.")}</p>`;
  } finally {
    e.target.value = "";
  }
});

function renderCompareResults(area, data) {
  const d = data.diff;
  const summaryBlock = data.ai_summary
    ? `<div class="doc-summary-block mt"><h5>🧠 AI Summary of Changes</h5><p>${escapeHtml(data.ai_summary)}</p></div>`
    : "";
  const changedBlock = d.changed.length
    ? `<div class="mt"><h5>Changed</h5>${d.changed.map((c) => `
        <div class="doc-compare-changed-item">
          <div class="before">${escapeHtml(c.before)}</div>
          <div class="after">${escapeHtml(c.after)}</div>
        </div>`).join("")}</div>`
    : "";
  area.innerHTML = `
    <p class="muted">Comparing <strong>${escapeHtml(data.document_a || "Document A")}</strong> ↔
    <strong>${escapeHtml(data.document_b || "Document B")}</strong></p>
    ${summaryBlock}
    <div class="doc-compare-columns mt">
      <div class="doc-compare-col added">
        <h5>➕ Added (${d.added.length})</h5>
        ${d.added.length ? d.added.map((a) => `<div class="doc-compare-item">${escapeHtml(a)}</div>`).join("") : '<p class="muted" style="font-size:0.8rem;">Nothing new.</p>'}
      </div>
      <div class="doc-compare-col removed">
        <h5>➖ Removed (${d.removed.length})</h5>
        ${d.removed.length ? d.removed.map((r) => `<div class="doc-compare-item">${escapeHtml(r)}</div>`).join("") : '<p class="muted" style="font-size:0.8rem;">Nothing removed.</p>'}
      </div>
    </div>
    ${changedBlock}`;
}

/* ---------------------------------------------------------------------
   8. Document Intelligence Score
--------------------------------------------------------------------- */
async function loadDocIntelScore() {
  const panel = document.getElementById("docIntelPanel-score");
  panel.innerHTML = '<p class="muted">📊 Computing intelligence score...</p>';
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/document-intel/score`, {}, 90000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.detail || "Could not compute score.")}</p>`;
      return;
    }
    const data = await res.json();
    const checks = [
      { key: "well_structured", label: "Well Structured" },
      { key: "high_information_density", label: "High Information Density" },
      { key: "clear_content", label: "Clear Content" },
      { key: "important_sections_detected", label: "Important Sections Detected" },
      { key: "key_entities_extracted", label: "Key Entities Extracted" },
    ];
        panel.innerHTML = `
      <div class="glass-card doc-score-wrap">
        <div class="doc-score-gauge-block">
          <svg class="gauge-svg" viewBox="0 0 120 120">
            <circle class="gauge-track" cx="60" cy="60" r="50"></circle>
            <circle class="gauge-fill confidence" id="docScoreGaugeFill" cx="60" cy="60" r="50"></circle>
          </svg>
          <div class="doc-score-label">
            <div class="score-num">${data.score}</div>
            <div class="score-denom">/ 100</div>
          </div>
        </div>
        <div class="doc-score-checklist">
          <h4>DOCUMENT INTELLIGENCE SCORE</h4>
          ${checks.map((c) => `
            <div class="doc-score-check-item ${data.checklist[c.key] ? "pass" : "fail"}">
              <span class="check-icon">${data.checklist[c.key] ? "✓" : "○"}</span>
              <span>${c.label}</span>
            </div>`).join("")}
        </div>
      </div>`;
    setGauge("docScoreGaugeFill", null, data.score);
  } catch (err) {
    panel.innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.message || "Could not reach the backend.")}</p>`;
  }
}
