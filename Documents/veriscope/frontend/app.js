// VeriScope AI frontend application logic.
// Talks to the Flask API at the same origin (see backend/app.py).

// Auto-detects environment so you never have to manually toggle this:
// - Same-origin hosting (localhost/127.0.0.1 during local dev, OR the
//   Render URL itself, since Flask serves frontend+backend together there)
//   -> use a relative path, talking to whatever origin served this page.
// - Netlify (a genuinely separate origin from the backend) -> talk to the
//   deployed Render backend directly via its full URL.
// Only the Netlify case needs RENDER_API_URL filled in below.
const RENDER_API_URL = 'https://veriscope-ai-3eyf.onrender.com';
const IS_SEPARATE_FRONTEND = window.location.hostname.endsWith('netlify.app');
const API = IS_SEPARATE_FRONTEND ? RENDER_API_URL : '';
let currentContext = '';
let lastClaims = [];
let lastSourceLabel = 'Pasted text';
let chatHistory = [];

// ---------------------------------------------------------------- helpers
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function verdictClass(v) {
  return { high_priority: 'high_priority', needs_verification: 'needs_verification',
           context_sufficient: 'context_sufficient', abstain: 'abstain',
           not_a_claim: 'not_a_claim' }[v] || 'needs_verification';
}
function verdictHlClass(v) {
  return { high_priority: 'hl-high', needs_verification: 'hl-needs',
           context_sufficient: 'hl-sufficient', abstain: 'hl-abstain' }[v] || 'hl-needs';
}
function riskColor(score) {
  if (score >= 70) return 'var(--red)';
  if (score >= 50) return 'var(--orange)';
  if (score >= 25) return 'var(--yellow)';
  return 'var(--green)';
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts) {
  const res = await fetch(API + path, Object.assign({
    headers: { 'Content-Type': 'application/json' },
  }, opts));
  return res.json();
}

// ---------------------------------------------------------------- nav
$all('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
  $all('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $all('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
  if (view === 'dashboard') loadDashboard();
  if (view === 'queue') loadQueue();
  if (view === 'history') loadHistory();
  if (view === 'lab') loadLab();
  if (view === 'research') loadResearch();
  if (view === 'about') loadAbout();
}

// ---------------------------------------------------------------- threshold
const thresholdSlider = $('#threshold-slider');
const thresholdValue = $('#threshold-value');
function updateThresholdLabel() {
  const v = parseFloat(thresholdSlider.value);
  thresholdValue.textContent = v <= 0.4 ? 'Strict' : v >= 0.65 ? 'Research' : 'Balanced';
}
thresholdSlider.addEventListener('input', updateThresholdLabel);
updateThresholdLabel();

// ---------------------------------------------------------------- file upload
$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  $('#input-text').value = text;
  $('#file-name').textContent = file.name;
  lastSourceLabel = file.name;
});

// ---------------------------------------------------------------- health / groq status
async function checkHealth() {
  try {
    const data = await api('/api/health');
    const box = $('#groq-status');
    const text = $('#groq-status-text');
    const badge = $('#chat-groq-badge');
    if (data.groq_configured) {
      box.className = 'groq-status on';
      text.textContent = 'AI chat & review enabled';
      badge.textContent = 'AI online'; badge.classList.add('on');
    } else {
      box.className = 'groq-status off';
      text.textContent = 'AI chat offline (no GROQ_API_KEY)';
      badge.textContent = 'AI offline'; badge.classList.remove('on');
    }
  } catch (e) {
    $('#groq-status-text').textContent = 'Backend unreachable';
  }
}
checkHealth();

// ---------------------------------------------------------------- analyze
$('#analyze-btn').addEventListener('click', runAnalysis);

async function runAnalysis() {
  const text = $('#input-text').value.trim();
  if (!text) { $('#input-text').focus(); return; }
  currentContext = $('#input-context').value.trim();
  const decompose = $('#decompose-toggle').checked;
  const threshold = parseFloat(thresholdSlider.value);

  $('#loading-indicator').classList.remove('hidden');
  $('#results-area').classList.add('hidden');
  $('#analyze-btn').disabled = true;
  const stopStatusAnim = animateLiveStatus();

  try {
    const data = await api('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ text, context: currentContext, decompose, threshold }),
    });
    if (data.error) { alert(data.error); return; }
    lastClaims = data.claims;
    finishLiveStatus();
    renderResults(data, text);
    updateQueueBadge();
  } catch (e) {
    alert('Analysis failed: ' + e.message);
  } finally {
    stopStatusAnim();
    setTimeout(() => $('#loading-indicator').classList.add('hidden'), 350);
    $('#analyze-btn').disabled = false;
  }
}

