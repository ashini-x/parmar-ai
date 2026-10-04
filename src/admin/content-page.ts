export function getContentAdminHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>SawalNewton Content Factory</title>
<style>
body{font-family:Inter,system-ui,sans-serif;background:#f5f6fa;color:#17191f;margin:0}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px 48px}
.card{background:#fff;border:1px solid #e4e7ec;border-radius:18px;padding:18px;margin-top:16px;box-shadow:0 8px 24px rgba(0,0,0,.04)}
h1{margin:0;font-size:28px}
h2{font-size:19px;margin:0 0 12px}
.muted{color:#69707d;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
label{font-size:12px;font-weight:700;color:#4b5563;display:block;margin-bottom:5px}
input,select,button{font:inherit}
input,select{width:100%;padding:11px;border:1px solid #d9dde5;border-radius:10px;background:#fff}
button{border:0;border-radius:10px;padding:11px 15px;font-weight:800;cursor:pointer;background:#111827;color:#fff}
button:disabled{opacity:.55;cursor:default}
.secondary{background:#eef0f4;color:#17191f}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.status{padding:10px 12px;border-radius:10px;background:#f1f5f9;margin-top:10px;white-space:pre-wrap}
.ok{background:#ecfdf3;color:#067647}
.warn{background:#fff7ed;color:#9a3412}
.bad{background:#fef2f2;color:#b42318}
.table-wrap{overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:10px;border-bottom:1px solid #edf0f4;text-align:left;vertical-align:top}
th{font-size:11px;text-transform:uppercase;color:#667085}
.pill{display:inline-block;border-radius:999px;padding:4px 8px;background:#eef2ff;font-size:11px;font-weight:800}
.question{min-width:300px;max-width:500px;white-space:pre-wrap}
.small{font-size:11px;color:#667085}
.check{width:auto}
.mono{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all}
</style>
</head>
<body>
<div class="wrap">
<h1>🧠 SawalNewton Content Factory</h1>
<div class="muted">
Upload an SSC source. Fast Import uses deterministic parsing and never calls Gemini.
AI Enhancement is optional for Hindi translation, classification, explanations, and answer checks.
</div>

<div class="card">
<h2>Admin access</h2>
<div class="grid">
<div>
<label>Admin secret</label>
<input id="secret" type="password" placeholder="Your ADMIN_SECRET" autocomplete="off" />
</div>
</div>
<div class="row" style="margin-top:10px">
<button class="secondary" id="saveSecret" type="button">Save secret</button>
<span class="small">Stored only in this browser tab.</span>
</div>
<div id="secretStatus" class="status" style="display:none"></div>
</div>

<div class="card">
<h2>1. Process a source</h2>
<div id="uploadForm">
<div class="grid">
<div>
<label>Source file</label>
<input id="file" type="file" accept="application/pdf,text/plain,text/csv,application/json,.json" />
</div>
<div>
<label>Source label</label>
<input id="sourceName" placeholder="SSC CGL 2022 Shift 3 Maths" />
</div>
<div>
<label>Exam</label>
<input id="exam" value="SSC CGL" />
</div>
<div>
<label>Tier</label>
<input id="tier" value="Tier-I" />
</div>
<div>
<label>Year</label>
<input id="year" type="number" min="2016" max="2026" value="2022" />
</div>
<div>
<label>Shift</label>
<input id="shift" placeholder="Shift 3" />
</div>
<div>
<label>Subject</label>
<select id="subject">
<option>Maths</option>
<option>Reasoning</option>
<option>English</option>
<option>GK</option>
</select>
</div>
<div>
<label>Processing mode</label>
<select id="mode">
<option value="deterministic">⚡ Fast import — no AI</option>
<option value="ai">🤖 AI extraction — optional</option>
</select>
</div>
<div>
<label>Max questions this run</label>
<input id="maxQuestions" type="number" min="1" max="100" value="20" />
</div>
</div>
<div class="row" style="margin-top:14px">
<button id="processBtn" type="button">⚡ Import without AI</button>
</div>
</div>
<div id="uploadStatus" class="status" style="display:none"></div>
</div>

<div class="card">
<div class="row">
<h2 style="margin-right:auto">2. Staging queue</h2>
<select id="statusFilter" style="width:auto">
<option value="auto_ready">Auto-ready</option>
<option value="needs_review">Needs review</option>
<option value="duplicate">Duplicates</option>
<option value="">All</option>
<option value="approved">Approved</option>
</select>
<button class="secondary" id="refresh" type="button">Refresh</button>
<button class="secondary" id="backfill" type="button">Backfill fingerprints</button>
<button class="secondary" id="enhance" type="button">✨ AI Enhance selected</button>
<button class="secondary" id="publishReady" type="button">Publish all auto-ready</button>
<button id="approve" type="button">Publish selected</button>
</div>
<div id="candidateStatus" class="status"></div>
<div class="table-wrap">
<table>
<thead>
<tr><th></th><th>Candidate</th><th>English</th><th>Hindi</th><th>Answer check</th><th>Confidence</th><th>Status</th></tr>
</thead>
<tbody id="candidateBody"></tbody>
</table>
</div>
</div>

<div class="card">
<h2>3. Recent batches</h2>
<div class="table-wrap">
<table>
<thead><tr><th>ID</th><th>Source</th><th>Meta</th><th>Status</th><th>Counts</th></tr></thead>
<tbody id="batchBody"></tbody>
</table>
</div>
</div>
</div>
<script src="/admin/content.js?v=1332" defer></script>
</body>
</html>`;
}
