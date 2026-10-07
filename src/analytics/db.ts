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

CREATE TABLE IF NOT EXISTS quiz_sessions (
  poll_id TEXT PRIMARY KEY,
  bot_connection_id TEXT NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  update_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_option_ids_json TEXT NOT NULL,
  explanation TEXT NOT NULL,
  topic TEXT,
  subject TEXT,
  difficulty TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  selected_option_ids_json TEXT,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_created
  ON quiz_sessions(telegram_user_id, created_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_telegram_user_id INTEGER,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  client_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
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

CREATE TABLE IF NOT EXISTS telegram_bots (
  bot_connection_id TEXT PRIMARY KEY,
  bot_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  token_ciphertext TEXT NOT NULL,
  webhook_secret_ciphertext TEXT NOT NULL,
  webhook_secret_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active','disconnected')),
  connected_at INTEGER NOT NULL,
  last_verified_at INTEGER,
  disconnected_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_bots_one_active
  ON telegram_bots(status) WHERE status='active';

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

function analyticsUpdateId(env: Env, updateId: number, botConnectionId = "legacy-env"): number {
  // Telegram update IDs are scoped to each bot. A replacement BotFather bot
  // can legitimately reuse small IDs, so D1 analytics use a stable bot-specific
  // key while the real Telegram update ID remains in the operational job path.
  const seed = `${botConnectionId}:${updateId}`;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= BigInt(seed.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return Number(hash % 9_000_000_000_000_000n) + 1;
}

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
    env.DB.prepare(`DELETE FROM quiz_sessions WHERE telegram_user_id = ?`).bind(telegramUserId),
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
  const desiredState = suspended ? 1 : 0;
  const result = await env.DB.prepare(
    `INSERT INTO admin_user_controls (telegram_user_id, suspended, note, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET suspended = excluded.suspended, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(telegramUserId, desiredState, note || null, Date.now(), updatedBy).run();

  if (!result.success) throw new Error("D1 did not confirm the user-access control write.");

  const verified = await env.DB.prepare(
    `SELECT suspended FROM admin_user_controls WHERE telegram_user_id=?`
  ).bind(telegramUserId).first<{ suspended: number }>();

  if (!verified || Number(verified.suspended) !== desiredState) {
    throw new Error("User-access control write could not be verified in D1.");
  }
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
  botConnectionId?: string;
  requestId: string;
  user: AnalyticsUser;
  messageId: number;
  question: string;
  receivedAt: number;
}

export interface QuestionAnalyticsResult {
  updateId: number;
  botConnectionId?: string;
  status: "processing" | "completed" | "failed" | "cancelled" | "out_of_scope" | "delivery_failed";
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
  botConnectionId?: string;
  requestId: string;
  queueAttempt: number;
  telegramUserId: number;
  chatId: number;
  usage: AiUsageRecord[];
}

async function ensureQuizSessionSchema(env: Env): Promise<void> {
  if (!env.DB) return;

  // quiz_sessions existed before bot-aware quiz correlation was introduced.
  // CREATE TABLE IF NOT EXISTS does not add the new column to an existing D1
  // table, so migrate that legacy shape in place.
  const columns = await env.DB.prepare("SELECT name FROM pragma_table_info('quiz_sessions')").all<{ name: string }>();
  const hasBotConnectionId = (columns.results ?? []).some((column) => column.name === "bot_connection_id");

  if (!hasBotConnectionId) {
    await env.DB.prepare(
      "ALTER TABLE quiz_sessions ADD COLUMN bot_connection_id TEXT NOT NULL DEFAULT 'legacy-env'"
    ).run();
  }
}

export async function ensureAnalyticsSchema(env: Env): Promise<void> {
  if (!env.DB) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await env.DB!.batch(splitSchemaStatements().map((sql) => env.DB!.prepare(sql)));
      await ensureQuizSessionSchema(env);
    })()
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
  ).bind(analyticsUpdateId(env, item.updateId, item.botConnectionId), item.requestId, item.user.telegramUserId, item.user.chatId, item.messageId, item.user.username ?? null, displayName, item.question, item.receivedAt, item.receivedAt).run();
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
    result.errorMessage?.slice(0, 2_000) ?? null, packet?.detectedExam ?? null,
    analyticsUpdateId(env, result.updateId, result.botConnectionId),
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
    analyticsUpdateId(env, item.updateId, item.botConnectionId), item.requestId, item.queueAttempt, item.telegramUserId, item.chatId, usage.attempt, usage.model, usage.location,
    usage.thinkingLevel, usage.grounded ? 1 : 0, usage.promptTokens, usage.candidatesTokens, usage.thoughtsTokens,
    usage.toolUsePromptTokens, usage.cachedContentTokens, usage.totalTokens, usage.estimatedCostMicrousd, usage.status, usage.recordedAt,
  ));
  await env.DB.batch(statements);
}

export interface QuizSession {
  pollId: string;
  botConnectionId: string;
  telegramUserId: number;
  chatId: number;
  updateId: number;
  messageId: number;
  questionText: string;
  options: string[];
  correctOptionIds: number[];
  explanation: string;
  topic: string | null;
  subject: string | null;
  difficulty: string | null;
  createdAt: number;
  answeredAt: number | null;
  selectedOptionIds: number[];
  result: "correct" | "incorrect" | null;
}

export async function createQuizSession(
  env: Env,
  input: {
    pollId: string;
    botConnectionId: string;
    telegramUserId: number;
    chatId: number;
    updateId: number;
    messageId: number;
    questionText: string;
    options: string[];
    correctOptionIds: number[];
    explanation: string;
    topic?: string | null;
    subject?: string | null;
    difficulty?: string | null;
  },
): Promise<void> {
  if (!env.DB) throw new Error("D1 is required for quiz sessions.");
  await ensureAnalyticsSchema(env);
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO quiz_sessions
      (poll_id, bot_connection_id, telegram_user_id, chat_id, update_id, message_id, question_text,
       options_json, correct_option_ids_json, explanation, topic, subject, difficulty, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.pollId,
    input.botConnectionId,
    input.telegramUserId,
    input.chatId,
    input.updateId,
    input.messageId,
    input.questionText,
    JSON.stringify(input.options),
    JSON.stringify(input.correctOptionIds),
    input.explanation,
    input.topic ?? null,
    input.subject ?? null,
    input.difficulty ?? null,
    Date.now(),
  ).run();
  if (!result.success) throw new Error("D1 did not confirm the quiz session write.");
}

export async function getQuizSession(env: Env, pollId: string): Promise<QuizSession | null> {
  if (!env.DB) return null;
  await ensureAnalyticsSchema(env);
  const row = await env.DB.prepare(
    `SELECT * FROM quiz_sessions WHERE poll_id = ? LIMIT 1`
  ).bind(pollId).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    pollId: String(row.poll_id),
    botConnectionId: String(row.bot_connection_id ?? ""),
    telegramUserId: Number(row.telegram_user_id),
    chatId: Number(row.chat_id),
    updateId: Number(row.update_id),
    messageId: Number(row.message_id),
    questionText: String(row.question_text ?? ""),
    options: parseJsonStringArray(row.options_json),
    correctOptionIds: parseJsonNumberArray(row.correct_option_ids_json),
    explanation: String(row.explanation ?? ""),
    topic: row.topic == null ? null : String(row.topic),
    subject: row.subject == null ? null : String(row.subject),
    difficulty: row.difficulty == null ? null : String(row.difficulty),
    createdAt: Number(row.created_at),
    answeredAt: row.answered_at == null ? null : Number(row.answered_at),
    selectedOptionIds: parseJsonNumberArray(row.selected_option_ids_json),
    result: row.result === "correct" || row.result === "incorrect" ? row.result : null,
  };
}

export async function answerQuizSession(
  env: Env,
  pollId: string,
  telegramUserId: number,
  selectedOptionIds: number[],
): Promise<{ session: QuizSession | null; changed: boolean }> {
  if (!env.DB) return { session: null, changed: false };
  await ensureAnalyticsSchema(env);
  const existing = await getQuizSession(env, pollId);
  if (!existing || existing.telegramUserId !== telegramUserId || existing.answeredAt !== null) {
    return { session: existing, changed: false };
  }
  const normalize = (values: number[]) => [...values].sort((a, b) => a - b);
  const correct = normalize(existing.correctOptionIds);
  const selected = normalize(selectedOptionIds);
  const isCorrect = correct.length === selected.length && correct.every((value, index) => value === selected[index]);
  const answeredAt = Date.now();

  const result = await env.DB.prepare(
    `UPDATE quiz_sessions
     SET answered_at=?, selected_option_ids_json=?, result=?
     WHERE poll_id=? AND telegram_user_id=? AND answered_at IS NULL`
  ).bind(answeredAt, JSON.stringify(selected), isCorrect ? "correct" : "incorrect", pollId, telegramUserId).run();

  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
    return { session: await getQuizSession(env, pollId), changed: false };
  }
  return { session: { ...existing, answeredAt, selectedOptionIds: selected, result: isCorrect ? "correct" : "incorrect" }, changed: true };
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item ?? "")).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function parseJsonNumberArray(value: unknown): number[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => Number.isSafeInteger(item)).map(Number).slice(0, 12) : [];
  } catch {
    return [];
  }
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
  await env.DB.prepare(`DELETE FROM quiz_sessions WHERE created_at < ?`).bind(cutoff).run();
}

export function getAnalyticsConfig(env: Env): { retentionDays: number } {
  const value = Number.parseInt(env.ANALYTICS_RAW_RETENTION_DAYS ?? "30", 10);
  return { retentionDays: Number.isFinite(value) && value > 0 ? value : 30 };
}

function splitSchemaStatements(): string[] {
  return SCHEMA_SQL.split(";").map((statement) => statement.trim()).filter(Boolean).map((statement) => `${statement};`);
}