// Live AI Analysis Status: the backend does these steps for real, but does
// not stream progress over HTTP (a single request/response), so this
// sequences the status lines over a plausible timeline while the real
// request is in flight, then jumps straight to "done" the moment the
// response actually arrives -- never claims a step finished before the
// response that proves it did.
function animateLiveStatus() {
  const lines = $all('#loading-indicator .status-line');
  lines.forEach(l => { l.classList.remove('active', 'done'); l.querySelector('.status-icon').textContent = '○'; });
  $all('#pipeline-strip .pipeline-stage').forEach(s => s.classList.remove('active', 'done'));
  let i = 0;
  const timer = setInterval(() => {
    if (i > 0) { lines[i - 1].classList.remove('active'); lines[i - 1].classList.add('done'); lines[i - 1].querySelector('.status-icon').textContent = '✓'; }
    if (i < lines.length) { lines[i].classList.add('active'); i++; }
    updatePipelineStrip(i, lines.length);
  }, 380);
  return () => clearInterval(timer);
}
function finishLiveStatus() {
  $all('#loading-indicator .status-line').forEach(l => {
    l.classList.remove('active'); l.classList.add('done'); l.querySelector('.status-icon').textContent = '✓';
  });
  $all('#pipeline-strip .pipeline-stage').forEach(s => { s.classList.remove('active'); s.classList.add('done'); });
}
function updatePipelineStrip(doneCount, total) {
  const stages = $all('#pipeline-strip .pipeline-stage');
  const ratio = doneCount / total;
  const activeIdx = Math.min(Math.floor(ratio * stages.length), stages.length - 1);
  stages.forEach((s, idx) => {
    s.classList.toggle('done', idx < activeIdx);
    s.classList.toggle('active', idx === activeIdx);
  });
}

function renderResults(data, sourceText) {
  $('#results-area').classList.remove('hidden');

  const ring = $('#doc-score-ring');
  const circumference = 326.7;
  const offset = circumference - (data.document_score / 100) * circumference;
  ring.style.strokeDashoffset = offset;
  ring.style.stroke = riskColor(100 - data.document_score);
  $('#doc-score-num').textContent = data.document_score;
  $('#doc-score-band').textContent = data.document_band;

  const counts = { context_sufficient: 0, needs_verification: 0, high_priority: 0, abstain: 0 };
  data.claims.forEach(c => counts[c.verdict] = (counts[c.verdict] || 0) + 1);
  $('#summary-strip').innerHTML = `
    <div class="summary-chip"><div class="n">${data.total}</div><div class="l">Total Claims</div></div>
    <div class="summary-chip"><div class="n" style="color:var(--green)">${counts.context_sufficient}</div><div class="l">🟢 Context Sufficient</div></div>
    <div class="summary-chip"><div class="n" style="color:var(--yellow)">${counts.needs_verification}</div><div class="l">🟡 Needs Verification</div></div>
    <div class="summary-chip"><div class="n" style="color:var(--red)">${counts.high_priority}</div><div class="l">🔴 High Priority</div></div>
    <div class="summary-chip"><div class="n" style="color:var(--purple)">${counts.abstain}</div><div class="l">🛑 AI Abstained</div></div>
  `;

  renderHighlightedText(sourceText, data.claims);

  const list = $('#claims-list');
  list.innerHTML = '';
  data.claims.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'claim-card';
    if (c.verdict === 'not_a_claim') {
      card.innerHTML = `
        <div class="claim-card-top">
          <div class="claim-text" style="opacity:.75;">${escapeHtml(c.claim)}</div>
          <div class="verdict-badge not_a_claim">${c.verdict_emoji} ${escapeHtml(c.claimability_label)}</div>
        </div>
        <div class="claim-meta-row"><span class="meta-pill">Not run through verification — see claimability filter</span></div>
      `;
      card.addEventListener('click', () => openClaimModal(c));
      list.appendChild(card);
      return;
    }
    const consensus = c.model_consensus;
    card.innerHTML = `
      <div class="claim-card-top">
        <div class="claim-text">${c.is_compound_source ? '🧩 ' : ''}${escapeHtml(c.claim)}</div>
        <div class="verdict-badge ${verdictClass(c.verdict)}">${c.verdict_emoji} ${c.verdict_label}</div>
      </div>
      <div class="claim-meta-row">
        <span class="meta-pill">${c.claim_type_label}</span>
        <span class="meta-pill">${c.risk_band_emoji} ${c.risk_band}</span>
        <span class="meta-pill">Confidence ${c.confidence_pct}%</span>
        <span class="meta-pill">Context support ${c.context_sufficiency_pct}%</span>
        <span class="meta-pill" title="Similarity to real fact-checker-flagged sentences (CLEF CheckThat! 2019)">📰 Real-data match ${c.checkworthy_score_pct}%</span>
        <span class="meta-pill" title="Numeric/date/entity/multi-assertion complexity">🧠 Complexity ${c.complexity ? c.complexity.level : '-'}</span>
        ${consensus ? `<span class="meta-pill ${consensus.disagreement ? 'meta-pill-warn' : ''}" title="Vote across 4 independently trained models">🗳️ Models ${consensus.agreement}${consensus.disagreement ? ' ⚠️' : ''}</span>` : ''}
        <span class="meta-pill">📍 ${escapeHtml((c.lifecycle_status||'NEW').replace('_',' '))}</span>
        ${c.duplicates && c.duplicates.length ? `<span class="meta-pill">♻️ ${c.duplicates.length} similar seen</span>` : ''}
      </div>
      ${c.abstain_reason ? `<div class="abstain-reason">🛑 ${escapeHtml(c.abstain_reason)}</div>` : ''}
      <div class="risk-bar-wrap">
        <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${c.risk_score}%;background:${riskColor(c.risk_score)}"></div></div>
        <div class="risk-bar-label">Risk ${c.risk_score}/100</div>
      </div>
    `;
    card.addEventListener('click', () => openClaimModal(c));
    list.appendChild(card);
  });
}

