export function getContentAdminScript(): string {
  return `(() => {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function getSecret() {
    const input = byId("secret");
    const typed = input && typeof input.value === "string" ? input.value : "";
    return typed || sessionStorage.getItem("sawal_admin_secret") || "";
  }

  function setStatus(id, text, kind) {
    const el = byId(id);
    if (!el) return;
    el.style.display = "block";
    el.className = "status" + (kind ? " " + kind : "");
    el.textContent = String(text ?? "");
  }

  async function parseResponse(response) {
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (_) {
      throw new Error(
        "Server returned HTTP " + response.status + " with a non-JSON response."
      );
    }
    if (!response.ok || !data || !data.ok) {
      throw new Error(
        (data && data.error ? data.error : "request_failed") +
        " (HTTP " + response.status + ")"
      );
    }
    return data;
  }

  async function api(path, options) {
    const opts = options || {};
    const headers = new Headers(opts.headers || {});
    headers.set("X-Admin-Secret", getSecret());
    return fetch(path, {
      ...opts,
      headers,
      credentials: "same-origin",
      cache: "no-store"
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function refreshCandidates() {
    const status = byId("statusFilter").value;
    try {
      const response = await api(
        "/api/admin/content/candidates?status=" + encodeURIComponent(status)
      );
      const data = await parseResponse(response);
      const body = byId("candidateBody");
      body.replaceChildren();

      for (const candidate of data.candidates || []) {
        const row = document.createElement("tr");
        const statusClass =
          candidate.status === "auto_ready" ? "ok" :
          candidate.status === "needs_review" ? "warn" :
          candidate.status === "duplicate" ? "bad" : "";

        row.innerHTML =
          "<td><input class='check' type='checkbox' value='" + Number(candidate.id) + "'></td>" +
          "<td><b>#" + Number(candidate.id) + "</b><div class='small'>" +
          escapeHtml(candidate.exam) + " · " +
          escapeHtml(candidate.year) + " · " +
          escapeHtml(candidate.shift || "") + "<br>" +
          escapeHtml(candidate.subject) + " · " +
          escapeHtml(candidate.topic || "") + " · " +
          escapeHtml(candidate.difficulty || "") +
          "</div></td>" +
          "<td class='question'>" +
          escapeHtml(candidate.english_question || "") +
          "<div class='small'>" +
          "A: " + escapeHtml(candidate.english_option_a || "") +
          "<br>B: " + escapeHtml(candidate.english_option_b || "") +
          "<br>C: " + escapeHtml(candidate.english_option_c || "") +
          "<br>D: " + escapeHtml(candidate.english_option_d || "") +
          "</div></td>" +
          "<td class='question'>" + escapeHtml(candidate.hindi_question || "") + "</td>" +
          "<td><b>" + escapeHtml(candidate.source_correct_option || "—") +
          "</b> / <b>" + escapeHtml(candidate.verified_correct_option || "—") +
          "</b><div class='small'>" + escapeHtml(candidate.answer_verification || "") + "</div></td>" +
          "<td>" + Number(candidate.confidence || 0).toFixed(2) + "</td>" +
          "<td><span class='pill " + statusClass + "'>" + escapeHtml(candidate.status) + "</span></td>";

        body.appendChild(row);
      }

      setStatus(
        "candidateStatus",
        String((data.candidates || []).length) + " candidates loaded.",
        "ok"
      );
    } catch (error) {
      setStatus(
        "candidateStatus",
        error instanceof Error ? error.message : String(error),
        "bad"
      );
    }
  }

  async function refreshBatches() {
    try {
      const response = await api("/api/admin/content/batches");
      const data = await parseResponse(response);
      const body = byId("batchBody");
      body.replaceChildren();

      for (const batch of data.batches || []) {
        const row = document.createElement("tr");
        const error = batch.error_message
          ? "<div class='small' style='margin-top:6px;color:#b42318'>" +
            escapeHtml(batch.error_message) +
            "</div>"
          : "";

        row.innerHTML =
          "<td>" + Number(batch.id) + "</td>" +
          "<td>" + escapeHtml(batch.source_name) + "</td>" +
          "<td>" + escapeHtml(batch.exam) + " · " +
          escapeHtml(batch.year) + " · " + escapeHtml(batch.subject) + "</td>" +
          "<td><b>" + escapeHtml(batch.status) + "</b>" + error + "</td>" +
          "<td>Extracted " + Number(batch.extracted_count || 0) +
          " · Ready " + Number(batch.auto_ready_count || 0) +
          " · Review " + Number(batch.needs_review_count || 0) +
          " · Dup " + Number(batch.duplicate_count || 0) + "</td>";

        body.appendChild(row);
      }
    } catch (error) {
      setStatus(
        "candidateStatus",
        error instanceof Error ? error.message : String(error),
        "bad"
      );
    }
  }

  async function refreshAll() {
    await Promise.all([refreshCandidates(), refreshBatches()]);
  }

  function selectedIds() {
    return Array.from(document.querySelectorAll(".check:checked"))
      .map((element) => Number(element.value))
      .filter((id) => Number.isInteger(id) && id > 0);
  }

  async function processUpload() {
    const fileInput = byId("file");
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;
    const sourceName = byId("sourceName").value.trim();
    const exam = byId("exam").value.trim();
    const year = byId("year").value;

    if (!getSecret()) {
      setStatus("uploadStatus", "Enter and save ADMIN_SECRET first.", "bad");
      return;
    }
    if (!file) {
      setStatus("uploadStatus", "Choose a source file first.", "bad");
      fileInput.focus();
      return;
    }
    if (!sourceName) {
      setStatus("uploadStatus", "Enter a source label first.", "bad");
      byId("sourceName").focus();
      return;
    }
    if (!exam) {
      setStatus("uploadStatus", "Enter the exam name first.", "bad");
      byId("exam").focus();
      return;
    }
    if (!year || Number(year) < 2016 || Number(year) > 2026) {
      setStatus("uploadStatus", "Year must be between 2016 and 2026.", "bad");
      byId("year").focus();
      return;
    }

    const form = new FormData();
    form.set("file", file);
    form.set("source_name", sourceName);
    form.set("exam", exam);
    form.set("tier", byId("tier").value);
    form.set("year", year);
    form.set("shift", byId("shift").value);
    form.set("subject", byId("subject").value);
    form.set("max_questions", byId("maxQuestions").value);
    form.set("mode", byId("mode").value);

    const mode = byId("mode").value;
    const button = byId("processBtn");
    button.disabled = true;
    button.textContent = mode === "ai" ? "AI processing..." : "Importing...";

    setStatus(
      "uploadStatus",
      mode === "ai"
        ? "AI extraction is running. Keep this tab open."
        : "Fast Import is running. No Gemini call is made.",
      "warn"
    );

    try {
      const response = await api(
        "/api/admin/content/ingest",
        { method: "POST", body: form }
      );
      const data = await parseResponse(response);
      setStatus(
        "uploadStatus",
        "Batch " + data.summary.batchId + " completed\n" +
          JSON.stringify(data.summary, null, 2),
        "ok"
      );
      await refreshAll();
    } catch (error) {
      setStatus(
        "uploadStatus",
        error instanceof Error ? error.message : String(error),
        "bad"
      );
    } finally {
      button.disabled = false;
      button.textContent = byId("mode").value === "ai"
        ? "🤖 Extract with AI"
        : "⚡ Import without AI";
    }
  }

  async function backfill() {
    if (!confirm("Backfill exact fingerprints for the existing active question bank?")) return;
    setStatus("candidateStatus", "Fingerprint backfill is running...", "warn");
    try {
      const data = await parseResponse(await api("/api/admin/content/backfill", { method: "POST" }));
      setStatus("candidateStatus", JSON.stringify(data.result, null, 2), "ok");
      await refreshAll();
    } catch (error) {
      setStatus("candidateStatus", error instanceof Error ? error.message : String(error), "bad");
    }
  }

  async function enhance() {
    const ids = selectedIds();
    if (!ids.length) {
      setStatus("candidateStatus", "Select at least one candidate to enhance.", "warn");
      return;
    }
    if (ids.length > 25) {
      setStatus("candidateStatus", "Select at most 25 candidates per AI enhancement run.", "warn");
      return;
    }
    if (!confirm("Use optional AI enhancement on " + ids.length + " candidate(s)?\n\nThis may use your configured Gemini API quota.")) return;

    setStatus("candidateStatus", "AI enhancement is running.", "warn");
    try {
      const data = await parseResponse(await api("/api/admin/content/enhance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateIds: ids })
      }));
      setStatus("candidateStatus", JSON.stringify(data.result, null, 2), "ok");
      await refreshAll();
    } catch (error) {
      setStatus("candidateStatus", error instanceof Error ? error.message : String(error), "bad");
    }
  }

  async function publishReady() {
    if (!confirm("Publish up to the first 100 auto-ready candidates?")) return;
    setStatus("candidateStatus", "Publishing auto-ready candidates...", "warn");
    try {
      const data = await parseResponse(await api("/api/admin/content/publish-ready", { method: "POST" }));
      setStatus("candidateStatus", JSON.stringify(data.result, null, 2), "ok");
      await refreshAll();
    } catch (error) {
      setStatus("candidateStatus", error instanceof Error ? error.message : String(error), "bad");
    }
  }

  async function approve() {
    const ids = selectedIds();
    if (!ids.length) {
      setStatus("candidateStatus", "Select at least one candidate.", "warn");
      return;
    }
    if (!confirm("Publish " + ids.length + " candidate(s) to the production question bank?")) return;

    setStatus("candidateStatus", "Publishing selected candidates...", "warn");
    try {
      const data = await parseResponse(await api("/api/admin/content/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateIds: ids })
      }));
      setStatus("candidateStatus", JSON.stringify(data.result, null, 2), "ok");
      await refreshAll();
    } catch (error) {
      setStatus("candidateStatus", error instanceof Error ? error.message : String(error), "bad");
    }
  }

  function init() {
    try {
      const saved = sessionStorage.getItem("sawal_admin_secret") || "";
      byId("secret").value = saved;

      byId("saveSecret").addEventListener("click", () => {
        const value = byId("secret").value.trim();
        if (!value) {
          setStatus("secretStatus", "Enter ADMIN_SECRET first.", "bad");
          return;
        }
        sessionStorage.setItem("sawal_admin_secret", value);
        setStatus("secretStatus", "Admin secret saved in this browser tab.", "ok");
        refreshAll();
      });

      byId("processBtn").addEventListener("click", processUpload);
      byId("mode").addEventListener("change", () => {
        byId("processBtn").textContent = byId("mode").value === "ai"
          ? "🤖 Extract with AI"
          : "⚡ Import without AI";
      });
      byId("refresh").addEventListener("click", refreshAll);
      byId("statusFilter").addEventListener("change", refreshCandidates);
      byId("backfill").addEventListener("click", backfill);
      byId("enhance").addEventListener("click", enhance);
      byId("publishReady").addEventListener("click", publishReady);
      byId("approve").addEventListener("click", approve);

      window.addEventListener("error", (event) => {
        setStatus("candidateStatus", "Admin JavaScript error: " + event.message, "bad");
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
        setStatus("candidateStatus", "Admin request error: " + reason, "bad");
      });

      refreshAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      document.body.insertAdjacentHTML(
        "afterbegin",
        "<div style='padding:12px;background:#fef2f2;color:#b42318;font-family:system-ui'>Admin page initialization failed: " +
          escapeHtml(message) +
          "</div>"
      );
    }
  }

  init();
})();`;
}
