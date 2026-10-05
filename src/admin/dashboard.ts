import type { Env } from "../config/env";
import { ensureAnalyticsSchema } from "../analytics/db";

export async function adminDashboard(env: Env): Promise<Response> {
  if (!env.DB) return new Response("D1 analytics database is not configured.", { status: 503 });
  await ensureAnalyticsSchema(env);
  return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function adminOverview(env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const now = Date.now();
  const startDay = startOfIndiaDay(now);
  const start7 = now - 7 * 86_400_000;
  const start30 = now - 30 * 86_400_000;

  const [users, usersToday, questionsToday, questions7, questions30, completed7, failed7, avgLatency7, limits7, topSubjects, topTopics, thinking, recent] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM users`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM users WHERE first_seen_at >= ?`).bind(startDay).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM questions WHERE received_at >= ?`).bind(startDay).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM questions WHERE received_at >= ?`).bind(start7).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM questions WHERE received_at >= ?`).bind(start30).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM questions WHERE received_at >= ? AND status = 'completed'`).bind(start7).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM questions WHERE received_at >= ? AND status != 'completed'`).bind(start7).first<{ count: number }>(),
    env.DB.prepare(`SELECT COALESCE(ROUND(AVG(latency_ms)),0) AS value FROM questions WHERE received_at >= ? AND status = 'completed' AND latency_ms IS NOT NULL`).bind(start7).first<{ value: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM events WHERE event_at >= ? AND event_type = 'daily_limit_reached'`).bind(start7).first<{ count: number }>(),
    env.DB.prepare(`SELECT COALESCE(subject,'unknown') AS label, COUNT(*) AS count FROM questions WHERE received_at >= ? GROUP BY subject ORDER BY count DESC LIMIT 8`).bind(start30).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COALESCE(topic,'unknown') AS label, COUNT(*) AS count FROM questions WHERE received_at >= ? GROUP BY topic ORDER BY count DESC LIMIT 10`).bind(start30).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COALESCE(thinking_level,'unknown') AS label, COUNT(*) AS count FROM questions WHERE received_at >= ? GROUP BY thinking_level ORDER BY count DESC`).bind(start7).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT update_id, telegram_user_id, username, display_name, question_text, received_at, status, subject, topic, question_mode, thinking_level, latency_ms FROM questions ORDER BY received_at DESC LIMIT 40`).all<Record<string, unknown>>(),
  ]);

  return json({
    ok: true,
    generatedAt: now,
    metrics: {
      totalStudents: Number(users?.count ?? 0),
      newStudentsToday: Number(usersToday?.count ?? 0),
      questionsToday: Number(questionsToday?.count ?? 0),
      questions7d: Number(questions7?.count ?? 0),
      questions30d: Number(questions30?.count ?? 0),
      completed7d: Number(completed7?.count ?? 0),
      nonCompleted7d: Number(failed7?.count ?? 0),
      averageLatencyMs7d: Number(avgLatency7?.value ?? 0),
      dailyLimitEvents7d: Number(limits7?.count ?? 0),
    },
    topSubjects: rows(topSubjects?.results),
    topTopics: rows(topTopics?.results),
    thinking: rows(thinking?.results),
    recent: recent?.results ?? [],
  });
}

export async function adminUsers(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const params: unknown[] = [];
  let where = "";
  if (q) {
    where = `WHERE username LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR CAST(telegram_user_id AS TEXT) LIKE ?`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const result = await env.DB.prepare(
    `SELECT u.telegram_user_id, u.username, u.first_name, u.last_name, u.first_seen_at, u.target_exam,
      (SELECT COUNT(*) FROM questions q WHERE q.telegram_user_id = u.telegram_user_id) AS question_count,
      (SELECT MAX(q.received_at) FROM questions q WHERE q.telegram_user_id = u.telegram_user_id) AS last_question_at
     FROM users u ${where}
     ORDER BY COALESCE(last_question_at, u.first_seen_at) DESC LIMIT ?`
  ).bind(...params, limit).all<Record<string, unknown>>();
  return json({ ok: true, users: result.results ?? [] });
}

export async function adminUserQuestions(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const url = new URL(request.url);
  const userId = Number(url.searchParams.get("user_id"));
  if (!Number.isSafeInteger(userId) || userId === 0) return json({ ok: false, error: "invalid_user_id" }, 400);
  const result = await env.DB.prepare(`SELECT * FROM questions WHERE telegram_user_id = ? ORDER BY received_at DESC LIMIT 100`).bind(userId).all<Record<string, unknown>>();
  return json({ ok: true, questions: result.results ?? [] });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function rows(value: unknown[] | undefined): Array<{ label: string; count: number }> {
  return (value ?? []).map((row) => ({ label: String((row as Record<string, unknown>).label ?? "unknown"), count: Number((row as Record<string, unknown>).count ?? 0) }));
}

function startOfIndiaDay(timestamp: number): number {
  const shifted = new Date(timestamp + 330 * 60 * 1_000);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return start - 330 * 60 * 1_000;
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parmar AI Admin</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;background:#f3f6fb}*{box-sizing:border-box}body{margin:0}header{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #e5e7eb}.nav{max-width:1440px;margin:auto;padding:16px 22px;display:flex;align-items:center;justify-content:space-between}.brand{font-size:20px;font-weight:800}.sub{font-size:12px;color:#6b7280}.wrap{max-width:1440px;margin:auto;padding:22px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 6px 24px rgba(15,23,42,.05)}.metric{padding:18px}.metric .label{font-size:12px;color:#6b7280}.metric .value{font-size:29px;font-weight:800;margin-top:5px}.sections{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.section{padding:18px}.section h2{margin:0 0 12px;font-size:16px}.bar{display:grid;grid-template-columns:140px 1fr 55px;gap:10px;align-items:center;margin:8px 0;font-size:13px}.track{height:9px;border-radius:99px;background:#edf2f7;overflow:hidden}.fill{height:100%;background:#111827}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;font-size:13px}.table th,.table td{padding:10px 9px;border-bottom:1px solid #edf0f4;text-align:left;vertical-align:top}.table th{color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#eef2ff;font-size:11px}.muted{color:#6b7280}.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:12px}.toolbar input{flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px}.btn{border:0;border-radius:10px;padding:10px 13px;font-weight:700;cursor:pointer;background:#111827;color:#fff}.btn.alt{background:#eef2f7;color:#111827}.status-completed{color:#047857}.status-pending{color:#b45309}.status-failed{color:#b91c1c}@media(max-width:1050px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sections{grid-template-columns:1fr}}@media(max-width:650px){.grid{grid-template-columns:1fr}.wrap{padding:14px}}
</style></head><body><header><div class="nav"><div><div class="brand">Parmar AI — Admin</div><div class="sub">SSC operations, students, questions & system health</div></div><button class="btn alt" onclick="logout()">Sign out</button></div></header><main class="wrap"><section id="metrics" class="grid"></section><section class="sections"><div class="card section"><h2>Subjects — last 30 days</h2><div id="subjects"></div></div><div class="card section"><h2>Thinking levels — last 7 days</h2><div id="thinking"></div></div></section><section class="card section" style="margin-top:16px"><h2>Recent questions</h2><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Student</th><th>Question</th><th>Topic</th><th>Mode</th><th>Think</th><th>Status</th></tr></thead><tbody id="recent"></tbody></table></div></section><section class="card section" style="margin-top:16px"><h2>Students</h2><div class="toolbar"><input id="userSearch" placeholder="Search @username, name or Telegram ID"><button class="btn" onclick="loadUsers()">Search</button></div><div class="table-wrap"><table class="table"><thead><tr><th>First seen</th><th>Student</th><th>Telegram ID</th><th>Exam</th><th>Questions</th><th>Last question</th></tr></thead><tbody id="users"></tbody></table></div><div id="studentDetail" style="margin-top:16px"></div></section><section class="card section" style="margin-top:16px"><h2>Top topics — last 30 days</h2><div id="topics"></div></section></main><script>
const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));const fmt=t=>t?new Date(Number(t)).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
async function api(path){const r=await fetch(path,{credentials:'same-origin'});if(r.status===401){location.href='/admin/login';throw new Error('auth')}return r.json()}
function renderBars(el,items){const max=Math.max(1,...items.map(x=>x.count));$(el).innerHTML=items.map(x=>'<div class="bar"><div>'+esc(x.label)+'</div><div class="track"><div class="fill" style="width:'+Math.max(2,Math.round(x.count/max*100))+'%"></div></div><div>'+x.count+'</div></div>').join('')||'<span class="muted">No data</span>'}
async function loadOverview(){const d=await api('/admin/api/overview');const m=d.metrics;$('metrics').innerHTML=[['Total students',m.totalStudents],['New today',m.newStudentsToday],['Questions today',m.questionsToday],['Questions 7d',m.questions7d],['Questions 30d',m.questions30d],['Completed 7d',m.completed7d],['Avg latency',m.averageLatencyMs7d+' ms'],['Limit hits 7d',m.dailyLimitEvents7d]].map(x=>'<div class="card metric"><div class="label">'+x[0]+'</div><div class="value">'+x[1]+'</div></div>').join('');renderBars('subjects',d.topSubjects);renderBars('thinking',d.thinking);renderBars('topics',d.topTopics);$('recent').innerHTML=d.recent.map(q=>'<tr><td>'+esc(fmt(q.received_at))+'</td><td><b>'+esc(q.display_name||q.username||q.telegram_user_id)+'</b><br><span class="muted">'+esc(q.username?'@'+q.username:'ID '+q.telegram_user_id)+'</span></td><td style="min-width:260px">'+esc(q.question_text)+'</td><td>'+esc(q.topic||'—')+'<br><span class="muted">'+esc(q.subject||'')+'</span></td><td><span class="pill">'+esc(q.question_mode||'—')+'</span></td><td>'+esc(q.thinking_level||'—')+'</td><td class="status-'+esc(q.status||'pending')+'">'+esc(q.status||'pending')+'</td></tr>').join('')||'<tr><td colspan="7" class="muted">No questions yet.</td></tr>'}
async function loadUsers(){const q=encodeURIComponent($('userSearch').value.trim());const d=await api('/admin/api/users?q='+q+'&limit=100');$('users').innerHTML=d.users.map(u=>'<tr onclick="loadStudent('+u.telegram_user_id+')" style="cursor:pointer"><td>'+esc(fmt(u.first_seen_at))+'</td><td><b>'+esc([u.first_name,u.last_name].filter(Boolean).join(' ')||u.username||u.telegram_user_id)+'</b><br><span class="muted">'+esc(u.username?'@'+u.username:'')+'</span></td><td>'+esc(u.telegram_user_id)+'</td><td>'+esc(u.target_exam||'Not set')+'</td><td>'+esc(u.question_count)+'</td><td>'+esc(fmt(u.last_question_at))+'</td></tr>').join('')||'<tr><td colspan="6" class="muted">No students found.</td></tr>'}
async function loadStudent(id){const d=await api('/admin/api/questions?user_id='+encodeURIComponent(id));const rows=d.questions||[];$('studentDetail').innerHTML='<h3>Student '+esc(id)+' — recent questions</h3><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Status</th><th>Question</th><th>Topic</th><th>Thinking</th><th>Latency</th><th>Answer</th></tr></thead><tbody>'+rows.map(q=>'<tr><td>'+esc(fmt(q.received_at))+'</td><td>'+esc(q.status)+'</td><td style="min-width:260px">'+esc(q.question_text)+'</td><td>'+esc(q.topic||'—')+'</td><td>'+esc(q.thinking_level||'—')+'</td><td>'+esc(q.latency_ms? q.latency_ms+' ms':'—')+'</td><td style="min-width:300px">'+esc(q.answer_text||q.error_message||'—')+'</td></tr>').join('')+'</tbody></table></div>'}
async function logout(){await fetch('/admin/logout',{method:'POST'});location.href='/admin/login'}
loadOverview();loadUsers();setInterval(loadOverview,30000);
</script></body></html>`;