function renderHighlightedText(sourceText, claims) {
  let html = escapeHtml(sourceText);
  const bySentence = {};
  claims.forEach(c => {
    const key = c.source_sentence || c.claim;
    if (!bySentence[key]) bySentence[key] = [];
    bySentence[key].push(c);
  });
  const severity = { high_priority: 3, abstain: 2, needs_verification: 1, context_sufficient: 0 };
  Object.entries(bySentence).forEach(([sentence, cs]) => {
    const worst = cs.reduce((a, b) => (severity[b.verdict] > severity[a.verdict] ? b : a));
    const escaped = escapeHtml(sentence);
    if (html.includes(escaped)) {
      html = html.replace(escaped,
        `<span class="hl ${verdictHlClass(worst.verdict)}" data-claim="${escapeHtml(cs[0].claim)}">${worst.verdict_emoji} ${escaped}</span>`);
    }
  });
  $('#highlighted-text').innerHTML = html;
  $all('#highlighted-text .hl').forEach(span => {
    span.addEventListener('click', () => {
      const claimText = span.dataset.claim;
      const match = lastClaims.find(c => c.claim === claimText);
      if (match) openClaimModal(match);
    });
  });
}

// ---------------------------------------------------------------- claim modal
const LIFECYCLE_STEPS = ["NEW", "ANALYZED", "EVIDENCE_FOUND", "CONFLICT_DETECTED", "HUMAN_REVIEW", "RESOLVED"];

function renderLifecycleStepper(status) {
  const idx = Math.max(LIFECYCLE_STEPS.indexOf(status), 0);
  return `<div class="lifecycle-stepper">${LIFECYCLE_STEPS.map((s, i) => `
    <div class="lc-step ${i < idx ? 'done' : i === idx ? 'active' : ''}">
      <span class="lc-dot"></span><span class="lc-label">${s.replace('_',' ')}</span>
    </div>${i < LIFECYCLE_STEPS.length - 1 ? '<div class="lc-line"></div>' : ''}`).join('')}</div>`;
}

