import type { Env } from "../config/env";
import { ensureAnalyticsSchema, grantUnlimitedAiAccess, hasUnlimitedAiAccess, recordAdminAudit, revokeUnlimitedAiAccess, setUserSuspended } from "../analytics/db";
import { getConfig } from "../config/env";
import {
  activateTelegramBot,
  getActiveTelegramBot,
  getTelegramBotByBotId,
  getTelegramEncryptionStatus,
  listTelegramBots,
  hasTelegramBotRecords,
  markTelegramBotDisconnected,
  markTelegramBotVerified,
  saveTelegramBot,
} from "../telegram/bot-store";

export async function adminDashboard(env: Env): Promise<Response> {
  if (!env.DB) return new Response("D1 analytics database is not configured.", { status: 503 });
  await ensureAnalyticsSchema(env);
  return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function adminOverview(env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const now = Date.now();
  const day = startOfIndiaDay(now);
  const start24 = now - 86_400_000;
  const start7 = now - 7 * 86_400_000;
  const start30 = now - 30 * 86_400_000;
  const last10 = now - 10 * 60_000;
  const last15 = now - 15 * 60_000;

  const [counts, ai, subjects, topics, thinking, limits, activity, recentFailures, alerts, quota, topUsers, retention] = await Promise.all([
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM users) AS total_students,
      (SELECT COUNT(*) FROM users WHERE first_seen_at >= ?) AS new_students_today,
      (SELECT COUNT(DISTINCT telegram_user_id) FROM questions WHERE received_at >= ?) AS active_students_today,
      (SELECT COUNT(DISTINCT telegram_user_id) FROM questions WHERE received_at >= ?) AS active_students_7d,
      (SELECT COUNT(DISTINCT telegram_user_id) FROM questions WHERE received_at >= ?) AS active_students_30d,
      (SELECT COUNT(DISTINCT telegram_user_id) FROM questions WHERE received_at >= ?) AS active_students_now,
      (SELECT COUNT(DISTINCT q.telegram_user_id) FROM questions q JOIN users u ON u.telegram_user_id=q.telegram_user_id WHERE q.received_at >= ? AND u.first_seen_at < ?) AS returning_students_today,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ?) AS questions_today,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ?) AS questions_24h,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ?) AS questions_7d,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ?) AS questions_30d,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ? AND status='completed') AS completed_24h,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ? AND status='failed') AS failed_24h,
      (SELECT COALESCE(ROUND(AVG(latency_ms)),0) FROM questions WHERE received_at >= ? AND status='completed' AND latency_ms IS NOT NULL) AS avg_latency_24h,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ? AND status IN ('pending','processing')) AS pending_jobs,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ? AND status='processing') AS processing_jobs,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ? AND attempts > 1) AS retried_questions,
      (SELECT COUNT(*) FROM events WHERE event_at >= ? AND event_type='daily_limit_reached') AS daily_limit_events,
      (SELECT COUNT(*) FROM events WHERE event_at >= ? AND event_type='burst_limit_reached') AS burst_limit_events,
      (SELECT COUNT(*) FROM questions WHERE received_at >= ? AND status!='completed') AS non_completed_7d`
    ).bind(day, day, start7, start30, last10, day, day, day, start24, start7, start30, start24, start24, start24, last10, last10, start7, day, day, start7).first<Record<string, number>>(),
    env.DB.prepare(`SELECT
      COUNT(*) AS usage_attempts,
      COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
      COALESCE(SUM(candidates_tokens),0) AS candidates_tokens,
      COALESCE(SUM(thoughts_tokens),0) AS thoughts_tokens,
      COALESCE(SUM(tool_use_prompt_tokens),0) AS tool_use_prompt_tokens,
      COALESCE(SUM(cached_content_tokens),0) AS cached_content_tokens,
      COALESCE(SUM(total_tokens),0) AS total_tokens,
      COALESCE(SUM(estimated_cost_microusd),0) AS spend_microusd,
      COALESCE(SUM(CASE WHEN attempt > 1 THEN estimated_cost_microusd ELSE 0 END),0) AS retry_spend_microusd,
      COALESCE(SUM(CASE WHEN thinking_level='LOW' THEN estimated_cost_microusd ELSE 0 END),0) AS low_spend_microusd,
      COALESCE(SUM(CASE WHEN thinking_level='MEDIUM' THEN estimated_cost_microusd ELSE 0 END),0) AS medium_spend_microusd,
      COALESCE(SUM(CASE WHEN thinking_level='HIGH' THEN estimated_cost_microusd ELSE 0 END),0) AS high_spend_microusd
      FROM ai_usage_attempts WHERE recorded_at >= ?`).bind(day).first<Record<string, number>>(),
    env.DB.prepare(`SELECT COALESCE(subject,'unknown') AS label, COUNT(*) AS count FROM questions WHERE received_at >= ? GROUP BY subject ORDER BY count DESC LIMIT 10`).bind(start30).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COALESCE(topic,'unknown') AS label, COUNT(*) AS count FROM questions WHERE received_at >= ? GROUP BY topic ORDER BY count DESC LIMIT 12`).bind(start30).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT thinking_level AS label, COUNT(*) AS count, COALESCE(SUM(estimated_cost_microusd),0) AS spend_microusd FROM ai_usage_attempts WHERE recorded_at >= ? GROUP BY thinking_level ORDER BY count DESC`).bind(start7).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT event_type AS label, COUNT(*) AS count FROM events WHERE event_at >= ? AND event_type IN ('daily_limit_reached','burst_limit_reached') GROUP BY event_type ORDER BY count DESC`).bind(start7).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT q.update_id,q.telegram_user_id,q.username,q.display_name,q.question_text,q.received_at,q.status,q.subject,q.topic,q.question_mode,q.thinking_level,q.latency_ms,q.attempts,
      COALESCE(u.spend_microusd,0) AS spend_microusd, COALESCE(u.total_tokens,0) AS total_tokens
      FROM questions q LEFT JOIN (SELECT update_id, SUM(estimated_cost_microusd) AS spend_microusd, SUM(total_tokens) AS total_tokens FROM ai_usage_attempts GROUP BY update_id) u ON u.update_id=q.update_id
      ORDER BY q.received_at DESC LIMIT 40`).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM questions WHERE received_at >= ? AND status='failed'`).bind(last15).first<Record<string, number>>(),
    env.DB.prepare(`SELECT event_type,COUNT(*) AS count FROM events WHERE event_at >= ? GROUP BY event_type ORDER BY count DESC LIMIT 30`).bind(last15).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT bucket AS label,COUNT(*) AS count FROM (SELECT CASE WHEN COUNT(q.update_id)=0 THEN '0' WHEN COUNT(q.update_id)<=5 THEN '1-5' WHEN COUNT(q.update_id)<=10 THEN '6-10' WHEN COUNT(q.update_id)<=15 THEN '11-15' WHEN COUNT(q.update_id)<=19 THEN '16-19' ELSE '20+' END AS bucket FROM users u LEFT JOIN questions q ON q.telegram_user_id=u.telegram_user_id AND q.received_at>=? GROUP BY u.telegram_user_id) GROUP BY bucket ORDER BY CASE bucket WHEN '0' THEN 1 WHEN '1-5' THEN 2 WHEN '6-10' THEN 3 WHEN '11-15' THEN 4 WHEN '16-19' THEN 5 ELSE 6 END`).bind(day).all<Record<string, unknown>>(),
    env.DB.prepare(`WITH q AS (SELECT telegram_user_id,COUNT(*) questions_today FROM questions WHERE received_at>=? GROUP BY telegram_user_id), a AS (SELECT telegram_user_id,COALESCE(SUM(total_tokens),0) total_tokens,COALESCE(SUM(estimated_cost_microusd),0) spend_microusd FROM ai_usage_attempts WHERE recorded_at>=? GROUP BY telegram_user_id)
      SELECT u.telegram_user_id,u.username,u.first_name,u.last_name,COALESCE(q.questions_today,0) questions_today,COALESCE(a.total_tokens,0) total_tokens,COALESCE(a.spend_microusd,0) spend_microusd FROM users u LEFT JOIN q ON q.telegram_user_id=u.telegram_user_id LEFT JOIN a ON a.telegram_user_id=u.telegram_user_id WHERE COALESCE(q.questions_today,0)>0 ORDER BY questions_today DESC,spend_microusd DESC LIMIT 10`).bind(day, day).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT label,cohort_size,retained_size,CASE WHEN cohort_size>0 THEN CAST(retained_size AS REAL)/cohort_size ELSE 0 END retention_rate FROM (
      SELECT 'D+1' label,COUNT(*) cohort_size,(SELECT COUNT(DISTINCT q.telegram_user_id) FROM questions q JOIN users u ON u.telegram_user_id=q.telegram_user_id WHERE u.first_seen_at>=? AND u.first_seen_at<? AND q.received_at>=?) retained_size FROM users u WHERE u.first_seen_at>=? AND u.first_seen_at<?
      UNION ALL
      SELECT 'D+7',COUNT(*),(SELECT COUNT(DISTINCT q.telegram_user_id) FROM questions q JOIN users u ON u.telegram_user_id=q.telegram_user_id WHERE u.first_seen_at>=? AND u.first_seen_at<? AND q.received_at>=?) FROM users u WHERE u.first_seen_at>=? AND u.first_seen_at<?
      UNION ALL
      SELECT 'D+30',COUNT(*),(SELECT COUNT(DISTINCT q.telegram_user_id) FROM questions q JOIN users u ON u.telegram_user_id=q.telegram_user_id WHERE u.first_seen_at>=? AND u.first_seen_at<? AND q.received_at>=?) FROM users u WHERE u.first_seen_at>=? AND u.first_seen_at<?
    )`).bind(day-86_400_000,day,day,day-86_400_000,day, day-7*86_400_000,day-6*86_400_000,day,day-7*86_400_000,day-6*86_400_000, day-30*86_400_000,day-29*86_400_000,day,day-30*86_400_000,day-29*86_400_000).all<Record<string, unknown>>(),
  ]);

  const c = counts ?? {};
  const usage = ai ?? {};
  const spendUsd = Number(usage.spend_microusd ?? 0) / 1_000_000;
  const budgetUsd = nonNegativeFloat(env.AI_BUDGET_USD);
  const remainingUsd = budgetUsd > 0 ? Math.max(0, budgetUsd - spendUsd) : null;
  const failureRate = Number(c.completed_24h ?? 0) + Number(c.failed_24h ?? 0) > 0
    ? Number(c.failed_24h ?? 0) / (Number(c.completed_24h ?? 0) + Number(c.failed_24h ?? 0))
    : 0;
  const recentFailureCount = Number(recentFailures?.count ?? 0);
  const pending = Number(c.pending_jobs ?? 0);
  const alertList: Array<{ level: "info" | "warning" | "critical"; title: string; message: string }> = [];
  if (recentFailureCount >= 5) alertList.push({ level: "critical", title: "AI failures are elevated", message: `${recentFailureCount} requests failed in the last 15 minutes.` });
  else if (recentFailureCount > 0) alertList.push({ level: "warning", title: "Recent AI failures", message: `${recentFailureCount} failed request${recentFailureCount === 1 ? "" : "s"} in the last 15 minutes.` });
  if (pending >= 20) alertList.push({ level: "warning", title: "Question backlog", message: `${pending} questions are currently pending processing.` });
  if (budgetUsd > 0 && spendUsd / budgetUsd >= 0.8) alertList.push({ level: spendUsd >= budgetUsd ? "critical" : "warning", title: "AI budget", message: `${Math.round((spendUsd / budgetUsd) * 100)}% of the configured AI budget has been used today.` });
  if (failureRate >= 0.05) alertList.push({ level: "warning", title: "24-hour failure rate", message: `${(failureRate * 100).toFixed(1)}% of completed/failed requests failed.` });
  if (!alertList.length) alertList.push({ level: "info", title: "Everything looks healthy", message: "No major operational threshold has been triggered." });

  const status = alertList.some((a) => a.level === "critical") ? "critical" : alertList.some((a) => a.level === "warning") ? "attention" : "healthy";
  return json({
    ok: true,
    generatedAt: now,
    status,
    budget: { configuredUsd: budgetUsd || null, spendUsd, remainingUsd },
    metrics: {
      totalStudents: n(c.total_students), newStudentsToday: n(c.new_students_today), activeStudentsToday: n(c.active_students_today),
      activeStudents7d: n(c.active_students_7d), activeStudents30d: n(c.active_students_30d), activeStudentsNow: n(c.active_students_now), returningStudentsToday: n(c.returning_students_today), questionsToday: n(c.questions_today),
      questions24h: n(c.questions_24h), questions7d: n(c.questions_7d), questions30d: n(c.questions_30d),
      completed24h: n(c.completed_24h), failed24h: n(c.failed_24h), failureRate24h: failureRate,
      averageLatencyMs24h: n(c.avg_latency_24h), pendingJobs: pending, processingJobs: n(c.processing_jobs), retriedQuestions7d: n(c.retried_questions),
      dailyLimitEventsToday: n(c.daily_limit_events), burstLimitEventsToday: n(c.burst_limit_events), nonCompleted7d: n(c.non_completed_7d),
    },
    usage: {
      attemptsToday: n(usage.usage_attempts), promptTokens: n(usage.prompt_tokens), candidatesTokens: n(usage.candidates_tokens),
      thoughtsTokens: n(usage.thoughts_tokens), toolUsePromptTokens: n(usage.tool_use_prompt_tokens), cachedContentTokens: n(usage.cached_content_tokens),
      totalTokens: n(usage.total_tokens), spendUsd, retrySpendUsd: n(usage.retry_spend_microusd) / 1_000_000,
      spendByThinking: { LOW: n(usage.low_spend_microusd) / 1_000_000, MEDIUM: n(usage.medium_spend_microusd) / 1_000_000, HIGH: n(usage.high_spend_microusd) / 1_000_000 },
      averageCostUsd: n(usage.usage_attempts) ? spendUsd / n(usage.usage_attempts) : 0,
      projected30dSpendUsd: spendUsd * 30,
    },
    alerts: alertList,
    topSubjects: rows(subjects?.results), topTopics: rows(topics?.results), thinking: (thinking?.results ?? []).map((r) => ({ label: String(r.label ?? "unknown"), count: Number(r.count ?? 0), spendUsd: Number(r.spend_microusd ?? 0) / 1_000_000 })),
    quotaDistribution: rows(quota?.results),
    topUsersToday: (topUsers?.results ?? []).map((r) => ({ ...r, questionsToday: n(r.questions_today), totalTokens: n(r.total_tokens), spendUsd: n(r.spend_microusd)/1_000_000 })),
    retention: (retention?.results ?? []).map((r) => ({ label: String(r.label ?? ""), cohortSize: n(r.cohort_size), retainedSize: n(r.retained_size), retentionRate: n(r.retention_rate) })),
    limitEvents: rows(limits?.results), activity: activity?.results ?? [],
  });
}

