/* investigation.js
   -----------------
   Feature #1 (AI Autonomous Investigation) + #2 (Multi-Agent Organization)
   + #14 (Audit Timeline).

   Everything rendered here comes from real backend computation
   (/api/investigate) — this file only controls the PACING of how results
   are revealed on screen (staggered, so it reads as "live"), never the
   content itself. No numbers are invented client-side.

   Depends on API_BASE and fetchWithTimeout, both defined in script.js.
*/

(function () {
  const AGENT_ICONS = {
    data: "🗂️", analytics: "📊", anomaly: "🚨", customer: "👥",
    root_cause: "🎯", evidence: "🔍", decision: "✅",
  };

  async function loadAgentOrg() {
    const grid = document.getElementById("agentOrgGrid");
    if (!grid) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/agent-org`, {}, 15000);
      if (!res.ok) throw new Error("Could not load agent roster.");
      const data = await res.json();
      grid.innerHTML = data.agents.map(a => `
        <div class="glass-card agent-org-card">
          <div class="agent-org-icon">${AGENT_ICONS[a.id] || "🤖"}</div>
          <h4>${a.name}</h4>
          <p class="muted">${a.role}</p>
        </div>
      `).join("");
    } catch (err) {
      grid.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  function stepRowHtml(step, revealed) {
    const icon = revealed ? "✓" : "…";
    const cls = revealed ? "investigation-step done" : "investigation-step pending";
    return `<li class="${cls}" data-agent="${step.agent_id}">
      <span class="step-check">${icon}</span>
      <span class="step-text"><b>${step.agent}:</b> ${revealed ? step.summary : "Working…"}</span>
    </li>`;
  }

  function revealStepsSequentially(steps, listEl, onDone) {
    listEl.innerHTML = steps.map(s => stepRowHtml(s, false)).join("");
    const rows = Array.from(listEl.querySelectorAll(".investigation-step"));

    let i = 0;
    function revealNext() {
      if (i >= steps.length) {
        if (onDone) onDone();
        return;
      }
      const row = rows[i];
      row.classList.remove("pending");
      row.classList.add("done");
      row.querySelector(".step-check").textContent = "✓";
      row.querySelector(".step-text").innerHTML = `<b>${steps[i].agent}:</b> ${steps[i].summary}`;
      i += 1;
      setTimeout(revealNext, 420);
    }
    setTimeout(revealNext, 250);
  }

  async function runInvestigation() {
    const btn = document.getElementById("runInvestigationBtn");
    const panel = document.getElementById("investigationPanel");
    const stepsList = document.getElementById("investigationSteps");
    const resultBlock = document.getElementById("investigationResult");
    const question = document.getElementById("investigationQuestion").value.trim();

    btn.disabled = true;
    btn.textContent = "Investigating…";
    panel.style.display = "block";
    resultBlock.style.display = "none";
    stepsList.innerHTML = `<li class="investigation-step pending"><span class="step-check">…</span><span class="step-text">Starting investigation…</span></li>`;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/investigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question || null }),
      }, 60000);

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Investigation failed.");

      revealStepsSequentially(data.steps, stepsList, () => {
        document.getElementById("investigationFinalFinding").textContent = data.final_finding;

        const evidenceStep = data.steps.find(s => s.agent_id === "evidence");
        document.getElementById("investigationEvidence").textContent =
          (data.evidence_verified ? "🟢 VERIFIED — " : "🔴 UNVERIFIED — ") + (evidenceStep ? evidenceStep.summary : "");

        document.getElementById("investigationRecommendation").textContent = data.recommendation;

        const impactWrap = document.getElementById("investigationImpactWrap");
        if (data.impact) {
          impactWrap.style.display = "grid";
          document.getElementById("investigationImpactValue").textContent =
            Number(data.impact.estimated_total_recovery).toLocaleString(undefined, { maximumFractionDigits: 2 });
          document.getElementById("investigationImpactDetail").textContent =
            `${data.impact.affected_customers.toLocaleString()} customers affected · ${data.impact.methodology}`;
        } else {
          impactWrap.style.display = "none";
        }

        document.getElementById("investigationConfidenceValue").textContent = data.confidence.overall + "%";
        const f = data.confidence.factors;
        document.getElementById("investigationConfidenceDetail").textContent =
          `Completeness ${f.data_completeness}% · Coverage ${f.historical_coverage}% · Segmentation ${f.segment_separation}%`;

        resultBlock.style.display = "block";
        loadAuditTimeline();
      });
    } catch (err) {
      stepsList.innerHTML = `<li class="investigation-step error"><span class="step-check">✗</span><span class="step-text">${err.message}</span></li>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Investigate";
    }
  }

  async function loadAuditTimeline() {
    const list = document.getElementById("auditTimelineList");
    if (!list) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/audit-timeline`, {}, 15000);
      if (!res.ok) throw new Error("Could not load audit timeline.");
      const data = await res.json();
      if (!data.events.length) {
        list.innerHTML = `<p class="muted">No investigations run yet.</p>`;
        return;
      }
      list.innerHTML = data.events.slice().reverse().map(e => `
        <div class="audit-event">
          <span class="audit-time">${e.time}</span>
          <span class="audit-agent">${e.agent}</span>
          <span class="audit-summary">${e.summary}</span>
        </div>
      `).join("");
    } catch (err) {
      list.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadAgentOrg();
    loadAuditTimeline();
    const btn = document.getElementById("runInvestigationBtn");
    if (btn) btn.addEventListener("click", runInvestigation);
    const input = document.getElementById("investigationQuestion");
    if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") runInvestigation(); });
  });
})();