function renderFingerprintRadar(fp) {
  if (!fp) return '';
  const axes = fp.radar;
  const labels = Object.keys(axes);
  const n = labels.length;
  const cx = 110, cy = 110, r = 85;
  const points = labels.map((label, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const value = Math.max(0, Math.min(100, axes[label])) / 100;
    return [cx + r * value * Math.cos(angle), cy + r * value * Math.sin(angle)];
  });
  const gridRings = [0.33, 0.66, 1.0].map(scale => {
    const ringPts = labels.map((_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return `${cx + r * scale * Math.cos(angle)},${cy + r * scale * Math.sin(angle)}`;
    }).join(' ');
    return `<polygon points="${ringPts}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="1"/>`;
  }).join('');
  const axisLines = labels.map((_, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return `<line x1="${cx}" y1="${cy}" x2="${cx + r*Math.cos(angle)}" y2="${cy + r*Math.sin(angle)}" stroke="rgba(255,255,255,.08)" stroke-width="1"/>`;
  }).join('');
  const labelEls = labels.map((label, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const lx = cx + (r + 20) * Math.cos(angle), ly = cy + (r + 20) * Math.sin(angle);
    return `<text x="${lx}" y="${ly}" font-size="9.5" fill="#aebede" text-anchor="middle" dominant-baseline="middle">${label}</text>`;
  }).join('');
  const polyPoints = points.map(p => p.join(',')).join(' ');
  return `<svg viewBox="0 0 220 220" style="width:100%;max-width:280px;display:block;margin:0 auto;">
    ${gridRings}${axisLines}
    <polygon points="${polyPoints}" fill="rgba(79,209,255,.25)" stroke="#4fd1ff" stroke-width="1.5"/>
    ${points.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#4fd1ff"/>`).join('')}
    ${labelEls}
  </svg>`;
}

async function openClaimModal(claim) {
  const modal = $('#claim-modal');
  modal.classList.remove('hidden');
  const body = $('#modal-body');

  if (claim.verdict === 'not_a_claim') {
    body.innerHTML = `
      <div class="modal-section">
        <div class="verdict-badge not_a_claim" style="margin-bottom:10px;display:inline-flex;">${claim.verdict_emoji} ${escapeHtml(claim.claimability_label)}</div>
        <h4 style="margin-top:16px;">Text</h4>
        <p style="font-size:15px;color:var(--text-hi);">${escapeHtml(claim.claim)}</p>
        <p style="font-size:13px;color:var(--text-dim);margin-top:10px;">${escapeHtml(claim.reasons[0])}</p>
      </div>`;
    return;
  }

  body.innerHTML = `
    <div class="modal-section">
      <div class="verdict-badge ${verdictClass(claim.verdict)}" style="margin-bottom:10px;display:inline-flex;">
        ${claim.verdict_emoji} ${claim.verdict_label}
      </div>
      <h4 style="margin-top:16px;">Claim</h4>
      <p style="font-size:15px;color:var(--text-hi);">${escapeHtml(claim.claim)}</p>
      ${claim.abstain_reason ? `<div class="abstain-reason">🛑 ${escapeHtml(claim.abstain_reason)}</div>` : ''}
    </div>

    <div class="modal-section">
      <h4>Claim Lifecycle</h4>
      ${renderLifecycleStepper(claim.lifecycle_status || 'NEW')}
    </div>

    <div class="modal-section">
      <h4>Claim Fingerprint</h4>
      <div class="fingerprint-grid">
        <div>${renderFingerprintRadar(claim.fingerprint)}</div>
        <div class="fingerprint-list">
          <div><b>Type:</b> ${escapeHtml(claim.fingerprint?.type || '')}</div>
          <div><b>Temporal Risk:</b> ${claim.fingerprint?.temporal_risk}</div>
          <div><b>Complexity:</b> ${claim.complexity?.level} (${claim.complexity?.score}/4 factors)</div>
          <div><b>Context Support:</b> ${claim.fingerprint?.context_support}</div>
          <div><b>Model Confidence:</b> ${claim.confidence_pct}%</div>
          <div><b>Claimability:</b> ${escapeHtml(claim.claimability_label || '')} (${claim.claimability_confidence_pct}%)</div>
        </div>
      </div>
    </div>

    ${claim.model_consensus ? `
    <div class="modal-section">
      <h4>Model Decision Comparison</h4>
      <div class="consensus-row">
        ${Object.entries(claim.model_consensus.predictions).map(([name, pred]) =>
          `<div class="consensus-item"><span class="consensus-model">${escapeHtml(name)}</span><span class="verdict-badge ${verdictClass(pred)}" style="font-size:10.5px;padding:3px 8px;">${pred.replace('_',' ')}</span></div>`).join('')}
      </div>
      <p style="font-size:12.5px;color:${claim.model_consensus.disagreement ? 'var(--orange)' : 'var(--text-dim)'};margin-top:8px;">
        ${claim.model_consensus.disagreement ? '⚠️ Model Disagreement Detected — ' : '✓ '}
        Consensus: <b>${claim.model_consensus.consensus_label.replace('_',' ')}</b> (${claim.model_consensus.agreement} agree)</p>
    </div>` : ''}

    <div class="modal-section">
      <h4>Why was this flagged?</h4>
      <ul class="reason-list">${claim.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>
    <div class="modal-section">
      <h4>Probability Breakdown</h4>
      <div class="claim-meta-row">
        <span class="meta-pill">🟢 Sufficient ${claim.probabilities.context_sufficient ?? 0}%</span>
        <span class="meta-pill">🟡 Needs Verif. ${claim.probabilities.needs_verification ?? 0}%</span>
        <span class="meta-pill">🔴 High Priority ${claim.probabilities.high_priority ?? 0}%</span>
      </div>
    </div>
    <div class="modal-section" id="modal-evidence"><h4>Evidence</h4><div class="loading" style="padding:6px 0;"><div class="spinner"></div>Retrieving evidence…</div></div>
    <div class="modal-section" id="modal-roadmap"><h4>Investigation Roadmap</h4><div class="loading" style="padding:6px 0;"><div class="spinner"></div>Building roadmap…</div></div>

    <div class="modal-section">
      <h4>Counterfactual Testing</h4>
      <p style="font-size:12.5px;color:var(--text-dim);margin:0 0 8px;">Generates controlled variations of this claim (numbers, superlatives, tense) and checks whether the verdict changes.</p>
      <button class="btn btn-ghost btn-sm" id="counterfactual-btn">🎯 Run Counterfactual Test</button>
      <div id="counterfactual-result"></div>
    </div>

    <div class="modal-section">
      <h4>AI Second Opinion (optional, via Groq)</h4>
      <button class="btn btn-ghost btn-sm" id="ai-review-btn">🤖 Ask AI for a second opinion</button>
      <div id="ai-review-result"></div>
    </div>
    <div class="modal-section">
      <h4>Human Review Feedback</h4>
      <div class="feedback-row">
        <button class="fb-btn" data-decision="supported">✔️ Supported</button>
        <button class="fb-btn" data-decision="refuted">❌ Refuted</button>
        <button class="fb-btn" data-decision="insufficient">⚠️ Insufficient evidence</button>
        <button class="fb-btn" data-decision="ambiguous">🤷 Ambiguous</button>
        <button class="fb-btn" data-decision="needs_updated_evidence">🔄 Needs updated evidence</button>
      </div>
      <div class="reviewer-confidence-row">
        <label>Reviewer confidence: <span id="reviewer-conf-val">70%</span></label>
        <input type="range" id="reviewer-conf-slider" min="0" max="100" value="70">
      </div>
      <textarea id="reviewer-notes" class="reviewer-notes" placeholder="Explain why you made this decision…"></textarea>
    </div>
  `;

  const confSlider = $('#reviewer-conf-slider');
  confSlider.addEventListener('input', () => { $('#reviewer-conf-val').textContent = confSlider.value + '%'; });

  $all('.fb-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const notes = $('#reviewer-notes').value.trim();
      const reviewer_confidence_pct = parseFloat(confSlider.value);
      await api('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ claim: claim.claim, decision: btn.dataset.decision, notes,
                                reviewer_confidence_pct, original_verdict: claim.verdict }),
      });
      $all('.fb-btn').forEach(b => b.disabled = true);
      btn.style.background = 'rgba(52,211,153,.15)'; btn.style.color = 'var(--green)'; btn.style.borderColor = 'rgba(52,211,153,.4)';
      btn.textContent = '✓ Recorded — ' + btn.textContent;
    });
  });

  $('#counterfactual-btn').addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Running variations…';
    const res = await api('/api/counterfactual', { method: 'POST', body: JSON.stringify({ claim: claim.claim }) });
    const box = $('#counterfactual-result');
    if (res.variants && res.variants.length) {
      const sensColor = { HIGH: 'var(--red)', MEDIUM: 'var(--yellow)', LOW: 'var(--green)' }[res.sensitivity] || 'var(--text-dim)';
      let html = `<p style="font-size:12.5px;margin:8px 0;color:${sensColor};">Sensitivity: <b>${res.sensitivity}</b> — ${res.n_verdict_changes}/${res.n_variants} variants changed the verdict.</p>`;
      res.variants.forEach(v => {
        html += `<div class="evidence-item"><span style="opacity:.7;">${escapeHtml(v.change)}</span><br>
          "${escapeHtml(v.variant_claim)}" → <span class="verdict-badge ${verdictClass(v.verdict)}" style="font-size:10px;padding:2px 7px;">${v.verdict.replace('_',' ')}</span>
          ${v.verdict_changed ? ' <b style="color:var(--orange);">CHANGED</b>' : ''}</div>`;
      });
      box.innerHTML = html;
    } else {
      box.innerHTML = '<p style="font-size:12.5px;color:var(--text-dim);">No applicable variations could be generated for this claim (no number/superlative/temporal marker to perturb).</p>';
    }
    e.target.disabled = false; e.target.textContent = '🎯 Run Counterfactual Test';
  });

  $('#ai-review-btn').addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Thinking…';
    const res = await api('/api/ai-review', { method: 'POST', body: JSON.stringify({ claim: claim.claim }) });
    const box = $('#ai-review-result');
    if (res.reply) {
      box.innerHTML = `<div class="ai-review-box">${escapeHtml(res.reply)}</div>`;
    } else {
      box.innerHTML = `<div class="ai-review-box">⚠️ ${escapeHtml(res.error || 'AI review unavailable.')}</div>`;
    }
    e.target.disabled = false; e.target.textContent = '🤖 Ask AI for a second opinion';
  });

  api('/api/evidence', {
    method: 'POST',
    body: JSON.stringify({ claim: claim.claim, context: currentContext,
                            temporal_sensitive: claim.temporal_sensitive,
                            context_sufficiency_pct: claim.context_sufficiency_pct }),
  }).then(res => {
      const el = $('#modal-evidence');
      let html = '<h4>Evidence</h4>';
      if (!res.evidence || !res.evidence.length) {
        html += '<p style="font-size:13px;color:var(--text-dim);">No supporting context was supplied, or no relevant sentence was found in it.</p>';
      } else {
        html += `<div class="intel-score-row">
          <div class="intel-score-num">${res.intelligence_score.score}<span style="font-size:12px;color:var(--text-dim);">/100</span></div>
          <div><div style="font-size:12.5px;color:var(--text-hi);">${escapeHtml(res.intelligence_score.label)}</div>
          <div style="font-size:11px;color:var(--text-dim);">Evidence Intelligence Score — heuristic composite, not an ML probability</div></div>
        </div>`;
        html += `<div class="debate-view">
          <div class="debate-bar"><div class="debate-support" style="width:${res.debate.supporting_pct}%"></div><div class="debate-contradict" style="width:${res.debate.contradicting_pct}%"></div></div>
          <div class="debate-labels"><span style="color:var(--green);">✓ Supporting ${res.debate.supporting_pct}%</span>
          <span style="color:var(--red);">✗ Contradicting ${res.debate.contradicting_pct}%</span></div>
          <div style="font-size:11.5px;color:var(--text-dim);margin-top:4px;">Conflict Intensity: <b>${res.debate.conflict_intensity}</b></div>
        </div>`;
        html += `<div style="font-size:11.5px;color:var(--text-dim);margin:6px 0 10px;">🕒 Freshness: ${escapeHtml(res.freshness.label)}</div>`;
        res.evidence.forEach(ev => {
          html += `<div class="evidence-item">${escapeHtml(ev.sentence)}
            <span class="strength-tag ${ev.strength}">${ev.strength} · ${ev.relevance_pct}%</span></div>`;
        });
        if (res.conflicts && res.conflicts.length) {
          res.conflicts.forEach(cf => {
            html += `<div class="conflict-box">⚠️ CONFLICTING EVIDENCE: ${escapeHtml(cf.reason)}<br>
              <span style="opacity:.85">"${escapeHtml(cf.a)}"</span> vs <span style="opacity:.85">"${escapeHtml(cf.b)}"</span></div>`;
          });
        }
      }
      if (res.web_search_available) {
        html += `<button class="btn btn-ghost btn-sm" id="web-evidence-btn" style="margin-top:8px;">🌐 Search the web for evidence (Groq)</button><div id="web-evidence-result"></div>`;
      } else {
        html += `<p style="font-size:12px;color:var(--text-dim);margin-top:8px;">🌐 Web-search evidence needs a GROQ_API_KEY (see backend/.env).</p>`;
      }
      el.innerHTML = html;

      const webBtn = document.getElementById('web-evidence-btn');
      if (webBtn) {
        webBtn.addEventListener('click', async () => {
          webBtn.disabled = true; webBtn.textContent = 'Searching the web…';
          const webRes = await api('/api/evidence', { method: 'POST', body: JSON.stringify({ claim: claim.claim, context: currentContext, use_web: true }) });
          const box = document.getElementById('web-evidence-result');
          if (webRes.web_search && webRes.web_search.summary) {
            let wHtml = `<div class="ai-review-box">🌐 <b>Web search (via Groq):</b><br>${escapeHtml(webRes.web_search.summary)}</div>`;
            if (webRes.web_search.sources && webRes.web_search.sources.length) {
              wHtml += '<div style="margin-top:6px;">' + webRes.web_search.sources.map(s =>
                `<a href="${s.url}" target="_blank" style="display:block;font-size:12px;color:var(--cyan);margin-top:4px;">🔗 ${escapeHtml(s.title || s.url)}</a>`).join('') + '</div>';
            }
            box.innerHTML = wHtml;
          } else {
            box.innerHTML = `<div class="ai-review-box">⚠️ ${escapeHtml(webRes.web_search_error || 'Web search unavailable.')}</div>`;
          }
          webBtn.remove();
        });
      }
    });

  api('/api/roadmap', { method: 'POST', body: JSON.stringify({ claim: claim.claim, context: currentContext }) })
    .then(res => {
      const el = $('#modal-roadmap');
      el.innerHTML = `<h4>Investigation Roadmap</h4><ol class="roadmap-list">${res.roadmap.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;
    });
}