export async function adminUsers(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const start30 = Date.now() - 30 * 86_400_000;
  const where = q ? `WHERE u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR CAST(u.telegram_user_id AS TEXT) LIKE ?` : "";
  const like = `%${q}%`;
  const bindValues: unknown[] = [];
  if (q) bindValues.push(like, like, like, like);
  bindValues.push(start30, startOfIndiaDay(Date.now()), start30, Date.now(), limit);
  const result = await env.DB.prepare(
    `SELECT u.telegram_user_id,u.username,u.first_name,u.last_name,u.first_seen_at,u.target_exam,
      (SELECT COUNT(*) FROM questions q WHERE q.telegram_user_id=u.telegram_user_id) AS question_count,
      (SELECT COUNT(*) FROM questions q WHERE q.telegram_user_id=u.telegram_user_id AND q.received_at>=?) AS question_count_30d,
      (SELECT COUNT(*) FROM questions q WHERE q.telegram_user_id=u.telegram_user_id AND q.received_at>=?) AS question_count_today,
      (SELECT MAX(q.received_at) FROM questions q WHERE q.telegram_user_id=u.telegram_user_id) AS last_question_at,
      (SELECT COALESCE(SUM(a.estimated_cost_microusd),0) FROM ai_usage_attempts a WHERE a.telegram_user_id=u.telegram_user_id AND a.recorded_at>=?) AS spend_microusd,
      COALESCE((SELECT suspended FROM admin_user_controls c WHERE c.telegram_user_id=u.telegram_user_id),0) AS suspended,
      COALESCE((SELECT unlimited_ai FROM ai_access_overrides o WHERE o.telegram_user_id=u.telegram_user_id AND (o.expires_at IS NULL OR o.expires_at>?) ),0) AS unlimited
     FROM users u ${where}
     ORDER BY COALESCE(last_question_at,u.first_seen_at) DESC LIMIT ?`
  ).bind(...bindValues).all<Record<string, unknown>>();
  const ownerTelegramUserId = Number(env.BOT_OWNER_TELEGRAM_USER_ID ?? 0) || null;
  const adminTelegramUserIds = Array.from(parseIdSet(env.ADMIN_TELEGRAM_USER_IDS));
  const staticUnlimitedIds = parseIdSet(env.UNLIMITED_AI_TELEGRAM_USER_IDS);
  const users = (result.results ?? []).map((user) => {
    const id = Number(user.telegram_user_id);
    const isOwner = ownerTelegramUserId === id;
    const isAdmin = adminTelegramUserIds.includes(id);
    const staticUnlimited = staticUnlimitedIds.has(id);
    return {
      ...user,
      is_owner: isOwner ? 1 : 0,
      is_admin: isAdmin ? 1 : 0,
      unlimited: (isOwner || isAdmin || staticUnlimited || Number(user.unlimited) === 1) ? 1 : 0,
    };
  });
  return json({ ok: true, users, ownerTelegramUserId, adminTelegramUserIds });
}

export async function adminUserQuestions(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const url = new URL(request.url);
  const userId = Number(url.searchParams.get("user_id"));
  if (!Number.isSafeInteger(userId) || userId === 0) return json({ ok: false, error: "invalid_user_id" }, 400);
  const result = await env.DB.prepare(`SELECT q.*,COALESCE(u.total_tokens,0) AS total_tokens,COALESCE(u.spend_microusd,0) AS spend_microusd,
      COALESCE(u.thoughts_tokens,0) AS thoughts_tokens,COALESCE(u.prompt_tokens,0) AS prompt_tokens,COALESCE(u.candidates_tokens,0) AS candidates_tokens
      FROM questions q LEFT JOIN (SELECT update_id,SUM(total_tokens) total_tokens,SUM(estimated_cost_microusd) spend_microusd,SUM(thoughts_tokens) thoughts_tokens,SUM(prompt_tokens) prompt_tokens,SUM(candidates_tokens) candidates_tokens FROM ai_usage_attempts GROUP BY update_id) u ON u.update_id=q.update_id
      WHERE q.telegram_user_id=? ORDER BY q.received_at DESC LIMIT 100`).bind(userId).all<Record<string, unknown>>();
  return json({ ok: true, questions: result.results ?? [] });
}

export async function adminUserDetail(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const id = Number(new URL(request.url).searchParams.get("user_id"));
  if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false, error: "invalid_user_id" }, 400);
  const [user, topics, signals, questions, cost] = await Promise.all([
    env.DB.prepare(`SELECT u.*,COALESCE((SELECT suspended FROM admin_user_controls c WHERE c.telegram_user_id=u.telegram_user_id),0) suspended FROM users u WHERE u.telegram_user_id=?`).bind(id).first<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COALESCE(topic,'unknown') label,COUNT(*) count FROM questions WHERE telegram_user_id=? GROUP BY topic ORDER BY count DESC LIMIT 10`).bind(id).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT json_extract(metadata_json,'$.topic') label,SUM(CASE WHEN event_type='learning_signal_detected' THEN 1 ELSE 0 END) count FROM events WHERE telegram_user_id=? AND event_type='learning_signal_detected' GROUP BY label ORDER BY count DESC LIMIT 10`).bind(id).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT update_id,question_text,received_at,status,subject,topic,question_mode,thinking_level,latency_ms,attempts FROM questions WHERE telegram_user_id=? ORDER BY received_at DESC LIMIT 20`).bind(id).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COALESCE(SUM(estimated_cost_microusd),0) spend_microusd,COALESCE(SUM(total_tokens),0) total_tokens FROM ai_usage_attempts WHERE telegram_user_id=?`).bind(id).first<Record<string, number>>(),
  ]);
  if (!user) return json({ ok: false, error: "user_not_found" }, 404);
  const unlimited = await hasUnlimitedAiAccess(env, id);
  return json({ ok: true, user, unlimited, estimatedSpendUsd: n(cost?.spend_microusd) / 1_000_000, totalTokens: n(cost?.total_tokens), topics: rows(topics?.results), learningSignals: rows(signals?.results), questions: questions?.results ?? [] });
}

