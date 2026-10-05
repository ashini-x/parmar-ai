import type { AnswerPacket, Env, StudentProfile } from "../config/env";

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

CREATE INDEX IF NOT EXISTS idx_users_first_seen ON users(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_questions_received ON questions(received_at);
CREATE INDEX IF NOT EXISTS idx_questions_user_received ON questions(telegram_user_id, received_at);
CREATE INDEX IF NOT EXISTS idx_questions_status_received ON questions(status, received_at);
CREATE INDEX IF NOT EXISTS idx_questions_topic_received ON questions(topic, received_at);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(event_at);
CREATE INDEX IF NOT EXISTS idx_events_user_at ON events(telegram_user_id, event_at);
`;

let schemaPromise: Promise<void> | null = null;

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
  status: "completed" | "failed" | "out_of_scope" | "delivery_failed";
  completedAt?: number;
  startedAt?: number;
  latencyMs?: number;
  attempts?: number;
  packet?: AnswerPacket;
  thinkingLevel?: string;
  grounded?: boolean;
  errorMessage?: string;
}

export async function ensureAnalyticsSchema(env: Env): Promise<void> {
  if (!env.DB) return;
  if (!schemaPromise) {
    schemaPromise = env.DB.prepareBatch([
      ...splitSchemaStatements().map((sql) => env.DB!.prepare(sql)),
    ]).then(() => undefined).catch((error) => {
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
    `INSERT OR IGNORE INTO users
      (telegram_user_id, chat_id, username, first_name, last_name, first_seen_at, target_exam, is_bot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.telegramUserId,
    user.chatId,
    user.username ?? null,
    user.firstName ?? null,
    user.lastName ?? null,
    now,
    user.targetExam ?? null,
    user.isBot ? 1 : 0,
  ).run();
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
  ).bind(
    user.telegramUserId,
    user.chatId,
    user.username ?? null,
    user.firstName ?? null,
    user.lastName ?? null,
    Date.now(),
    user.targetExam ?? null,
    user.isBot ? 1 : 0,
  ).run();
}

export async function recordEvent(
  env: Env,
  eventType: string,
  user: AnalyticsUser | null,
  metadata?: Record<string, unknown>,
  now = Date.now(),
): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(
    `INSERT INTO events (telegram_user_id, chat_id, event_type, event_at, metadata_json)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
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
  ).bind(
    item.updateId,
    item.requestId,
    item.user.telegramUserId,
    item.user.chatId,
    item.messageId,
    item.user.username ?? null,
    displayName,
    item.question,
    item.receivedAt,
    item.receivedAt,
  ).run();
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
    result.status,
    result.startedAt ?? null,
    result.completedAt ?? null,
    result.latencyMs ?? null,
    result.attempts ?? 0,
    packet?.topic ?? null,
    packet?.subject ?? null,
    packet?.questionMode ?? null,
    packet?.examRelevance ?? null,
    packet?.difficulty ?? null,
    result.thinkingLevel ?? null,
    packet?.timeSensitive ? 1 : 0,
    result.grounded ? 1 : 0,
    packet?.answer ?? null,
    packet?.sscTakeaway ?? null,
    result.errorMessage?.slice(0, 2_000) ?? null,
    packet?.detectedExam ?? null,
    result.updateId,
  ).run();
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
}

export function getAnalyticsConfig(env: Env): { retentionDays: number } {
  const value = Number.parseInt(env.ANALYTICS_RAW_RETENTION_DAYS ?? "90", 10);
  return { retentionDays: Number.isFinite(value) && value > 0 ? value : 90 };
}

function splitSchemaStatements(): string[] {
  return SCHEMA_SQL.split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}