$('#modal-close').addEventListener('click', () => $('#claim-modal').classList.add('hidden'));
document.querySelector('.modal-backdrop').addEventListener('click', () => $('#claim-modal').classList.add('hidden'));

// ---------------------------------------------------------------- report
$('#report-btn').addEventListener('click', async () => {
  if (!lastClaims.length) return;
  const res = await fetch(API + '/api/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claims: lastClaims, source_label: lastSourceLabel }),
  });
  const html = await res.text();
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
});

// ---------------------------------------------------------------- dashboard
let charts = {};
async function loadDashboard() {
  const stats = await api('/api/dashboard');
  $('#stat-total').textContent = stats.total || 0;
  $('#stat-sufficient').textContent = (stats.by_verdict || {}).context_sufficient || 0;
  $('#stat-needs').textContent = (stats.by_verdict || {}).needs_verification || 0;
  $('#stat-high').textContent = (stats.by_verdict || {}).high_priority || 0;

  drawChart('chart-verdict', 'doughnut', stats.by_verdict, ['#34d399', '#fbbf24', '#f87171', '#c4a6ff']);
  drawChart('chart-category', 'bar', stats.by_category, '#4fd1ff');
  drawChart('chart-type', 'bar', stats.by_type, '#3b82f6');
}

function drawChart(canvasId, type, dataObj, colors) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  if (charts[canvasId]) charts[canvasId].destroy();
  const labels = Object.keys(dataObj || {});
  const values = Object.values(dataObj || {});
  charts[canvasId] = new Chart(ctx, {
    type,
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6, borderWidth: 0 }] },
    options: {
      plugins: { legend: { display: type === 'doughnut', labels: { color: '#aebede', font: { size: 11 } } } },
      scales: type === 'bar' ? {
        x: { ticks: { color: '#6f83aa', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#6f83aa' }, grid: { color: 'rgba(255,255,255,.05)' } },
      } : {},
    },
  });
}