export async function adminAiUsage(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number.parseInt(url.searchParams.get("days") ?? "7", 10) || 7));
  const since = Date.now() - days * 86_400_000;
  const [daily, models, expensive, summary, grounding] = await Promise.all([
    env.DB.prepare(`SELECT substr(datetime(recorded_at/1000,'unixepoch','+5 hours','+30 minutes'),1,10) day,COUNT(*) attempts,COALESCE(SUM(total_tokens),0) total_tokens,COALESCE(SUM(estimated_cost_microusd),0) spend_microusd FROM ai_usage_attempts WHERE recorded_at>=? GROUP BY day ORDER BY day ASC`).bind(since).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT model,location,thinking_level,COUNT(*) attempts,COALESCE(SUM(total_tokens),0) total_tokens,COALESCE(SUM(estimated_cost_microusd),0) spend_microusd FROM ai_usage_attempts WHERE recorded_at>=? GROUP BY model,location,thinking_level ORDER BY spend_microusd DESC`).bind(since).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT q.update_id,q.telegram_user_id,q.username,q.question_text,q.received_at,COALESCE(SUM(a.estimated_cost_microusd),0) spend_microusd,COALESCE(SUM(a.total_tokens),0) total_tokens FROM questions q JOIN ai_usage_attempts a ON a.update_id=q.update_id WHERE q.received_at>=? GROUP BY q.update_id ORDER BY spend_microusd DESC LIMIT 25`).bind(since).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COUNT(*) attempts,COALESCE(SUM(prompt_tokens),0) prompt_tokens,COALESCE(SUM(candidates_tokens),0) candidates_tokens,COALESCE(SUM(thoughts_tokens),0) thoughts_tokens,COALESCE(SUM(tool_use_prompt_tokens),0) tool_use_prompt_tokens,COALESCE(SUM(cached_content_tokens),0) cached_content_tokens,COALESCE(SUM(total_tokens),0) total_tokens,COALESCE(SUM(estimated_cost_microusd),0) spend_microusd FROM ai_usage_attempts WHERE recorded_at>=?`).bind(since).first<Record<string, number>>(),
    env.DB.prepare(`SELECT CASE WHEN grounded=1 THEN 'Grounded' ELSE 'Standard' END label,COUNT(*) attempts,COALESCE(SUM(total_tokens),0) total_tokens,COALESCE(SUM(estimated_cost_microusd),0) spend_microusd FROM ai_usage_attempts WHERE recorded_at>=? GROUP BY grounded ORDER BY attempts DESC`).bind(since).all<Record<string, unknown>>(),
  ]);
  const modelsList=models?.results ?? [];
  const thinkingSpend={LOW:0,MEDIUM:0,HIGH:0};
  for(const r of modelsList){const k=String(r.thinking_level??"");if(k in thinkingSpend) thinkingSpend[k as keyof typeof thinkingSpend]+=n(r.spend_microusd)/1_000_000;}
  const sum=summary ?? {};
  return json({ ok: true, days, pricing: pricingInfo(env), summary:{attempts:n(sum.attempts),promptTokens:n(sum.prompt_tokens),candidatesTokens:n(sum.candidates_tokens),thoughtsTokens:n(sum.thoughts_tokens),toolUsePromptTokens:n(sum.tool_use_prompt_tokens),cachedContentTokens:n(sum.cached_content_tokens),totalTokens:n(sum.total_tokens),spendUsd:n(sum.spend_microusd)/1_000_000,averageCostUsd:n(sum.attempts)?n(sum.spend_microusd)/1_000_000/n(sum.attempts):0}, thinkingSpend, grounding:(grounding?.results??[]).map(r=>({...r,attempts:n(r.attempts),totalTokens:n(r.total_tokens),spendUsd:n(r.spend_microusd)/1_000_000})), daily: (daily?.results ?? []).map((r)=>({day:String(r.day),attempts:n(r.attempts),totalTokens:n(r.total_tokens),spendUsd:n(r.spend_microusd)/1_000_000})), models: modelsList.map((r)=>({...r,attempts:n(r.attempts),totalTokens:n(r.total_tokens),spendUsd:n(r.spend_microusd)/1_000_000})), expensive:(expensive?.results ?? []).map((r)=>({...r,spendUsd:n(r.spend_microusd)/1_000_000,totalTokens:n(r.total_tokens)})) });
}

export async function adminLearning(env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const since = Date.now() - 30 * 86_400_000;
  const [subjects, topics, modes, confusion] = await Promise.all([
    env.DB.prepare(`SELECT COALESCE(subject,'unknown') label,COUNT(*) count FROM questions WHERE received_at>=? GROUP BY subject ORDER BY count DESC LIMIT 12`).bind(since).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COALESCE(topic,'unknown') label,COUNT(*) count FROM questions WHERE received_at>=? GROUP BY topic ORDER BY count DESC LIMIT 15`).bind(since).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COALESCE(question_mode,'unknown') label,COUNT(*) count FROM questions WHERE received_at>=? GROUP BY question_mode ORDER BY count DESC`).bind(since).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT json_extract(metadata_json,'$.topic') label,COUNT(*) count FROM events WHERE event_at>=? AND event_type='learning_signal_detected' GROUP BY label ORDER BY count DESC LIMIT 15`).bind(since).all<Record<string, unknown>>(),
  ]);
  return json({ ok:true, subjects:rows(subjects?.results),topics:rows(topics?.results),modes:rows(modes?.results),confusionTopics:rows(confusion?.results) });
}

export async function adminActivity(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const result = await env.DB.prepare(`SELECT q.update_id,q.telegram_user_id,q.username,q.display_name,q.question_text,q.received_at,q.status,q.subject,q.topic,q.question_mode,q.thinking_level,q.attempts,q.latency_ms,
      COALESCE(a.total_tokens,0) total_tokens,COALESCE(a.spend_microusd,0) spend_microusd FROM questions q LEFT JOIN (SELECT update_id,SUM(total_tokens) total_tokens,SUM(estimated_cost_microusd) spend_microusd FROM ai_usage_attempts GROUP BY update_id) a ON a.update_id=q.update_id ORDER BY q.received_at DESC LIMIT ?`).bind(limit).all<Record<string,unknown>>();
  return json({ok:true,activity:result.results??[]});
}

export async function adminAccess(env: Env): Promise<Response> {
  if (!env.DB) return json({ ok:false,error:"analytics_not_configured"},503);
  await ensureAnalyticsSchema(env);
  const overrides = await env.DB.prepare(`SELECT o.telegram_user_id,u.username,u.first_name,u.last_name,o.unlimited_ai,o.granted_at,o.expires_at,o.granted_by_telegram_user_id,COALESCE(c.suspended,0) suspended FROM ai_access_overrides o LEFT JOIN users u ON u.telegram_user_id=o.telegram_user_id LEFT JOIN admin_user_controls c ON c.telegram_user_id=o.telegram_user_id ORDER BY o.granted_at DESC`).all<Record<string,unknown>>();
  return json({ok:true,ownerTelegramUserId:Number(env.BOT_OWNER_TELEGRAM_USER_ID??0)||null,admins:Array.from(parseIdSet(env.ADMIN_TELEGRAM_USER_IDS)),staticUnlimited:Array.from(parseIdSet(env.UNLIMITED_AI_TELEGRAM_USER_IDS)),overrides:overrides.results??[]});
}

export async function adminAudit(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ok:false,error:"analytics_not_configured"},503);
  await ensureAnalyticsSchema(env);
  const limit=Math.min(200,Math.max(1,Number.parseInt(new URL(request.url).searchParams.get("limit")??"100",10)||100));
  const result=await env.DB.prepare(`SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?`).bind(limit).all<Record<string,unknown>>();
  return json({ok:true,audit:result.results??[]});
}

