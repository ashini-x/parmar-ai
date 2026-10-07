import type { AiUsageRecord, AnswerPacket, Env, StudentProfile } from "../config/env";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  telegram_user_id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  first_seen_at INTEGER NOT NULL,
  target_exam TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER,
  chat_id INTEGER,
  event_type TEXT NOT NULL,
  event_at INTEGER NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  update_id INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  username TEXT,
  display_name TEXT,
  question_text TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  accepted_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  status TEXT NOT NULL,
  topic TEXT,
  subject TEXT,
  question_mode TEXT,
  exam_relevance TEXT,
  difficulty TEXT,
  thinking_level TEXT,
  time_sensitive INTEGER NOT NULL DEFAULT 0,
  grounded INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  answer_text TEXT,
  ssc_takeaway TEXT,
  error_message TEXT,
  detected_exam TEXT
);

CREATE TABLE IF NOT EXISTS ai_access_overrides (
  telegram_user_id INTEGER PRIMARY KEY,
  unlimited_ai INTEGER NOT NULL DEFAULT 1,
  granted_by_telegram_user_id INTEGER NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS ai_usage_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  queue_attempt INTEGER NOT NULL DEFAULT 1,
  telegram_user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  model TEXT NOT NULL,
  location TEXT NOT NULL,
  thinking_level TEXT NOT NULL,
  grounded INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  candidates_tokens INTEGER NOT NULL DEFAULT 0,
  thoughts_tokens INTEGER NOT NULL DEFAULT 0,
  tool_use_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cached_content_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  UNIQUE(update_id, queue_attempt, attempt)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_telegram_user_id INTEGER,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_user_controls (
  telegram_user_id INTEGER PRIMARY KEY,
  suspended INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_first_seen ON users(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_questions_received ON questions(received_at);
CREATE INDEX IF NOT EXISTS idx_questions_user_received ON questions(telegram_user_id, received_at);
CREATE INDEX IF NOT EXISTS idx_questions_status_received ON questions(status, received_at);
CREATE INDEX IF NOT EXISTS idx_questions_topic_received ON questions(topic, received_at);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(event_at);
CREATE INDEX IF NOT EXISTS idx_events_user_at ON events(telegram_user_id, event_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_recorded ON ai_usage_attempts(recorded_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_recorded ON ai_usage_attempts(telegram_user_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
`;

let schemaPromise: Promise<void> | null = null;

export function parseTelegramUserIdSet(value: string | undefined): Set<number> {
  const result = new Set<number>();
  for (const token of (value ?? "").split(",")) {
    const parsed = Number(token.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) result.add(parsed);
  }
  return result;
}

export function isAdminTelegramUser(env: Env, telegramUserId: number): boolean {
  if (telegramUserId === Number(env.BOT_OWNER_TELEGRAM_USER_ID ?? "")) return true;
  return parseTelegramUserIdSet(env.ADMIN_TELEGRAM_USER_IDS).has(telegramUserId);
}

export async function hasUnlimitedAiAccess(env: Env, telegramUserId: number, now = Date.now()): Promise<boolean> {
  if (isAdminTelegramUser(env, telegramUserId)) return true;
  if (parseTelegramUserIdSet(env.UNLIMITED_AI_TELEGRAM_USER_IDS).has(telegramUserId)) return true;
  if (!env.DB) return false;
  await ensureAnalyticsSchema(env);
  const row = await env.DB.prepare(
    `SELECT unlimited_ai, expires_at FROM ai_access_overrides WHERE telegram_user_id = ?`
  ).bind(telegramUserId).first<{ unlimited_ai: number; expires_at: number | null }>();
  return Boolean(row && row.unlimited_ai && (row.expires_at === null || Number(row.expires_at) > now));
}

export async function grantUnlimitedAiAccess(env: Env, telegramUserId: number, grantedByTelegramUserId: number, expiresAt: number | null = null): Promise<void> {
  if (!env.DB) throw new Error("D1 is required for runtime access overrides.");
  await ensureAnalyticsSchema(env);
  const grantedAt = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO ai_access_overrides (telegram_user_id, unlimited_ai, granted_by_telegram_user_id, granted_at, expires_at)
     VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       unlimited_ai = 1,
       granted_by_telegram_user_id = excluded.granted_by_telegram_user_id,
       granted_at = excluded.granted_at,
       expires_at = excluded.expires_at`
  ).bind(telegramUserId, grantedByTelegramUserId, grantedAt, expiresAt).run();

  if (!result.success) throw new Error("D1 did not confirm the unlimited-access write.");

  const verified = await env.DB.prepare(
    `SELECT unlimited_ai, expires_at FROM ai_access_overrides WHERE telegram_user_id = ?`
  ).bind(telegramUserId).first<{ unlimited_ai: number; expires_at: number | null }>();

  if (!verified || Number(verified.unlimited_ai) !== 1 || (expiresAt !== null && Number(verified.expires_at) !== expiresAt)) {
    throw new Error("Unlimited-access write could not be verified in D1.");
  }
}

export async function revokeUnlimitedAiAccess(env: Env, telegramUserId: number): Promise<void> {
  if (!env.DB) throw new Error("D1 is required for runtime access overrides.");
  await ensureAnalyticsSchema(env);
  const result = await env.DB.prepare(`DELETE FROM ai_access_overrides WHERE telegram_user_id = ?`).bind(telegramUserId).run();
  if (!result.success) throw new Error("D1 did not confirm the unlimited-access revoke.");
  const verified = await env.DB.prepare(`SELECT 1 AS present FROM ai_access_overrides WHERE telegram_user_id = ?`).bind(telegramUserId).first();
  if (verified) throw new Error("Unlimited-access revoke could not be verified in D1.");
}

export async function deleteUserData(env: Env, telegramUserId: number): Promise<{ chatId: number | null }> {
  if (!env.DB) return { chatId: null };
  await ensureAnalyticsSchema(env);
  const user = await env.DB.prepare(`SELECT chat_id FROM users WHERE telegram_user_id = ?`)
    .bind(telegramUserId)
    .first<{ chat_id: number }>();

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ai_usage_attempts WHERE telegram_user_id = ?`).bind(telegramUserId),
    env.DB.prepare(`DELETE FROM questions WHERE telegram_user_id = ?`).bind(telegramUserId),
    env.DB.prepare(`DELETE FROM events WHERE telegram_user_id = ?`).bind(telegramUserId),
    env.DB.prepare(`DELETE FROM ai_access_overrides WHERE telegram_user_id = ?`).bind(telegramUserId),
    env.DB.prepare(`DELETE FROM admin_user_controls WHERE telegram_user_id = ?`).bind(telegramUserId),
    env.DB.prepare(`DELETE FROM admin_audit_log WHERE target_telegram_user_id = ?`).bind(telegramUserId),
    env.DB.prepare(`DELETE FROM users WHERE telegram_user_id = ?`).bind(telegramUserId),
  ]);

  return { chatId: user?.chat_id ?? null };
}

export async function isUserSuspended(env: Env, telegramUserId: number): Promise<boolean> {
  if (!env.DB) return false;
  await ensureAnalyticsSchema(env);
  const row = await env.DB.prepare(`SELECT suspended FROM admin_user_controls WHERE telegram_user_id = ?`).bind(telegramUserId).first<{ suspended: number }>();
  return Boolean(row?.suspended);
}

export async function setUserSuspended(env: Env, telegramUserId: number, suspended: boolean, note: string, updatedBy: string): Promise<void> {
  if (!env.DB) throw new Error("D1 is required for user controls.");
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(
    `INSERT INTO admin_user_controls (telegram_user_id, suspended, note, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET suspended = excluded.suspended, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(telegramUserId, suspended ? 1 : 0, note || null, Date.now(), updatedBy).run();
}

export interface AnalyticsUser {
  telegramUserId: number;
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  isBot?: boolean;
  targetExam?: string;
}

export interface QuestionAnalyticsStart {
  updateId: number;
  requestId: string;
  user: AnalyticsUser;
  messageId: number;
  question: string;
  receivedAt: number;
}

export interface QuestionAnalyticsResult {
  updateId: number;
  status: "processing" | "completed" | "failed" | "out_of_scope" | "delivery_failed";
  completedAt?: number;
  startedAt?: number;
  latencyMs?: number;
  attempts?: number;
  packet?: AnswerPacket;
  thinkingLevel?: string;
  grounded?: boolean;
  errorMessage?: string;
}

export interface AiUsageAnalyticsInput {
  updateId: number;
  requestId: string;
  queueAttempt: number;
  telegramUserId: number;
  chatId: number;
  usage: AiUsageRecord[];
}

export async function ensureAnalyticsSchema(env: Env): Promise<void> {
  if (!env.DB) return;
  if (!schemaPromise) {
    schemaPromise = env.DB.batch(splitSchemaStatements().map((sql) => env.DB!.prepare(sql)))
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
}

export async function recordUserSeen(env: Env, user: AnalyticsUser, now = Date.now()): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(
    `INSERT INTO users
      (telegram_user_id, chat_id, username, first_name, last_name, first_seen_at, target_exam, is_bot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       chat_id = excluded.chat_id,
       username = COALESCE(excluded.username, users.username),
       first_name = COALESCE(excluded.first_name, users.first_name),
       last_name = COALESCE(excluded.last_name, users.last_name),
       is_bot = excluded.is_bot`
  ).bind(user.telegramUserId, user.chatId, user.username ?? null, user.firstName ?? null, user.lastName ?? null, now, user.targetExam ?? null, user.isBot ? 1 : 0).run();
}

export async function updateUserIdentity(env: Env, user: AnalyticsUser): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(
    `INSERT INTO users
      (telegram_user_id, chat_id, username, first_name, last_name, first_seen_at, target_exam, is_bot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       chat_id = excluded.chat_id,
       username = COALESCE(excluded.username, users.username),
       first_name = COALESCE(excluded.first_name, users.first_name),
       last_name = COALESCE(excluded.last_name, users.last_name),
       target_exam = COALESCE(excluded.target_exam, users.target_exam)`
  ).bind(user.telegramUserId, user.chatId, user.username ?? null, user.firstName ?? null, user.lastName ?? null, Date.now(), user.targetExam ?? null, user.isBot ? 1 : 0).run();
}

export async function recordEvent(env: Env, eventType: string, user: AnalyticsUser | null, metadata?: Record<string, unknown>, now = Date.now()): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(`INSERT INTO events (telegram_user_id, chat_id, event_type, event_at, metadata_json) VALUES (?, ?, ?, ?, ?)`).bind(
    user?.telegramUserId ?? null,
    user?.chatId ?? null,
    eventType,
    now,
    metadata ? JSON.stringify(metadata).slice(0, 2_000) : null,
  ).run();
}

export async function recordQuestionStart(env: Env, item: QuestionAnalyticsStart): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  const displayName = [item.user.firstName, item.user.lastName].filter(Boolean).join(" ").trim() || null;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO questions
      (update_id, request_id, telegram_user_id, chat_id, message_id, username, display_name,
       question_text, received_at, accepted_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(item.updateId, item.requestId, item.user.telegramUserId, item.user.chatId, item.messageId, item.user.username ?? null, displayName, item.question, item.receivedAt, item.receivedAt).run();
}

export async function recordQuestionResult(env: Env, result: QuestionAnalyticsResult): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  const packet = result.packet;
  await env.DB.prepare(
    `UPDATE questions SET
       status = ?,
       started_at = COALESCE(?, started_at),
       completed_at = COALESCE(?, completed_at),
       latency_ms = COALESCE(?, latency_ms),
       attempts = COALESCE(?, attempts),
       topic = COALESCE(?, topic),
       subject = COALESCE(?, subject),
       question_mode = COALESCE(?, question_mode),
       exam_relevance = COALESCE(?, exam_relevance),
       difficulty = COALESCE(?, difficulty),
       thinking_level = COALESCE(?, thinking_level),
       time_sensitive = COALESCE(?, time_sensitive),
       grounded = COALESCE(?, grounded),
       answer_text = COALESCE(?, answer_text),
       ssc_takeaway = COALESCE(?, ssc_takeaway),
       error_message = COALESCE(?, error_message),
       detected_exam = COALESCE(?, detected_exam)
     WHERE update_id = ?`
  ).bind(
    result.status, result.startedAt ?? null, result.completedAt ?? null, result.latencyMs ?? null, result.attempts ?? 0,
    packet?.topic ?? null, packet?.subject ?? null, packet?.questionMode ?? null, packet?.examRelevance ?? null, packet?.difficulty ?? null,
    result.thinkingLevel ?? null, packet?.timeSensitive ? 1 : 0, result.grounded ? 1 : 0, packet?.answer ?? null, packet?.sscTakeaway ?? null,
    result.errorMessage?.slice(0, 2_000) ?? null, packet?.detectedExam ?? null, result.updateId,
  ).run();
}

export async function recordAiUsage(env: Env, item: AiUsageAnalyticsInput): Promise<void> {
  if (!env.DB || !item.usage.length) return;
  await ensureAnalyticsSchema(env);
  const statements = item.usage.map((usage) => env.DB!.prepare(
    `INSERT OR IGNORE INTO ai_usage_attempts
      (update_id, request_id, queue_attempt, telegram_user_id, chat_id, attempt, model, location, thinking_level, grounded,
       prompt_tokens, candidates_tokens, thoughts_tokens, tool_use_prompt_tokens, cached_content_tokens,
       total_tokens, estimated_cost_microusd, status, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    item.updateId, item.requestId, item.queueAttempt, item.telegramUserId, item.chatId, usage.attempt, usage.model, usage.location,
    usage.thinkingLevel, usage.grounded ? 1 : 0, usage.promptTokens, usage.candidatesTokens, usage.thoughtsTokens,
    usage.toolUsePromptTokens, usage.cachedContentTokens, usage.totalTokens, usage.estimatedCostMicrousd, usage.status, usage.recordedAt,
  ));
  await env.DB.batch(statements);
}

export async function recordAdminAudit(env: Env, actor: string, action: string, targetTelegramUserId?: number | null, details?: Record<string, unknown>): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(`INSERT INTO admin_audit_log (actor, action, target_telegram_user_id, details_json, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(actor, action, targetTelegramUserId ?? null, details ? JSON.stringify(details).slice(0, 4_000) : null, Date.now()).run();
}

export async function syncStudentProfile(env: Env, user: AnalyticsUser, profile: StudentProfile): Promise<void> {
  if (!env.DB) return;
  await updateUserIdentity(env, { ...user, targetExam: profile.targetExam });
}

export async function cleanupAnalytics(env: Env, retentionDays: number): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  const cutoff = Date.now() - Math.max(1, retentionDays) * 86_400_000;
  await env.DB.prepare(`DELETE FROM questions WHERE received_at < ?`).bind(cutoff).run();
  await env.DB.prepare(`DELETE FROM events WHERE event_at < ?`).bind(cutoff).run();
  await env.DB.prepare(`DELETE FROM ai_usage_attempts WHERE recorded_at < ?`).bind(cutoff).run();
  await env.DB.prepare(`DELETE FROM admin_audit_log WHERE created_at < ?`).bind(cutoff).run();
}

export function getAnalyticsConfig(env: Env): { retentionDays: number } {
  const value = Number.parseInt(env.ANALYTICS_RAW_RETENTION_DAYS ?? "90", 10);
  return { retentionDays: Number.isFinite(value) && value > 0 ? value : 90 };
}

function splitSchemaStatements(): string[] {
  return SCHEMA_SQL.split(";").map((statement) => statement.trim()).filter(Boolean).map((statement) => `${statement};`);
}