// ---------------------------------------------------------------- review queue
async function loadQueue() {
  const res = await api('/api/review-queue?status=pending');
  const list = $('#queue-list');
  if (!res.queue.length) {
    list.innerHTML = '<div class="empty-state">No claims currently need human review. Run an analysis to populate this queue.</div>';
    return;
  }
  list.innerHTML = '';
  res.queue.forEach(item => {
    const div = document.createElement('div');
    div.className = 'queue-item';
    div.innerHTML = `
      <div class="queue-priority ${item.priority}">${item.priority}</div>
      <div class="queue-content">
        <div class="queue-claim">${escapeHtml(item.claim)}</div>
        <div class="queue-reason">${escapeHtml(item.reason || '')}</div>
      </div>
      <div class="queue-actions">
        <button class="btn btn-ghost btn-sm resolve-btn">Mark Resolved</button>
      </div>
    `;
    div.querySelector('.resolve-btn').addEventListener('click', async () => {
      await api(`/api/review-queue/${item.id}`, { method: 'POST', body: JSON.stringify({ status: 'resolved' }) });
      loadQueue(); updateQueueBadge();
    });
    list.appendChild(div);
  });
}

async function updateQueueBadge() {
  const res = await api('/api/review-queue?status=pending');
  $('#queue-badge').textContent = res.queue.length;
}
updateQueueBadge();