export async function adminSystem(env: Env): Promise<Response> {
  if (!env.DB) return json({ok:false,error:"analytics_not_configured"},503);
  await ensureAnalyticsSchema(env);
  const now=Date.now();
  const last24=now-86_400_000;
  const [recent, dbWrite, latestEvent] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) count,COALESCE(AVG(latency_ms),0) avg_latency FROM questions WHERE received_at>=?`).bind(last24).first<Record<string,number>>(),
    env.DB.prepare(`SELECT COUNT(*) count FROM events WHERE event_at>=?`).bind(last24).first<Record<string,number>>(),
    env.DB.prepare(`SELECT event_type,created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 1`).first<Record<string,unknown>>(),
  ]);
  const config=getConfig(env);
  const activeTelegramBot=await getActiveTelegramBot(env);
  const telegramConfigured=Boolean(activeTelegramBot || (!(await hasTelegramBotRecords(env)) && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET));
  return json({ok:true,generatedAt:now,version:config.version,environment:config.environment,model:config.model,location:config.location,thinkingPolicy:`ADAPTIVE (max ${config.maxThinkingLevel})`,telegramConfigured,vertexAiConfigured:Boolean(env.GCP_PROJECT_ID&&env.GCP_CLIENT_EMAIL&&env.GCP_PRIVATE_KEY),databaseConfigured:Boolean(env.DB),queueConfigured:Boolean(env.QUESTION_QUEUE),durableObjectConfigured:Boolean(env.JOB_DEDUPE),adminDashboardConfigured:Boolean(env.ADMIN_DASHBOARD_PASSWORD&&env.ADMIN_SESSION_SECRET),dailyQuestionLimit:config.dailyQuestionLimit,burstLimit:config.burstQuestionLimit,burstWindowSeconds:config.burstWindowSeconds,rawRetentionDays:Number(env.ANALYTICS_RAW_RETENTION_DAYS??90)||90,recentQuestions24h:n(recent?.count),avgLatencyMs24h:Number(recent?.avg_latency??0),analyticsEvents24h:n(dbWrite?.count),lastAdminAction:latestEvent??null,pricing:pricingInfo(env)});
}

export async function adminExport(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ok:false,error:"analytics_not_configured"},503);
  await ensureAnalyticsSchema(env);
  const days=Math.min(90,Math.max(1,Number.parseInt(new URL(request.url).searchParams.get("days")??"30",10)||30));
  const since=Date.now()-days*86_400_000;
  const [overview, usage, daily, subjects, topics, failures] = await Promise.all([
    adminOverview(env),
    env.DB.prepare(`SELECT COUNT(*) attempts,COALESCE(SUM(total_tokens),0) total_tokens,COALESCE(SUM(estimated_cost_microusd),0) spend_microusd FROM ai_usage_attempts WHERE recorded_at>=?`).bind(since).first<Record<string,number>>(),
    env.DB.prepare(`SELECT substr(datetime(recorded_at/1000,'unixepoch','+5 hours','+30 minutes'),1,10) day,COALESCE(SUM(total_tokens),0) total_tokens,COALESCE(SUM(estimated_cost_microusd),0) spend_microusd FROM ai_usage_attempts WHERE recorded_at>=? GROUP BY day ORDER BY day ASC`).bind(since).all<Record<string,unknown>>(),
    env.DB.prepare(`SELECT COALESCE(subject,'unknown') label,COUNT(*) count FROM questions WHERE received_at>=? GROUP BY subject ORDER BY count DESC`).bind(since).all<Record<string,unknown>>(),
    env.DB.prepare(`SELECT COALESCE(topic,'unknown') label,COUNT(*) count FROM questions WHERE received_at>=? GROUP BY topic ORDER BY count DESC LIMIT 100`).bind(since).all<Record<string,unknown>>(),
    env.DB.prepare(`SELECT status,COUNT(*) count FROM questions WHERE received_at>=? GROUP BY status`).bind(since).all<Record<string,unknown>>(),
  ]);
  const overviewJson=await overview.json();
  return json({ok:true,generatedAt:Date.now(),days,overview:overviewJson,usage:{attempts:n(usage?.attempts),totalTokens:n(usage?.total_tokens),spendUsd:n(usage?.spend_microusd)/1_000_000},daily:(daily?.results??[]).map(r=>({day:String(r.day),totalTokens:n(r.total_tokens),spendUsd:n(r.spend_microusd)/1_000_000})),subjects:rows(subjects?.results),topics:rows(topics?.results),statuses:rows(failures?.results)});
}

export async function adminTelegram(env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "analytics_not_configured" }, 503);
  await ensureAnalyticsSchema(env);

  const encryption = await getTelegramEncryptionStatus(env);
  const active = await getActiveTelegramBot(env);
  const history = await listTelegramBots(env);

  if (active) {
    let webhook: { url?: string; pending_update_count?: number } | null = null;
    let verified = true;
    try {
      webhook = await telegramAdminApi<{ url?: string; pending_update_count?: number }>(active.token, "getWebhookInfo", {});
      await telegramAdminApi(active.token, "getMe", {});
    } catch {
      verified = false;
    }

    return json({
      ok: true,
      connected: true,
      source: "dashboard",
      verified,
      bot: {
        connectionId: active.connectionId,
        botId: active.botId,
        username: active.username,
        firstName: active.firstName,
        connectedAt: active.connectedAt,
        lastVerifiedAt: active.lastVerifiedAt,
        status: active.status,
      },
      webhook,
      encryption,
      history: history.map((item) => ({
        connectionId: item.connectionId,
        botId: item.botId,
        username: item.username,
        firstName: item.firstName,
        status: item.status,
        connectedAt: item.connectedAt,
        lastVerifiedAt: item.lastVerifiedAt,
        disconnectedAt: item.disconnectedAt,
      })),
    });
  }

  if (env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_WEBHOOK_SECRET?.trim()) {
    try {
      const legacy = await telegramAdminApi<{ id: number; username?: string; first_name?: string }>(
        env.TELEGRAM_BOT_TOKEN.trim(),
        "getMe",
        {},
      );
      const webhook = await telegramAdminApi<{ url?: string; pending_update_count?: number }>(
        env.TELEGRAM_BOT_TOKEN.trim(),
        "getWebhookInfo",
        {},
      );
      return json({
        ok: true,
        connected: true,
        source: "cloudflare_legacy",
        verified: true,
        legacyNeedsImport: true,
        bot: { connectionId: "legacy-env", botId: legacy.id, username: legacy.username ?? null, firstName: legacy.first_name ?? null },
        webhook,
        encryption,
        history: history.map((item) => ({
          connectionId: item.connectionId,
          botId: item.botId,
          username: item.username,
          firstName: item.firstName,
          status: item.status,
          connectedAt: item.connectedAt,
          lastVerifiedAt: item.lastVerifiedAt,
          disconnectedAt: item.disconnectedAt,
        })),
      });
    } catch {
      // Fall through to the disconnected state so the dashboard can recover with a new token.
    }
  }

  return json({ ok: true, connected: false, encryption, history: history.map((item) => ({
    connectionId: item.connectionId,
    botId: item.botId,
    username: item.username,
    firstName: item.firstName,
    status: item.status,
    connectedAt: item.connectedAt,
    lastVerifiedAt: item.lastVerifiedAt,
    disconnectedAt: item.disconnectedAt,
  })) });
}

export async function adminAction(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return json({ok:false,error:"analytics_not_configured"},503);
  await ensureAnalyticsSchema(env);
  let body: Record<string,unknown>;
  try { body=await request.json() as Record<string,unknown>; } catch { return json({ok:false,error:"invalid_json"},400); }
  const action=String(body.action??"").trim();
  const userId=Number(body.telegramUserId);
  if (action !== "connect_telegram" && (!Number.isSafeInteger(userId) || userId<=0)) {
    return json({ok:false,error:"invalid_user_id"},400);
  }
  const actor=(env.ADMIN_DASHBOARD_USER?.trim() || "admin").slice(0,120);
  try {
    if (action === "connect_telegram") {
      const requestedToken = typeof body.botToken === "string" ? body.botToken.trim() : "";
      const result = await connectTelegramBot(env, new URL(request.url).origin, requestedToken || undefined);
      await recordAdminAudit(env,actor,"connect_telegram",null,{
        botUsername:result.botUsername,
        botId:result.botId,
        switched:result.switched,
        previousBotUsername:result.previousBotUsername,
      });
      return json({
        ok:true,
        action,
        botUsername:result.botUsername,
        botId:result.botId,
        switched:result.switched,
        previousBotUsername:result.previousBotUsername,
      });
    }
    if (action === "disconnect_telegram") {
      const active = await getActiveTelegramBot(env);
      if (!active) return json({ok:true,action,disconnected:false});
      await telegramAdminApi(active.token, "deleteWebhook", { drop_pending_updates: true });
      await markTelegramBotDisconnected(env, active.connectionId, "admin_disconnect");
      await recordAdminAudit(env,actor,"disconnect_telegram",null,{botUsername:active.username,botId:active.botId});
      return json({ok:true,action,disconnected:true});
    }
    if (action === "test_telegram") {
      const active = await getActiveTelegramBot(env);
      if (!active) {
        if (await hasTelegramBotRecords(env)) return json({ok:false,error:"telegram_not_connected"},409);
        if (!env.TELEGRAM_BOT_TOKEN?.trim()) return json({ok:false,error:"telegram_not_connected"},409);
        const bot = await telegramAdminApi<{id:number;username?:string;first_name?:string}>(env.TELEGRAM_BOT_TOKEN.trim(),"getMe",{});
        const webhook = await telegramAdminApi<{url?:string;pending_update_count?:number}>(env.TELEGRAM_BOT_TOKEN.trim(),"getWebhookInfo",{});
        return json({ok:true,legacy:true,botUsername:bot.username ? "@" + bot.username : bot.first_name ?? "Telegram bot",botId:bot.id,webhook});
      }
      const bot = await telegramAdminApi<{id:number;username?:string;first_name?:string}>(active.token,"getMe",{});
      const webhook = await telegramAdminApi<{url?:string;pending_update_count?:number}>(active.token,"getWebhookInfo",{});
      await markTelegramBotVerified(env, active.connectionId);
      return json({ok:true,legacy:false,botUsername:bot.username ? "@" + bot.username : bot.first_name ?? "Telegram bot",botId:bot.id,webhook});
    }
    if (action === "grant_unlimited") {
      await grantUnlimitedAiAccess(env,userId,0,null);
      if (!(await hasUnlimitedAiAccess(env,userId))) return json({ok:false,error:"unlimited_access_verification_failed"},500);
      await recordAdminAudit(env,actor,"grant_unlimited",userId);
    } else if (action === "revoke_unlimited") {
      if (isProtectedAdminTarget(env,userId)) return json({ok:false,error:"protected_admin"},403);
      await revokeUnlimitedAiAccess(env,userId);
      if (await hasUnlimitedAiAccess(env,userId)) return json({ok:false,error:"unlimited_access_revoke_verification_failed"},500);
      await recordAdminAudit(env,actor,"revoke_unlimited",userId);
    } else if (action === "suspend" || action === "unsuspend") {
      if (action === "suspend" && isProtectedAdminTarget(env,userId)) return json({ok:false,error:"protected_admin"},403);
      await setUserSuspended(env,userId,action==="suspend",String(body.note??"").slice(0,500),actor); await recordAdminAudit(env,actor,action,userId,{note:String(body.note??"").slice(0,500)});
    } else if (action === "reset_profile") {
      const user=await env.DB.prepare(`SELECT chat_id FROM users WHERE telegram_user_id=?`).bind(userId).first<{chat_id:number}>();
      if (!user) return json({ok:false,error:"user_not_found"},404);
      const id=env.JOB_DEDUPE.idFromName(String(user.chat_id));
      await env.JOB_DEDUPE.get(id).fetch("https://job-store/internal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"reset_profile"})});
      await recordAdminAudit(env,actor,"reset_profile",userId);
    } else { return json({ok:false,error:"unknown_action"},400); }
    return json({ok:true,action});
  } catch (error) {
    return json({ok:false,error:error instanceof Error?error.message:String(error)},500);
  }
}

async function connectTelegramBot(
  env: Env,
  origin: string,
  requestedToken?: string,
): Promise<{ botUsername: string; botId: number; switched: boolean; previousBotUsername: string | null }> {
  const candidateToken = requestedToken?.trim() || env.TELEGRAM_BOT_TOKEN?.trim();
  if (!candidateToken) throw new Error("Enter a Telegram BotFather token.");

  const candidate = await telegramAdminApi<{ id: number; username?: string; first_name?: string }>(
    candidateToken,
    "getMe",
    {},
  );

  let active = await getActiveTelegramBot(env);
  let previousBotUsername: string | null = active?.username ?? null;

  if (!active && env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_WEBHOOK_SECRET?.trim() && candidateToken !== env.TELEGRAM_BOT_TOKEN.trim()) {
    try {
      const legacy = await telegramAdminApi<{ id: number; username?: string; first_name?: string }>(
        env.TELEGRAM_BOT_TOKEN.trim(),
        "getMe",
        {},
      );
      active = {
        connectionId: "legacy-env",
        botId: legacy.id,
        username: legacy.username ?? null,
        firstName: legacy.first_name ?? null,
        token: env.TELEGRAM_BOT_TOKEN.trim(),
        webhookSecret: env.TELEGRAM_WEBHOOK_SECRET.trim(),
        status: "active",
        connectedAt: 0,
        lastVerifiedAt: null,
        disconnectedAt: null,
      };
      previousBotUsername = active.username;
    } catch {
      active = null;
    }
  }

  if (active && active.botId === candidate.id && active.token === candidateToken) {
    await telegramAdminApi(candidateToken, "setWebhook", {
      url: origin + "/telegram/webhook",
      secret_token: active.webhookSecret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
      max_connections: 100,
    });
    await telegramAdminApi(candidateToken, "setMyCommands", { commands: buildTelegramCommands() });
    await telegramAdminApi(candidateToken, "getWebhookInfo", {});
    await markTelegramBotVerified(env, active.connectionId);
    return {
      botUsername: candidate.username ? "@" + candidate.username : candidate.first_name ?? "Telegram bot",
      botId: candidate.id,
      switched: false,
      previousBotUsername: null,
    };
  }

  const existing = await getTelegramBotByBotId(env, candidate.id);
  const connectionId = existing?.connectionId
    ?? (!active && candidateToken === env.TELEGRAM_BOT_TOKEN?.trim() ? "legacy-env" : crypto.randomUUID());
  const webhookSecret = randomTelegramWebhookSecret();
  const webhookUrl = origin + "/telegram/webhook";
  const willSwitch = Boolean(active && active.botId !== candidate.id);

  await saveTelegramBot(env, {
    connectionId,
    botId: candidate.id,
    username: candidate.username ?? null,
    firstName: candidate.first_name ?? null,
    token: candidateToken,
    webhookSecret,
    status: "disconnected",
    lastVerifiedAt: Date.now(),
    disconnectedAt: null,
  });

  let candidateWebhookRegistered = false;
  try {
    await telegramAdminApiWithRetry(candidateToken, "setWebhook", {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message"],
      drop_pending_updates: willSwitch,
      max_connections: 100,
    }, {
      label: "webhook registration",
      retryable: (error) => {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        return message.includes("failed to resolve host") ||
          message.includes("temporary failure in name resolution") ||
          message.includes("timed out") ||
          message.includes("timeout");
      },
    });
    candidateWebhookRegistered = true;

    await telegramAdminApi(candidateToken, "setMyCommands", { commands: buildTelegramCommands() });
    const webhook = await telegramAdminApi<{ url?: string }>(candidateToken, "getWebhookInfo", {});
    if (webhook.url && webhook.url !== webhookUrl) {
      throw new Error("Telegram reported a different webhook URL.");
    }
  } catch (error) {
    if (candidateWebhookRegistered) {
      await telegramAdminApi(candidateToken, "deleteWebhook", { drop_pending_updates: true }).catch(() => undefined);
    }
    throw new Error(
      "New Telegram bot setup failed before switching: " +
      (error instanceof Error ? error.message : String(error)),
    );
  }

  if (active && active.botId !== candidate.id) {
    try {
      await telegramAdminApi(active.token, "deleteWebhook", { drop_pending_updates: true });
    } catch (error) {
      await telegramAdminApi(candidateToken, "deleteWebhook", { drop_pending_updates: true }).catch(() => undefined);
      throw new Error(
        "Could not safely disconnect the previous Telegram bot: " +
        (error instanceof Error ? error.message : String(error)),
      );
    }

    if (active.connectionId === "legacy-env") {
      await saveTelegramBot(env, {
        connectionId: active.connectionId,
        botId: active.botId,
        username: active.username,
        firstName: active.firstName,
        token: active.token,
        webhookSecret: active.webhookSecret,
        status: "disconnected",
        connectedAt: active.connectedAt || Date.now(),
        lastVerifiedAt: active.lastVerifiedAt,
        disconnectedAt: Date.now(),
      });
    }
  }

  try {
    await activateTelegramBot(env, connectionId, active?.connectionId);
  } catch (error) {
    await telegramAdminApi(candidateToken, "deleteWebhook", { drop_pending_updates: true }).catch(() => undefined);

    if (active) {
      try {
        await activateTelegramBot(env, active.connectionId, connectionId);
      } catch {
        // Best-effort database rollback; webhook restoration below remains independently guarded.
      }
      try {
        await telegramAdminApi(active.token, "setWebhook", {
          url: webhookUrl,
          secret_token: active.webhookSecret,
          allowed_updates: ["message"],
          drop_pending_updates: false,
          max_connections: 100,
        });
        await telegramAdminApi(active.token, "setMyCommands", { commands: buildTelegramCommands() });
      } catch {
        // The original webhook restoration is best-effort; surface the activation error below.
      }
    }

    throw new Error(
      "Telegram connection could not be activated safely: " +
      (error instanceof Error ? error.message : String(error)),
    );
  }

  return {
    botUsername: candidate.username ? "@" + candidate.username : candidate.first_name ?? "Telegram bot",
    botId: candidate.id,
    switched: willSwitch,
    previousBotUsername: previousBotUsername,
  };
}

function buildTelegramCommands() {
  return [
    { command: "start", description: "Start Parmar AI" },
    { command: "exam", description: "Set your SSC target exam" },
    { command: "profile", description: "View your SSC study profile" },
    { command: "reset", description: "Reset your study profile" },
    { command: "delete_data", description: "Delete your stored study data" },
    { command: "help", description: "Show help" },
    { command: "id", description: "Show your Telegram user ID" },
  ];
}

function randomTelegramWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return btoa(output).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function telegramAdminApiWithRetry<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  options: { label: string; retryable: (error: unknown) => boolean },
): Promise<T> {
  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await telegramAdminApi<T>(token, method, payload);
    } catch (error) {
      lastError = error;
      if (!options.retryable(error) || attempt >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
    }
  }
  const base = lastError instanceof Error ? lastError.message : String(lastError);
  if (base.toLowerCase().includes("failed to resolve host") || base.toLowerCase().includes("temporary failure in name resolution")) {
    const webhookUrl = typeof payload.url === "string" ? payload.url : null;
    throw new Error(
      options.label + " failed after " + maxAttempts + " attempts because Telegram could not resolve the webhook hostname" +
      (webhookUrl ? " (" + new URL(webhookUrl).hostname + ")." : ".") +
      " Check that the Worker hostname has public DNS; otherwise try again in a moment.",
    );
  }
  throw lastError instanceof Error ? lastError : new Error(base);
}

async function telegramAdminApi<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data: { ok: boolean; result?: T; description?: string };
  try {
    data = JSON.parse(raw) as { ok: boolean; result?: T; description?: string };
  } catch {
    throw new Error(`Telegram returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!response.ok || !data.ok || data.result === undefined) {
    throw new Error(data.description ?? `Telegram request failed (HTTP ${response.status}).`);
  }
  return data.result;
}

