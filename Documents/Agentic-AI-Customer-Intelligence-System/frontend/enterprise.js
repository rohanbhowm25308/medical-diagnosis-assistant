/* enterprise.js
   -------------
   Drives the AI Enterprise Console: Digital Twin, Root-Cause Graph,
   Confidence Engine, Why This/Why Not, Experiment Lab, Data Drift, Model
   Health, Red-Team Simulator, Governance Center, Kill Switch, Cost Monitor.

   Every number shown here comes straight from the backend — this file only
   formats and paces the display, it never invents a figure.

   Depends on API_BASE and fetchWithTimeout, both defined in script.js.
*/

(function () {
  function fmt(n, digits = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  async function getJSON(url, opts, timeoutMs = 30000) {
    const res = await fetchWithTimeout(`${API_BASE}${url}`, opts || {}, timeoutMs);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Request failed.");
    return data;
  }

  // ---------------- Digital Twin ----------------
  async function loadTwinCurrent() {
    const grid = document.getElementById("twinCurrentGrid");
    try {
      const d = await getJSON("/api/digital-twin/current");
      grid.innerHTML = `
        <div class="glass-card center-card"><h4>Customers</h4><div class="stat-value">${fmt(d.customers, 0)}</div></div>
        <div class="glass-card center-card"><h4>${d.revenue_metric}</h4><div class="stat-value">${fmt(d.total_revenue)}</div></div>
        <div class="glass-card center-card"><h4>Retention (proxy)</h4><div class="stat-value">${d.retention_proxy_pct ?? "—"}%</div></div>
        <div class="glass-card center-card"><h4>Avg / Customer</h4><div class="stat-value">${fmt(d.avg_revenue_per_customer)}</div></div>
      `;
    } catch (err) {
      grid.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  document.getElementById("twinSimulateBtn")?.addEventListener("click", async () => {
    const change = parseFloat(document.getElementById("twinRetentionChange").value);
    if (Number.isNaN(change)) return alert("Enter a retention change %, e.g. 10 or -5.");
    const resultBox = document.getElementById("twinResult");
    const grid = document.getElementById("twinResultGrid");
    try {
      const d = await getJSON("/api/digital-twin/simulate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric: "retention", change_pct: change }),
      });
      grid.innerHTML = `
        <div class="glass-card center-card"><h4>Revenue</h4><div class="stat-value">${fmt(d.current.revenue)} → ${fmt(d.simulated.revenue)}</div></div>
        <div class="glass-card center-card"><h4>Retention</h4><div class="stat-value">${d.current.retention_pct}% → ${d.simulated.retention_pct}%</div></div>
        <div class="glass-card center-card"><h4>Est. Impact</h4><div class="stat-value">${d.delta.revenue_pct >= 0 ? "+" : ""}${d.delta.revenue_pct}%</div></div>
      `;
      document.getElementById("twinMethodology").textContent = d.methodology + ` (AI confidence: ${d.confidence}%)`;
      resultBox.style.display = "block";
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------------- Root-Cause Graph ----------------
  async function loadRootCauseGraph() {
    const box = document.getElementById("rootCauseGraph");
    try {
      const d = await getJSON("/api/root-cause-graph");
      const root = d.nodes.find(n => n.id === "root");
      const factors = d.nodes.filter(n => n.kind === "factor");
      const conclusion = d.nodes.find(n => n.kind === "conclusion");
      box.innerHTML = `
        <div class="rc-node rc-root">📊 ${root.label}<div class="muted">${root.detail}</div></div>
        <div class="rc-branches">
          ${factors.map(f => `<div class="rc-node rc-factor">${f.label}<div class="muted">${f.detail}</div></div>`).join("")}
        </div>
        <div class="rc-node rc-conclusion">🎯 ${conclusion.label}<div class="muted">${conclusion.detail}</div></div>
      `;
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  // ---------------- Confidence Engine ----------------
  async function loadConfidence() {
    const box = document.getElementById("confidencePanel");
    try {
      const d = await getJSON("/api/confidence");
      const f = d.factors;
      box.innerHTML = `
        <div class="grid-2">
          <div class="glass-card center-card"><h4>Overall Confidence</h4><div class="stat-value">${d.overall}%</div></div>
          <div>
            <div class="conf-row"><span>Data completeness</span><b>${f.data_completeness}%</b></div>
            <div class="conf-row"><span>Historical coverage</span><b>${f.historical_coverage}%</b></div>
            <div class="conf-row"><span>Segment separation</span><b>${f.segment_separation}%</b></div>
            <div class="conf-row"><span>Model performance</span><b>${f.model_performance}${typeof f.model_performance === "number" ? "%" : ""}</b></div>
          </div>
        </div>
        ${d.warning ? `<p class="muted mt">⚠️ ${d.warning}</p>` : ""}
      `;
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  // ---------------- Why This / Why Not ----------------
  async function loadSegmentReasoning() {
    const box = document.getElementById("segmentReasoningPanel");
    try {
      const d = await getJSON("/api/segment-reasoning");
      box.innerHTML = `
        <h4>Why '${d.recommended_segment}'?</h4>
        <ul class="ai-insights-list">${d.reasons_for.map(r => `<li>✓ ${r}</li>`).join("")}</ul>
        <h4 class="mt">Why not the others?</h4>
        <ul class="ai-insights-list">${d.why_not.map(w => `<li>✗ <b>${w.segment}</b> (${w.size.toLocaleString()} customers): ${w.reason}</li>`).join("")}</ul>
      `;
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  // ---------------- Experiment Lab ----------------
  async function loadExperimentColumns() {
    const select = document.getElementById("experimentFeatureCol");
    const runBtn = document.getElementById("runExperimentBtn");
    if (!select) return;
    select.innerHTML = `<option>Loading…</option>`;
    select.disabled = true;
    if (runBtn) runBtn.disabled = true;
    try {
      const d = await getJSON("/api/numeric-columns");
      if (!d.columns || d.columns.length === 0) {
        select.innerHTML = `<option>No usable numeric columns</option>`;
        return;
      }
      select.innerHTML = d.columns.map(c => `<option value="${c}">${c}</option>`).join("");
      select.disabled = false;
      if (runBtn) runBtn.disabled = false;
    } catch (err) {
      // Never put the error text in as a selectable <option> — that's what
      // let it get submitted earlier as if it were a real column name.
      select.innerHTML = `<option>No dataset loaded yet</option>`;
      select.disabled = true;
      if (runBtn) runBtn.disabled = true;
    }
  }

  document.getElementById("experimentRefreshBtn")?.addEventListener("click", loadExperimentColumns);

  document.getElementById("runExperimentBtn")?.addEventListener("click", async () => {
    const select = document.getElementById("experimentFeatureCol");
    if (select.disabled || !select.value) {
      return alert("No dataset columns loaded yet. Upload and analyze a dataset, then click 'Refresh columns'.");
    }
    const feature_column = select.value;
    const control_value = parseFloat(document.getElementById("experimentControl").value);
    const experiment_value = parseFloat(document.getElementById("experimentValue").value);
    const box = document.getElementById("experimentResult");
    if (!feature_column || Number.isNaN(control_value) || Number.isNaN(experiment_value)) {
      return alert("Fill in a feature column, control value, and experiment value.");
    }
    box.style.display = "block";
    box.innerHTML = `<p class="muted">Running…</p>`;
    try {
      const d = await getJSON("/api/experiment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature_column, control_value, experiment_value }),
      });
      box.innerHTML = `
        <div class="grid-2">
          <div class="glass-card center-card"><h4>Control (${d.control.input})</h4><div class="stat-value">${fmt(d.control.predicted_outcome)}</div></div>
          <div class="glass-card center-card"><h4>Experiment (${d.experiment.input})</h4><div class="stat-value">${fmt(d.experiment.predicted_outcome)}</div></div>
        </div>
        <p class="mt"><b>${d.decision}</b></p>
        <p class="muted">r² = ${d.r_squared} · ${d.methodology}</p>
      `;
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  });

  // ---------------- Data Drift ----------------
  document.getElementById("driftBaselineBtn")?.addEventListener("click", async () => {
    const box = document.getElementById("driftResult");
    try {
      const d = await getJSON("/api/drift/set-baseline", { method: "POST" });
      box.innerHTML = `<p class="muted">✓ Baseline set: ${d.baseline_filename} (${d.baseline_rows} rows). Now upload a new dataset, run analysis, then click "Compare to Baseline".</p>`;
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  });

  document.getElementById("driftAnalyzeBtn")?.addEventListener("click", async () => {
    const box = document.getElementById("driftResult");
    box.innerHTML = `<p class="muted">Comparing…</p>`;
    try {
      const d = await getJSON("/api/drift/analyze");
      box.innerHTML = `
        <p><b>${d.overall_status}</b> — ${d.recommendation}</p>
        <table class="drift-table">
          <thead><tr><th>Column</th><th>Baseline</th><th>Current</th><th>Drift</th></tr></thead>
          <tbody>${d.columns.map(c => `<tr><td>${c.column}</td><td>${fmt(c.baseline_mean)}</td><td>${fmt(c.current_mean)}</td><td>${c.status} ${c.drift_pct}%</td></tr>`).join("")}</tbody>
        </table>
      `;
      loadModelHealth();
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  });

  // ---------------- Model Health ----------------
  async function loadModelHealth() {
    const box = document.getElementById("modelHealthPanel");
    try {
      const d = await getJSON("/api/model-health");
      const m = d.metrics;
      box.innerHTML = `
        <p><b>${d.model_name}</b> — ${d.status}</p>
        <div class="grid-4 mt">
          <div class="glass-card center-card"><h4>Accuracy</h4><div class="stat-value">${m.accuracy ?? "—"}%</div></div>
          <div class="glass-card center-card"><h4>Precision</h4><div class="stat-value">${m.precision ?? "—"}${m.precision != null ? "%" : ""}</div></div>
          <div class="glass-card center-card"><h4>Recall</h4><div class="stat-value">${m.recall ?? "—"}${m.recall != null ? "%" : ""}</div></div>
          <div class="glass-card center-card"><h4>F1</h4><div class="stat-value">${m.f1_score ?? "—"}${m.f1_score != null ? "%" : ""}</div></div>
        </div>
        ${d.data_drift_pct != null ? `<p class="muted mt">Data drift: ${d.data_drift_pct}%</p>` : ""}
        ${d.note ? `<p class="muted">${d.note}</p>` : ""}
      `;
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  // ---------------- Red-Team ----------------
  document.getElementById("redteamRunBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("redteamRunBtn");
    const box = document.getElementById("redteamResult");
    btn.disabled = true;
    box.innerHTML = `<p class="muted">Running 4 attack tests against the real AI agent — this makes real LLM calls and can take up to a minute…</p>`;
    try {
      const d = await getJSON("/api/redteam/run", { method: "POST" }, 120000);
      box.innerHTML = `
        <p><b>${d.summary}</b></p>
        <ul class="ai-insights-list mt">
          ${d.tests.map(t => `<li>${t.status} — <b>${t.name}</b><div class="muted">${t.response_excerpt}</div></li>`).join("")}
        </ul>
      `;
      loadOpsMonitor();
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------- Governance ----------------
  async function loadGovernance() {
    const box = document.getElementById("governancePanel");
    try {
      const d = await getJSON("/api/governance");
      const rows = Object.entries(d.checks).map(([key, c]) =>
        `<div class="conf-row"><span>${c.passed ? "✓" : "✗"} ${key.replace(/_/g, " ")}</span><span class="muted">${c.detail}</span></div>`
      ).join("");
      box.innerHTML = `
        <div class="glass-card center-card"><h4>AI Trust Score</h4><div class="stat-value">${d.trust_score}/100</div></div>
        <div class="mt">${rows}</div>
        <p class="muted mt">Autonomy: ${d.autonomy_labels[d.autonomy_level]}</p>
      `;
      const sel = document.getElementById("autonomySelect");
      if (sel) sel.value = String(d.autonomy_level);
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  document.getElementById("autonomySelect")?.addEventListener("change", async (e) => {
    try {
      await getJSON("/api/governance/autonomy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: parseInt(e.target.value, 10) }),
      });
      loadGovernance();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------------- Kill Switch ----------------
  async function loadKillSwitch() {
    const box = document.getElementById("killSwitchStatus");
    try {
      const d = await getJSON("/api/kill-switch");
      box.innerHTML = `
        <p><b>${d.enabled ? "🟢 Agents running" : "🔴 Agents stopped"}</b></p>
        <div class="grid-4 mt">${d.agents.map(a => `<div class="glass-card center-card"><h4>${a.name}</h4><div class="muted">${a.status}</div></div>`).join("")}</div>
      `;
    } catch (err) {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  document.getElementById("killSwitchStopBtn")?.addEventListener("click", async () => {
    await getJSON("/api/kill-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    loadKillSwitch();
    loadGovernance();
  });
  document.getElementById("killSwitchResumeBtn")?.addEventListener("click", async () => {
    await getJSON("/api/kill-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    loadKillSwitch();
    loadGovernance();
  });

  // ---------------- Cost & Performance Monitor ----------------
  async function loadOpsMonitor() {
    const grid = document.getElementById("opsMonitorGrid");
    try {
      const d = await getJSON("/api/ops-monitor");
      grid.innerHTML = `
        <div class="glass-card center-card"><h4>Requests</h4><div class="stat-value">${d.requests}</div></div>
        <div class="glass-card center-card"><h4>Avg Latency</h4><div class="stat-value">${d.avg_latency_ms} ms</div></div>
        <div class="glass-card center-card"><h4>Tokens Used</h4><div class="stat-value">${d.total_tokens.toLocaleString()}</div></div>
        <div class="glass-card center-card"><h4>Success Rate</h4><div class="stat-value">${d.success_rate_pct}%</div></div>
      `;
    } catch (err) {
      grid.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadTwinCurrent();
    loadRootCauseGraph();
    loadConfidence();
    loadSegmentReasoning();
    loadExperimentColumns();
    loadModelHealth();
    loadGovernance();
    loadKillSwitch();
    loadOpsMonitor();
  });
})();