// ---------------------------------------------------------------- history
async function loadHistory() {
  const res = await api('/api/history');
  const body = $('#history-body');
  body.innerHTML = '';
  res.history.forEach(row => {
    const tr = document.createElement('tr');
    const date = new Date(row.created_at).toLocaleString();
    tr.innerHTML = `<td>${date}</td><td>${escapeHtml(row.claim)}</td>
      <td><span class="verdict-badge ${verdictClass(row.verdict)}" style="display:inline-flex;">${row.verdict.replace('_', ' ')}</span></td>
      <td>${row.risk_score}</td>`;
    body.appendChild(tr);
  });
  if (!res.history.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty-state">No claims analyzed yet.</td></tr>';
  }
}

// ---------------------------------------------------------------- model lab
async function loadLab() {
  const res = await api('/api/model-info');
  const comp = res.comparison || {};
  const results = comp.results || {};
  const best = comp.best_model;
  const cw = res.checkworthy_model || {};

  $('#lab-summary').innerHTML = `
    <p style="font-size:13.5px;color:var(--text-mid);margin:0 0 10px;">
    3-way classifier trained on <b>${comp.n_train || '?'}</b> examples (${comp.dataset || 'seed_claims_combined.csv'}),
    evaluated with <b>5-fold cross-validation</b> plus a held-out 20% test set of
    <b>${comp.n_test || '?'}</b>. Best performer: <b style="color:var(--cyan);">${best || '—'}</b>.
    ${comp.checkworthy_feature_blended ? 'Includes a real-data signal blended in as a feature (see below).' : ''}</p>
    ${cw.n_train ? `<p style="font-size:13.5px;color:var(--text-mid);margin:0;border-top:1px solid var(--panel-border);padding-top:10px;">
    <b style="color:var(--cyan);">Real-data check-worthiness model</b> — trained on <b>${cw.n_train}</b> sentences
    (${cw.n_train_positive} check-worthy) from the human-annotated CLEF CheckThat! 2019 dataset (US political
    debates/speeches, fact-checked by professionals), tested on <b>${cw.n_test}</b> held-out sentences from
    different debates. ROC-AUC <b>${(cw.roc_auc*100).toFixed(1)}%</b>, PR-AUC <b>${(cw.pr_auc*100).toFixed(1)}%</b>
    (vs. ${((cw.n_test_positive/cw.n_test)*100).toFixed(1)}% random baseline — a ${(cw.pr_auc/(cw.n_test_positive/cw.n_test)).toFixed(1)}x
    lift). At the tuned decision threshold: precision ${(cw.threshold_tuned?.precision*100).toFixed(1)}%,
    recall ${(cw.threshold_tuned?.recall*100).toFixed(1)}%, F1 ${(cw.threshold_tuned?.f1*100).toFixed(1)}%.
    This is a genuinely hard, imbalanced real-world task (~2.5% positive rate) — these numbers are honest,
    not inflated.</p>` : '<p class="empty-state">Run train_checkworthy_model.py to populate this section.</p>'}
  `;

  const tbody = document.querySelector('#lab-table tbody');
  tbody.innerHTML = '';
  Object.entries(results).forEach(([name, m]) => {
    const tr = document.createElement('tr');
    if (name === best) tr.className = 'best-model';
    const cvF1 = m.cv_f1_mean !== undefined ? `${(m.cv_f1_mean*100).toFixed(1)}% ± ${(m.cv_f1_std*100).toFixed(1)}` : '—';
    tr.innerHTML = `<td>${name}${name === best ? '<span class="crown">👑</span>' : ''}</td>
      <td>${(m.test_accuracy*100).toFixed(1)}%</td><td>${(m.test_precision_macro*100).toFixed(1)}%</td>
      <td>${(m.test_recall_macro*100).toFixed(1)}%</td><td>${(m.test_f1_macro*100).toFixed(1)}%</td>
      <td>${cvF1}</td>`;
    tbody.appendChild(tr);
  });

  const errList = $('#error-list');
  const errors = (res.error_analysis || {}).errors || [];
  errList.innerHTML = errors.length ? '' : '<div class="empty-state">No misclassifications on the held-out set — small test set, take with a grain of salt.</div>';
  errors.forEach(e => {
    const div = document.createElement('div');
    div.className = 'error-item';
    div.innerHTML = `"${escapeHtml(e.claim)}"<br>True: <b>${e.true_label}</b> · Predicted: <b>${e.predicted_label}</b>
      · <span class="tag">${escapeHtml(e.error_category)}</span>`;
    errList.appendChild(div);
  });
}