function isProtectedAdminTarget(env: Env, telegramUserId: number): boolean {
  if (telegramUserId === Number(env.BOT_OWNER_TELEGRAM_USER_ID ?? "")) return true;
  return parseIdSet(env.ADMIN_TELEGRAM_USER_IDS).has(telegramUserId);
}

function pricingInfo(env: Env) {
  return { currency:"USD", basis:"Gemini 3.8 Flash global standard through 2026-12-31; update environment variables when pricing changes.", inputUsdPerMillion:nonNegativeFloat(env.AI_INPUT_USD_PER_MILLION,0.75), cachedInputUsdPerMillion:nonNegativeFloat(env.AI_CACHED_INPUT_USD_PER_MILLION,0.075), outputUsdPerMillion:nonNegativeFloat(env.AI_OUTPUT_USD_PER_MILLION,3.75), estimateOnly:true };
}

function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function n(v: unknown): number { const value=Number(v??0); return Number.isFinite(value)?value:0; }
function nonNegativeFloat(value: string|undefined, fallback=0): number { const parsed=Number.parseFloat(value??""); return Number.isFinite(parsed)&&parsed>=0?parsed:fallback; }
function rows(value: unknown[]|undefined): Array<{label:string;count:number}> { return (value??[]).map((r)=>({label:String((r as Record<string,unknown>).label??"unknown"),count:n((r as Record<string,unknown>).count)})); }
function parseIdSet(value:string|undefined): Set<number> { const s=new Set<number>(); for(const part of (value??"").split(",")){const id=Number(part.trim());if(Number.isSafeInteger(id)&&id>0)s.add(id);} return s; }
function startOfIndiaDay(timestamp:number):number { const shifted=new Date(timestamp+330*60_000); const start=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate()); return start-330*60_000; }

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parmar AI Admin Control Center</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;background:#eef2f7}*{box-sizing:border-box}body{margin:0}.top{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid #e5e7eb}.topin{max-width:1500px;margin:auto;padding:13px 20px;display:flex;gap:15px;align-items:center;justify-content:space-between}.brand{font-weight:900;font-size:19px}.small{font-size:12px;color:#6b7280}.btn{border:0;border-radius:10px;padding:9px 12px;font:inherit;font-weight:750;cursor:pointer;background:#111827;color:#fff}.btn.alt{background:#eef2f7;color:#111827}.nav{max-width:1500px;margin:auto;display:flex;overflow:auto;padding:0 20px}.tab{border:0;background:transparent;padding:12px 13px;cursor:pointer;font-weight:700;color:#6b7280}.tab.active{color:#111827;border-bottom:3px solid #111827}.wrap{max-width:1500px;margin:auto;padding:20px}.page{display:none}.page.active{display:block}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}.card{background:#fff;border:1px solid #e3e7ee;border-radius:16px;box-shadow:0 8px 28px rgba(15,23,42,.05)}.metric{padding:16px}.metric .k{font-size:12px;color:#6b7280}.metric .v{font-size:26px;font-weight:900;margin-top:4px}.metric .sub{font-size:12px;color:#6b7280;margin-top:3px}.section{padding:17px;margin-top:14px}.section h2{font-size:15px;margin:0 0 12px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.bar{display:grid;grid-template-columns:150px 1fr 70px;gap:9px;align-items:center;margin:8px 0;font-size:13px}.track{height:8px;background:#edf0f4;border-radius:50px;overflow:hidden}.fill{height:100%;background:#111827}.tablewrap{overflow:auto}.table{border-collapse:collapse;width:100%;font-size:13px}.table th,.table td{padding:9px;border-bottom:1px solid #edf0f4;text-align:left;vertical-align:top}.table th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#f1f5f9;font-size:11px;font-weight:750}.good{color:#047857}.warn{color:#b45309}.bad{color:#b91c1c}.alert{padding:12px;border-radius:12px;margin:7px 0;border:1px solid #e5e7eb;background:#f8fafc}.alert.warning{background:#fff7ed;border-color:#fed7aa}.alert.critical{background:#fef2f2;border-color:#fecaca}.toolbar{display:flex;gap:9px;align-items:center;margin-bottom:11px}.toolbar input,.toolbar select{padding:9px 11px;border:1px solid #d1d5db;border-radius:10px;background:#fff;font:inherit}.toolbar input{flex:1}.muted{color:#6b7280}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}.row-actions{display:flex;gap:6px;flex-wrap:wrap}.row-actions .btn{font-size:11px;padding:6px 8px}.legend{display:flex;gap:15px;flex-wrap:wrap;font-size:12px;color:#6b7280}.statusdot{display:inline-flex;align-items:center;gap:7px;font-weight:800}.dot{width:9px;height:9px;border-radius:50%;background:#10b981}.detail{display:none}.detail.open{display:block}.kv{display:grid;grid-template-columns:180px 1fr;gap:7px;font-size:13px}.notice{padding:12px 14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px}.footer{color:#6b7280;font-size:11px;padding:22px 0;text-align:center}@media(max-width:1100px){.cards{grid-template-columns:repeat(2,1fr)}.grid2,.grid3{grid-template-columns:1fr}}@media(max-width:680px){.cards{grid-template-columns:1fr}.wrap{padding:13px}.nav{padding:0 10px}.topin{padding:11px 13px}}
</style></head><body><header class="top"><div class="topin"><div><div class="brand">Parmar AI — Admin Control Center</div><div class="small" id="stamp">Loading live operations…</div></div><div style="display:flex;gap:7px"><button class="btn alt" onclick="refreshAll()">Refresh</button><button class="btn alt" onclick="openTelegramTab()">Telegram</button><button class="btn alt" onclick="logout()">Sign out</button></div></div><nav class="nav"><button class="tab active" data-page="overview">Overview</button><button class="tab" data-page="users">Students</button><button class="tab" data-page="ai">AI & Costs</button><button class="tab" data-page="learning">Learning</button><button class="tab" data-page="activity">Activity</button><button class="tab" data-page="system">System</button><button class="tab" data-page="access">Access</button><button class="tab" data-page="audit">Audit</button><button class="tab" data-page="reports">Reports</button><button class="tab" data-page="telegram">Telegram</button><button class="tab" data-page="settings">Settings</button></nav></header><main class="wrap">
<section id="page-overview" class="page active"><div id="alerts"></div><div id="overviewCards" class="cards"></div><div class="grid2"><div class="card section"><h2>AI economics — today</h2><div id="aiSummary"></div></div><div class="card section"><h2>System status</h2><div id="statusSummary"></div></div></div><div class="grid2"><div class="card section"><h2>Top subjects — 30 days</h2><div id="topSubjects"></div></div><div class="card section"><h2>Top topics — 30 days</h2><div id="topTopics"></div></div></div><div class="grid3"><div class="card section"><h2>Daily quota usage</h2><div id="quotaDistribution"></div><p class="muted">Accepted questions per student today. Unlimited users are included in the 20+ bucket when they pass it.</p></div><div class="card section"><h2>Most active students today</h2><div id="topUsersToday"></div></div><div class="card section"><h2>Retention snapshot</h2><div id="retentionView"></div><p class="muted">D+N means students who joined on the cohort day and were active again today at that interval.</p></div></div><div class="card section"><h2>Live / recent activity</h2><div class="tablewrap"><table class="table"><thead><tr><th>Time</th><th>Student</th><th>Question</th><th>Topic</th><th>Status</th><th>Tokens</th><th>Est. cost</th></tr></thead><tbody id="overviewActivity"></tbody></table></div></div></section>
<section id="page-users" class="page"><div class="card section"><div class="toolbar"><input id="userSearch" placeholder="Search name, @username or Telegram ID"><button class="btn" onclick="loadUsers()">Search</button></div><div class="tablewrap"><table class="table"><thead><tr><th>Student</th><th>Joined</th><th>Today</th><th>Total</th><th>30d</th><th>Est. spend</th><th>Access</th><th>Last active</th><th>Actions</th></tr></thead><tbody id="usersTable"></tbody></table></div></div><div id="userDetail" class="card section detail"></div></section>
<section id="page-ai" class="page"><div class="cards" id="aiCards"></div><div class="grid3"><div class="card section"><h2>Token composition</h2><div id="tokenBreakdown"></div></div><div class="card section"><h2>Spend by thinking level</h2><div id="thinkingSpend"></div></div><div class="card section"><h2>Grounding usage</h2><div id="groundingSpend"></div></div></div><div class="grid2"><div class="card section"><h2>7-day AI trend</h2><div id="aiTrend"></div></div><div class="card section"><h2>Cost by model / policy</h2><div id="modelSpend"></div></div></div><div class="card section"><h2>Most expensive AI requests — last 7 days</h2><div class="tablewrap"><table class="table"><thead><tr><th>Time</th><th>Student</th><th>Question</th><th>Tokens</th><th>Est. cost</th></tr></thead><tbody id="expensive"></tbody></table></div></div></section>
<section id="page-learning" class="page"><div class="grid3"><div class="card section"><h2>Subjects — 30d</h2><div id="learnSubjects"></div></div><div class="card section"><h2>Question modes — 30d</h2><div id="learnModes"></div></div><div class="card section"><h2>Repeated confusion — 30d</h2><div id="learnConfusion"></div></div></div><div class="card section"><h2>Most asked topics — 30d</h2><div id="learnTopics"></div></div></section>
<section id="page-activity" class="page"><div class="card section"><div class="toolbar"><select id="activityLimit"><option>25</option><option selected>50</option><option>100</option></select><button class="btn" onclick="loadActivity()">Refresh activity</button></div><div class="tablewrap"><table class="table"><thead><tr><th>Time</th><th>Student</th><th>Question</th><th>Topic</th><th>Mode</th><th>Think</th><th>Status</th><th>Attempts</th><th>Tokens</th><th>Cost</th></tr></thead><tbody id="activityTable"></tbody></table></div></div></section>
<section id="page-system" class="page"><div class="cards" id="systemCards"></div><div class="grid2"><div class="card section"><h2>Operational alerts</h2><div id="systemAlerts"></div></div><div class="card section"><h2>Queue / processing health</h2><div id="queueHealth"></div></div></div><div class="grid2"><div class="card section"><h2>Configuration visibility</h2><div id="configView"></div></div><div class="card section"><h2>Data & feedback</h2><div id="dataStatus"></div></div></div></section>
<section id="page-access" class="page"><div class="grid2"><div class="card section"><h2>Owner & admins</h2><div id="adminList"></div></div><div class="card section"><h2>Unlimited test users</h2><div id="overrideList"></div></div></div><div class="card section"><h2>Access management</h2><div class="notice">Unlimited access means <b>no daily question quota</b>. The 5-question / 10-second burst safeguard remains active.</div><div class="toolbar"><input id="grantId" placeholder="Telegram User ID"><button class="btn" onclick="grantUnlimitedId()">Grant unlimited</button></div></div></section>
<section id="page-audit" class="page"><div class="card section"><h2>Admin audit log</h2><div class="tablewrap"><table class="table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target Telegram ID</th><th>Details</th></tr></thead><tbody id="auditTable"></tbody></table></div></div></section>
<section id="page-reports" class="page"><div class="card section"><h2>Founder reports</h2><p class="muted">Export the current analytics snapshot as JSON. The repository also includes a Python/Matplotlib report generator for deeper historical charts.</p><div class="toolbar"><select id="reportDays"><option>7</option><option selected>30</option><option>90</option></select><button class="btn" onclick="downloadReport()">Export JSON report</button></div><div class="notice">Use the exported JSON with <span class="mono">reports/generate_report.py</span> to create a local PDF/PNG analytics pack.</div></div></section>
<section id="page-telegram" class="page"><div id="telegramAlerts"></div><div class="grid2"><div class="card section"><h2>Active Telegram bot</h2><div id="telegramStatus"><span class="muted">Loading…</span></div></div><div class="card section"><h2>Connect or switch bot</h2><p class="muted">Paste the BotFather token for the bot you want Parmar AI to use. The current bot stays online until the new bot passes verification.</p><div class="toolbar"><input id="telegramToken" type="password" autocomplete="off" placeholder="BotFather token"><button class="btn" onclick="connectTelegram()">Verify & connect</button></div><p class="small">The token is encrypted in D1 and is never shown back in the dashboard.</p></div></div><div class="card section"><h2>Connection history</h2><div id="telegramHistory"></div></div><div class="card section"><h2>What switching does</h2><div class="notice">The old bot webhook is removed, pending updates from the old bot are discarded, the new bot webhook and commands are registered, and unfinished old-bot question jobs are cancelled. Student profiles and access settings are preserved.</div></div></section><section id="page-settings" class="page"><div class="card section"><h2>Safe operating settings</h2><div id="settingsView"></div><p class="muted">Production infrastructure and credentials remain managed in Cloudflare. This screen is intentionally read-only for dangerous deployment settings.</p></div></section>
<div class="footer">Parmar AI Admin Control Center • Live refresh every 5 seconds • AI spend is an estimate, not the Google Cloud invoice. *30-day projection uses today&apos;s spend as a simple run-rate.</div></main>
<script>
const state={overview:null};
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtNum(v){return Number(v||0).toLocaleString('en-IN');}
function fmtMoney(v){return '$'+Number(v||0).toFixed(4);}
function fmtTime(v){return v?new Date(Number(v)).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'}):'—';}
function pct(v){return (Number(v||0)*100).toFixed(1)+'%';}
function renderBars(el,rows){const arr=rows||[],max=Math.max(1,...arr.map(x=>Number(x.count||0)));document.getElementById(el).innerHTML=arr.length?arr.map(x=>\`<div class="bar"><span>\${esc(x.label)}</span><div class="track"><div class="fill" style="width:\${Math.max(3,Number(x.count||0)/max*100)}%"></div></div><b>\${fmtNum(x.count)}</b></div>\`).join(''):'<span class="muted">No data yet.</span>';}
function renderSpendBars(el,rows){const arr=rows||[],max=Math.max(0.000001,...arr.map(x=>Number(x.spendUsd||0)));document.getElementById(el).innerHTML=arr.length?arr.map(x=>\`<div class="bar"><span>\${esc(x.label)}</span><div class="track"><div class="fill" style="width:\${Math.max(3,Number(x.spendUsd||0)/max*100)}%"></div></div><b>\${fmtMoney(x.spendUsd)}</b></div>\`).join(''):'<span class="muted">No data yet.</span>';}
function metric(label,value,sub=''){return \`<div class="card metric"><div class="k">\${label}</div><div class="v">\${value}</div><div class="sub">\${sub}</div></div>\`;}
async function api(path,opts){const r=await fetch(path,opts);if(r.status===401){location.href='/admin/login';throw new Error('unauthorized');}const d=await r.json();if(!d.ok)throw new Error(d.error||'request_failed');return d;}
async function refreshAll(){try{const d=await api('/admin/api/overview');state.overview=d;renderOverview(d);document.getElementById('stamp').textContent='Updated '+fmtTime(d.generatedAt)+' • auto-refresh 5s';}catch(e){document.getElementById('stamp').textContent='Dashboard error: '+e.message;}}
function renderOverview(d){const m=d.metrics,u=d.usage;document.getElementById('overviewCards').innerHTML=[metric('Total students',fmtNum(m.totalStudents),\`+\${fmtNum(m.newStudentsToday)} today\`),metric('AI questions today',fmtNum(m.questionsToday),\`\${fmtNum(m.activeStudentsToday)} active students\`),metric('Active right now',fmtNum(m.activeStudentsNow),\`\${fmtNum(m.returningStudentsToday)} returning today\`),metric('Total AI tokens',fmtNum(u.totalTokens),\`\${fmtNum(u.attemptsToday)} model attempts\`),metric('Estimated AI spend',fmtMoney(u.spendUsd),u.averageCostUsd?fmtMoney(u.averageCostUsd)+' / model attempt':''),metric('Success rate 24h',pct(1-m.failureRate24h),\`\${fmtNum(m.failed24h)} failed\`),metric('Avg response time',fmtNum(m.averageLatencyMs24h)+' ms','completed questions, 24h'),metric('Pending now',fmtNum(m.pendingJobs),\`\${fmtNum(m.processingJobs)} processing\`),metric('Daily limit hits',fmtNum(m.dailyLimitEventsToday),'today')].join('');
const b=d.budget;document.getElementById('aiSummary').innerHTML=\`<div class="kv"><div>Input tokens</div><div>\${fmtNum(u.promptTokens)}</div><div>Output tokens</div><div>\${fmtNum(u.candidatesTokens)}</div><div>Thinking tokens</div><div>\${fmtNum(u.thoughtsTokens)}</div><div>Total tokens</div><div>\${fmtNum(u.totalTokens)}</div><div>Retry spend</div><div>\${fmtMoney(u.retrySpendUsd)}</div><div>Budget</div><div>\${b.configuredUsd?fmtMoney(b.configuredUsd):'Not configured'}</div><div>Estimated remaining</div><div>\${b.remainingUsd===null?'Not configured':fmtMoney(b.remainingUsd)}</div><div>30-day projection*</div><div>\${fmtMoney(u.projected30dSpendUsd)}</div></div>\`;
document.getElementById('statusSummary').innerHTML=\`<div class="statusdot"><span class="dot"></span>\${d.status==='healthy'?'Everything is operating normally':d.status==='attention'?'Attention needed':'Critical attention needed'}</div><p class="muted">Failure rate 24h: \${pct(m.failureRate24h)}<br>Queue pending: \${fmtNum(m.pendingJobs)}<br>Recent retries: \${fmtNum(m.retriedQuestions7d)}</p>\`;
renderBars('topSubjects',d.topSubjects);renderBars('topTopics',d.topTopics);renderBars('quotaDistribution',d.quotaDistribution);document.getElementById('topUsersToday').innerHTML=(d.topUsersToday||[]).map(u=>{const name=u.username?'@'+u.username:[u.first_name,u.last_name].filter(Boolean).join(' ')||u.telegram_user_id;return \`<div class="notice"><b>\${esc(name)}</b><div>\${fmtNum(u.questionsToday)} questions · \${fmtNum(u.totalTokens)} tokens · \${fmtMoney(u.spendUsd)}</div></div>\`;}).join('')||'<span class="muted">No activity yet.</span>';document.getElementById('retentionView').innerHTML=(d.retention||[]).map(x=>\`<div class="bar"><span>\${esc(x.label)}</span><div class="track"><div class="fill" style="width:\${Math.max(3,Number(x.retentionRate||0)*100)}%"></div></div><b>\${(Number(x.retentionRate||0)*100).toFixed(1)}%</b></div><div class="small">\${fmtNum(x.retainedSize)} / \${fmtNum(x.cohortSize)} retained</div>\`).join('')||'<span class="muted">Not enough cohort history yet.</span>';const tbody=document.getElementById('overviewActivity');tbody.innerHTML=(d.activity||[]).slice(0,20).map(r=>\`<tr><td>\${fmtTime(r.received_at)}</td><td>\${esc(r.username?('@'+r.username):(r.display_name||r.telegram_user_id))}</td><td>\${esc(r.question_text)}</td><td>\${esc(r.topic||'—')}</td><td class="\${r.status==='completed'?'good':r.status==='failed'?'bad':'warn'}">\${esc(r.status)}</td><td>\${fmtNum(r.total_tokens)}</td><td>\${fmtMoney(Number(r.spend_microusd||0)/1e6)}</td></tr>\`).join('');
document.getElementById('alerts').innerHTML=(d.alerts||[]).map(a=>\`<div class="alert \${a.level}"><b>\${esc(a.title)}</b><div>\${esc(a.message)}</div></div>\`).join('');document.getElementById('aiCards').innerHTML=[metric('Today tokens',fmtNum(u.totalTokens)),metric('Today spend',fmtMoney(u.spendUsd)),metric('Retry spend',fmtMoney(u.retrySpendUsd)),metric('Budget remaining',b.remainingUsd===null?'—':fmtMoney(b.remainingUsd)),metric('30-day projection',fmtMoney(u.projected30dSpendUsd),'today run-rate')].join('');document.getElementById('thinkingSpend').innerHTML=Object.entries(u.spendByThinking).map(([k,v])=>\`<div class="bar"><span>\${k}</span><div class="track"><div class="fill" style="width:\${u.spendUsd?Math.max(3,v/u.spendUsd*100):3}%"></div></div><b>\${fmtMoney(v)}</b></div>\`).join('');}
async function loadUsers(){const q=document.getElementById('userSearch').value;const d=await api('/admin/api/users?q='+encodeURIComponent(q));document.getElementById('usersTable').innerHTML=(d.users||[]).map(u=>{const name=u.username?'@'+u.username:[u.first_name,u.last_name].filter(Boolean).join(' ')||u.telegram_user_id;const isProtected=Number(u.is_owner)||Number(u.is_admin);const access=Number(u.suspended)?'⛔ Suspended':Number(u.unlimited)?'♾️ Unlimited':'20/day';const accessNote=Number(u.is_owner)?'Owner':Number(u.is_admin)?'Admin':Number(u.unlimited)?'Unlimited access':'Normal quota';const accessAction="userAction("+u.telegram_user_id+","+JSON.stringify(Number(u.unlimited)?'revoke_unlimited':'grant_unlimited')+")";const suspendAction="userAction("+u.telegram_user_id+","+JSON.stringify(Number(u.suspended)?'unsuspend':'suspend')+")";return '<tr><td><b>'+esc(name)+'</b><div class="mono">'+u.telegram_user_id+'</div></td><td>'+fmtTime(u.first_seen_at)+'</td><td>'+fmtNum(u.question_count_today)+'</td><td>'+fmtNum(u.question_count)+'</td><td>'+fmtNum(u.question_count_30d)+'</td><td>'+fmtMoney(Number(u.spend_microusd||0)/1e6)+'</td><td><b>'+access+'</b><div class="small">'+accessNote+'</div></td><td>'+fmtTime(u.last_question_at)+'</td><td><div class="row-actions"><button class="btn alt" onclick="showUser('+u.telegram_user_id+')">View</button>'+(isProtected?'<button class="btn alt" disabled title="Protected admin account">Admin access</button>':'<button class="btn alt" onclick="'+accessAction+'">'+(Number(u.unlimited)?'Revoke unlimited':'Grant unlimited')+'</button>')+(isProtected?'<button class="btn alt" disabled title="Protected admin account">Protected</button>':'<button class="btn alt" onclick="'+suspendAction+'">'+(Number(u.suspended)?'Unsuspend':'Suspend')+'</button>')+'</div></td></tr>';}).join('')||'<tr><td colspan="9" class="muted">No students found.</td></tr>';}
async function showUser(id){const d=await api('/admin/api/user?user_id='+id);const u=d.user;const el=document.getElementById('userDetail');el.classList.add('open');el.innerHTML=\`<div style="display:flex;justify-content:space-between;gap:12px"><div><h2 style="margin:0">\${esc(u.username?'@'+u.username:[u.first_name,u.last_name].filter(Boolean).join(' ')||u.telegram_user_id)}</h2><div class="mono">Telegram ID \${u.telegram_user_id}</div></div><button class="btn alt" onclick="document.getElementById('userDetail').classList.remove('open')">Close</button></div><hr><div class="kv"><div>Target exam</div><div>\${esc(u.target_exam||'Not set')}</div><div>Total questions</div><div>\${fmtNum(u.question_count||0)}</div><div>Total AI tokens</div><div>\${fmtNum(d.totalTokens)}</div><div>Estimated AI spend</div><div>\${fmtMoney(d.estimatedSpendUsd)}</div><div>Unlimited access</div><div>\${d.unlimited?'Yes':'No'}</div><div>Suspended</div><div>\${Number(u.suspended)?'Yes':'No'}</div></div><h3>Top topics</h3><div>\${(d.topics||[]).map(x=>\`<span class="pill">\${esc(x.label)} · \${x.count}</span> \`).join('')||'—'}</div><h3>Learning signals</h3><div>\${(d.learningSignals||[]).map(x=>\`<span class="pill">\${esc(x.label)} · \${x.count}</span> \`).join('')||'No explicit learning signals yet.'}</div><h3>Recent questions</h3><div class="tablewrap"><table class="table"><thead><tr><th>Time</th><th>Question</th><th>Topic</th><th>Status</th></tr></thead><tbody>\${(d.questions||[]).map(q=>\`<tr><td>\${fmtTime(q.received_at)}</td><td>\${esc(q.question_text)}</td><td>\${esc(q.topic||'—')}</td><td>\${esc(q.status)}</td></tr>\`).join('')}</tbody></table></div><div class="row-actions"><button class="btn alt" onclick="userAction(\${id},'reset_profile')">Reset study profile</button></div>\`;}
async function userAction(id,action){const confirmText={grant_unlimited:'Grant unlimited daily AI access?',revoke_unlimited:'Revoke unlimited access?',suspend:'Suspend this student?',unsuspend:'Restore this student?',reset_profile:"Reset this student's study profile?"}[action]||'Continue?';if(!confirm(confirmText))return;try{await api('/admin/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,telegramUserId:id})});}catch(e){alert('Action failed: '+e.message);return;}await loadUsers();if(document.getElementById('userDetail').classList.contains('open'))await showUser(id);await loadAccess();await loadAudit();}
async function grantUnlimitedId(){const id=document.getElementById('grantId').value.trim();if(!/^\d+$/.test(id))return alert('Enter a numeric Telegram User ID.');try{await api('/admin/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'grant_unlimited',telegramUserId:Number(id)})});}catch(e){alert('Grant failed: '+e.message);return;}document.getElementById('grantId').value='';await loadAccess();await loadAudit();}
async function loadAccess(){const d=await api('/admin/api/access');document.getElementById('adminList').innerHTML=\`<div class="kv"><div>Owner</div><div>\${d.ownerTelegramUserId||'Not configured'}</div><div>Additional admins</div><div>\${(d.admins||[]).map(x=>\`<span class="pill">\${x}</span>\`).join(' ')||'None'}</div><div>Static unlimited</div><div>\${(d.staticUnlimited||[]).map(x=>\`<span class="pill">\${x}</span>\`).join(' ')||'None'}</div></div>\`;document.getElementById('overrideList').innerHTML=(d.overrides||[]).map(o=>\`<div class="notice"><b>\${esc(o.username?'@'+o.username:[o.first_name,o.last_name].filter(Boolean).join(' ')||o.telegram_user_id)}</b><div class="mono">\${o.telegram_user_id}</div><div>Granted \${fmtTime(o.granted_at)} · \${o.expires_at?('expires '+fmtTime(o.expires_at)):'no expiry'}</div><button class="btn alt" onclick="userAction(\${o.telegram_user_id},'revoke_unlimited')">Revoke</button></div>\`).join('')||'<span class="muted">No runtime overrides.</span>';}
async function loadActivity(){const n=document.getElementById('activityLimit').value;const d=await api('/admin/api/activity?limit='+n);document.getElementById('activityTable').innerHTML=(d.activity||[]).map(r=>\`<tr><td>\${fmtTime(r.received_at)}</td><td>\${esc(r.username?('@'+r.username):(r.display_name||r.telegram_user_id))}</td><td>\${esc(r.question_text)}</td><td>\${esc(r.topic||'—')}</td><td>\${esc(r.question_mode||'—')}</td><td>\${esc(r.thinking_level||'—')}</td><td>\${esc(r.status)}</td><td>\${fmtNum(r.attempts)}</td><td>\${fmtNum(r.total_tokens)}</td><td>\${fmtMoney(Number(r.spend_microusd||0)/1e6)}</td></tr>\`).join('');}
async function loadAi(){const d=await api('/admin/api/ai-usage?days=7');const s=d.summary||{};document.getElementById('aiCards').innerHTML=[metric('7-day tokens',fmtNum(s.totalTokens)),metric('7-day spend',fmtMoney(s.spendUsd)),metric('Avg cost / attempt',fmtMoney(s.averageCostUsd)),metric('Prompt tokens',fmtNum(s.promptTokens)),metric('Thinking tokens',fmtNum(s.thoughtsTokens)),metric('Cached input',fmtNum(s.cachedContentTokens))].join('');document.getElementById('tokenBreakdown').innerHTML='<div class="kv">'+[['Prompt tokens',s.promptTokens],['Output tokens',s.candidatesTokens],['Thinking tokens',s.thoughtsTokens],['Tool-use input',s.toolUsePromptTokens],['Cached input',s.cachedContentTokens],['Total tokens',s.totalTokens]].map(x=>'<div>'+esc(x[0])+'</div><div>'+fmtNum(x[1])+'</div>').join('')+'</div>';renderSpendBars('thinkingSpend',Object.entries(d.thinkingSpend||{}).map(x=>({label:x[0],spendUsd:Number(x[1]||0)})));renderSpendBars('groundingSpend',(d.grounding||[]).map(x=>({label:String(x.label||'unknown'),spendUsd:Number(x.spendUsd||0)})));renderSpendBars('modelSpend',(d.models||[]).map(x=>({label:String(x.model||'unknown')+' · '+String(x.thinking_level||'unknown'),spendUsd:Number(x.spendUsd||0)})));document.getElementById('aiTrend').innerHTML=(d.daily||[]).map(x=>\`<div class="bar"><span>\${esc(x.day)}</span><div class="track"><div class="fill" style="width:\${Math.max(3,(x.spendUsd/Math.max(0.0001,...d.daily.map(y=>y.spendUsd)))*100)}%"></div></div><b>\${fmtMoney(x.spendUsd)}</b></div>\`).join('')||'<span class="muted">No data.</span>';document.getElementById('expensive').innerHTML=(d.expensive||[]).map(x=>\`<tr><td>\${fmtTime(x.received_at)}</td><td>\${esc(x.username?'@'+x.username:x.telegram_user_id)}</td><td>\${esc(x.question_text)}</td><td>\${fmtNum(x.totalTokens)}</td><td>\${fmtMoney(x.spendUsd)}</td></tr>\`).join('')||'<tr><td colspan="5">No data.</td></tr>';
}

async function loadLearning(){const d=await api('/admin/api/learning');renderBars('learnSubjects',d.subjects);renderBars('learnModes',d.modes);renderBars('learnConfusion',d.confusionTopics);renderBars('learnTopics',d.topics);}
async function loadSystem(){const d=await api('/admin/api/system');document.getElementById('systemCards').innerHTML=[metric('Questions 24h',fmtNum(d.recentQuestions24h)),metric('Avg latency',fmtNum(d.avgLatencyMs24h)+' ms'),metric('Analytics events 24h',fmtNum(d.analyticsEvents24h)),metric('Raw retention',d.rawRetentionDays+' days')].join('');document.getElementById('systemAlerts').innerHTML='<div class="legend"><span>🟢 Telegram: '+(d.telegramConfigured?'configured':'missing')+'</span><span>🟢 Vertex AI: '+(d.vertexAiConfigured?'configured':'missing')+'</span><span>🟢 D1: '+(d.databaseConfigured?'configured':'missing')+'</span></div>';document.getElementById('queueHealth').innerHTML=\`<div class="kv"><div>Queue</div><div>\${d.queueConfigured?'Configured':'Missing'}</div><div>Durable Object</div><div>\${d.durableObjectConfigured?'Configured':'Missing'}</div><div>Daily limit</div><div>\${d.dailyQuestionLimit}</div><div>Burst guard</div><div>\${d.burstLimit} / \${d.burstWindowSeconds}s</div></div>\`;document.getElementById('configView').innerHTML=\`<div class="kv"><div>Version</div><div>\${esc(d.version)}</div><div>Environment</div><div>\${esc(d.environment)}</div><div>Model</div><div>\${esc(d.model)}</div><div>Location</div><div>\${esc(d.location)}</div><div>Thinking policy</div><div>\${esc(d.thinkingPolicy)}</div><div>Admin dashboard</div><div>\${d.adminDashboardConfigured?'Configured':'Missing credentials'}</div><div>AI estimate rate</div><div>\${fmtMoney(d.pricing?.inputUsdPerMillion/1000000)} / input token · \${fmtMoney(d.pricing?.outputUsdPerMillion/1000000)} / output token</div></div>\`;document.getElementById('settingsView').innerHTML=\`<div class="kv"><div>Daily AI questions</div><div>\${d.dailyQuestionLimit}</div><div>Burst guard</div><div>\${d.burstLimit} questions / \${d.burstWindowSeconds}s</div><div>AI model</div><div>\${esc(d.model)}</div><div>Google location</div><div>\${esc(d.location)}</div><div>Retention</div><div>\${d.rawRetentionDays} days</div></div>\`;document.getElementById('dataStatus').innerHTML='<div class="kv"><div>Feedback collection</div><div>Not enabled yet — no student feedback scores are currently stored.</div><div>AI cost source</div><div>Token usage metadata + configured estimate rates</div><div>Billing truth</div><div>Google Cloud billing account remains authoritative</div></div>';}
async function loadAudit(){const d=await api('/admin/api/audit?limit=100');document.getElementById('auditTable').innerHTML=(d.audit||[]).map(x=>\`<tr><td>\${fmtTime(x.created_at)}</td><td>\${esc(x.actor)}</td><td>\${esc(x.action)}</td><td>\${x.target_telegram_user_id||'—'}</td><td class="mono">\${esc(x.details_json||'')}</td></tr>\`).join('');}
async function downloadReport(){const days=document.getElementById('reportDays').value;const d=await api('/admin/api/export?days='+days);const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='parmar-ai-report-'+days+'d.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function openTelegramTab(){
  const tab=document.querySelector('.tab[data-page="telegram"]');
  if(tab) tab.click();
}
async function loadTelegram(){
  try{
    const d=await api('/admin/api/telegram');
    const status=document.getElementById('telegramStatus');
    const alerts=document.getElementById('telegramAlerts');
    if(!d.connected){
      status.innerHTML='<div class="notice"><b>No active Telegram bot.</b><div class="muted">Enter a BotFather token to connect one.</div></div>';
      alerts.innerHTML=d.encryption?.configured?'':'<div class="alert critical"><b>Telegram token encryption is unavailable.</b><div>Admin session secret/encryption secret is missing.</div></div>';
    }else{
      const b=d.bot||{};
      const hook=d.webhook||{};
      const health=d.verified===false?'bad':'good';
      status.innerHTML='<div class="kv"><div>Bot</div><div><b>'+esc(b.username||b.firstName||'Telegram bot')+'</b></div><div>Bot ID</div><div class="mono">'+esc(b.botId)+'</div><div>Status</div><div class="'+health+'">'+(d.verified===false?'Verification failed':'Active')+'</div><div>Webhook</div><div>'+esc(hook.url||'Not reported')+'</div><div>Pending updates</div><div>'+fmtNum(hook.pending_update_count||0)+'</div><div>Connection source</div><div>'+esc(d.source||'dashboard')+(d.legacyNeedsImport?' — import recommended':'')+'</div></div><div class="row-actions" style="margin-top:12px"><button class="btn alt" onclick="testTelegram()">Test connection</button><button class="btn alt" onclick="disconnectTelegram()">Disconnect</button></div>';
      alerts.innerHTML='';
    }
    document.getElementById('telegramHistory').innerHTML=(d.history||[]).map(h=>'<div class="notice"><b>'+esc(h.username||h.firstName||'Telegram bot')+'</b><div class="mono">'+esc(h.botId)+'</div><div>'+esc(h.status)+' · connected '+fmtTime(h.connectedAt)+(h.disconnectedAt?' · disconnected '+fmtTime(h.disconnectedAt):'')+'</div></div>').join('')||'<span class="muted">No connection history yet.</span>';
  }catch(e){
    document.getElementById('telegramAlerts').innerHTML='<div class="alert critical"><b>Telegram status unavailable.</b><div>'+esc(e.message)+'</div></div>';
  }
}
async function connectTelegram(){
  const input=document.getElementById('telegramToken');
  const token=input.value.trim();
  if(!token){
    if(!confirm('No token entered. Import the currently configured Cloudflare Telegram bot?')) return;
  }else{
    if(!confirm('Verify and connect this Telegram bot? The current bot will be switched off only after the new bot passes verification.')) return;
  }
  try{
    const d=await api('/admin/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'connect_telegram',botToken:token||undefined})});
    input.value='';
    alert((d.switched?'✅ Switched from '+(d.previousBotUsername||'the previous bot')+' to ':'✅ Connected ')+(d.botUsername||'Telegram bot')+'.');
    await loadTelegram();
    await loadAudit();
  }catch(e){
    alert('Telegram connection failed: '+e.message);
    await loadTelegram();
  }
}
async function testTelegram(){
  try{const d=await api('/admin/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'test_telegram'})});alert('✅ '+(d.botUsername||'Telegram bot')+' is reachable. Pending webhook updates: '+fmtNum(d.webhook?.pending_update_count||0)+'.');await loadTelegram();}catch(e){alert('Telegram test failed: '+e.message);}
}
async function disconnectTelegram(){
  if(!confirm('Disconnect the active Telegram bot and discard its pending webhook updates?')) return;
  try{await api('/admin/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'disconnect_telegram'})});alert('✅ Telegram bot disconnected.');await loadTelegram();await loadAudit();}catch(e){alert('Telegram disconnect failed: '+e.message);}
}
async function logout(){await fetch('/admin/logout',{method:'POST'});location.href='/admin/login';}
document.querySelectorAll('.tab').forEach(t=>t.onclick=async()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.getElementById('page-'+t.dataset.page).classList.add('active');const p=t.dataset.page;if(p==='users')await loadUsers();if(p==='ai')await loadAi();if(p==='learning')await loadLearning();if(p==='activity')await loadActivity();if(p==='system')await loadSystem();if(p==='access')await loadAccess();if(p==='audit')await loadAudit();if(p==='telegram')await loadTelegram();if(p==='settings')await loadSystem();});
refreshAll();setInterval(refreshAll,5000);
</script></body></html>`;