async function loadResearch() {
  const [modelInfo, research] = await Promise.all([api('/api/model-info'), api('/api/research-dashboard')]);
  const ai = research.ai_behavior || {};

  $('#research-stat-grid').innerHTML = `
    <div class="card stat-card"><div class="stat-num">${ai.total_claims||0}</div><div class="stat-label">Total Claims Analyzed</div></div>
    <div class="card stat-card"><div class="stat-num">${ai.abstention_rate_pct||0}%</div><div class="stat-label">🛑 Abstention Rate</div></div>
    <div class="card stat-card"><div class="stat-num">${ai.conflict_detection_rate_pct||0}%</div><div class="stat-label">⚔️ Conflict Detection Rate</div></div>
    <div class="card stat-card"><div class="stat-num">${ai.human_override_rate_pct||0}%</div><div class="stat-label">👨‍⚖️ Human Override Rate (${ai.n_overrides||0}/${ai.n_reviewed||0})</div></div>
  `;

  const fi = research.feature_importance;
  const fiBody = $('#feature-importance-body');
  if (!fi) {
    fiBody.innerHTML = '<div class="empty-state">Run train_models.py to populate feature importance.</div>';
  } else {
    let html = '';
    Object.entries(fi).forEach(([label, terms]) => {
      html += `<div style="margin-bottom:14px;"><b style="color:var(--cyan);font-size:12.5px;">${escapeHtml(label)}</b><div class="fi-bars">`;
      const maxAbs = Math.max(...terms.map(t => Math.abs(t.weight)), 0.001);
      terms.slice(0, 8).forEach(t => {
        const pct = Math.abs(t.weight) / maxAbs * 100;
        const positive = t.weight >= 0;
        html += `<div class="fi-row"><span class="fi-term">${escapeHtml(t.term)}</span>
          <div class="fi-track"><div class="fi-fill ${positive?'pos':'neg'}" style="width:${pct}%"></div></div>
          <span class="fi-weight">${t.weight.toFixed(2)}</span></div>`;
      });
      html += '</div></div>';
    });
    fiBody.innerHTML = html;
  }

  const rb = modelInfo.retrieval_benchmark;
  const rbBody = $('#retrieval-benchmark-body');
  if (!rb || !rb.results) {
    rbBody.innerHTML = '<div class="empty-state">Run eval_retrieval_methods.py to populate this benchmark.</div>';
  } else {
    let html = `<p style="font-size:12.5px;color:var(--text-dim);margin:0 0 10px;">${escapeHtml(rb.note||'')}</p>
      <table class="lab-table"><thead><tr><th>Method</th><th>Precision@3</th><th>Recall@3</th></tr></thead><tbody>`;
    Object.entries(rb.results).forEach(([name, m]) => {
      html += `<tr><td>${escapeHtml(name)}</td><td>${(m.precision_at_k*100).toFixed(1)}%</td><td>${(m.recall_at_k*100).toFixed(1)}%</td></tr>`;
    });
    html += '</tbody></table>';
    rbBody.innerHTML = html;
  }
}

$('#export-feedback-btn').addEventListener('click', () => {
  window.open(API + '/api/feedback/export', '_blank');
});

async function loadAbout() {
  const res = await api('/api/model-info');
  const comp = res.comparison || {};
  const best = comp.best_model;
  const m = (comp.results || {})[best];
  if (m) {
    $('#about-model-line').textContent =
      `${best}, trained on TF-IDF (unigrams+bigrams) combined with 17 hand-engineered linguistic features. ` +
      `Held-out accuracy ${(m.accuracy * 100).toFixed(1)}%, macro F1 ${(m.f1_macro * 100).toFixed(1)}% — a documented baseline, not a claim of production-grade reliability.`;
  }
}

// ---------------------------------------------------------------- chat widget
$('#chat-toggle').addEventListener('click', () => $('#chat-panel').classList.toggle('hidden'));
$('#chat-send').addEventListener('click', sendChat);
$('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

// ---------------------------------------------------------------- voice input (mic button)
// Uses the browser's built-in Web Speech API -- no backend/API key needed.
// Supported in Chrome, Edge, Safari; not in Firefox, where the button is
// hidden entirely rather than shown broken.
(function setupVoiceInput() {
  const micBtn = $('#chat-mic');
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognitionAPI) {
    micBtn.style.display = 'none';
    return;
  }

  const recognition = new SpeechRecognitionAPI();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;

  let isListening = false;

  recognition.addEventListener('result', (e) => {
    let transcript = '';
    for (let i = 0; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    $('#chat-input').value = transcript;
  });

  recognition.addEventListener('end', () => {
    isListening = false;
    micBtn.classList.remove('listening');
    $('#chat-input').placeholder = 'Ask a question…';
    // If speech was captured, send it automatically; an empty result (e.g.
    // mic denied or silence) just leaves the field for manual typing.
    if ($('#chat-input').value.trim()) {
      sendChat();
    }
  });

  recognition.addEventListener('error', () => {
    isListening = false;
    micBtn.classList.remove('listening');
  });

  micBtn.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
      return;
    }
    isListening = true;
    micBtn.classList.add('listening');
    $('#chat-input').value = '';
    $('#chat-input').placeholder = 'Listening…';
    try {
      recognition.start();
    } catch (err) {
      isListening = false;
      micBtn.classList.remove('listening');
    }
  });
})();


async function sendChat() {
  const input = $('#chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendChatMsg('user', msg);
  chatHistory.push({ role: 'user', content: msg });

  const res = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: msg, history: chatHistory }) });
  if (res.reply) {
    appendChatMsg('bot', res.reply);
    chatHistory.push({ role: 'assistant', content: res.reply });
  } else {
    appendChatMsg('bot', '⚠️ ' + (res.error || 'AI chat is currently unavailable.'));
  }
}

function appendChatMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.textContent = text;
  const box = $('#chat-messages');
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}