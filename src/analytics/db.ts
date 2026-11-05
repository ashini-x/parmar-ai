import type { AiUsageRecord, AnswerPacket, Env, StudentProfile } from "../config/env";
import { ensureBrvin2ApplicationIdentities, ensureBrvin2AskMoinaIdentities } from "../brvin/identity-migration";

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

CREATE TABLE IF NOT EXISTS fatman_book_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  document_version TEXT NOT NULL DEFAULT '',
  indexed_pages INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO fatman_book_state (singleton_id, enabled, document_version, indexed_pages, updated_at)
VALUES (1, 0, '', 0, 0);

CREATE TABLE IF NOT EXISTS fatman_search_usage (
  billing_month TEXT PRIMARY KEY,
  query_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fatman_import_jobs (
  id TEXT PRIMARY KEY,
  source_object TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  expected_size INTEGER NOT NULL,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  upload_session_uri TEXT,
  status TEXT NOT NULL,
  vision_operation TEXT,
  workflow_instance_id TEXT,
  indexed_pages INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  book_id TEXT,
  book_title TEXT,
  page_count INTEGER NOT NULL DEFAULT 538
);

CREATE INDEX IF NOT EXISTS idx_fatman_import_jobs_hash_created
  ON fatman_import_jobs(source_sha256, expected_size, created_at);

CREATE TABLE IF NOT EXISTS fatman_books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  expected_size INTEGER NOT NULL,
  page_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  indexed_pages INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fatman_books_status_updated
  ON fatman_books(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_fatman_books_fingerprint
  ON fatman_books(source_sha256, expected_size, created_at);

CREATE TABLE IF NOT EXISTS fatman_release_qa_runs (
  run_id TEXT PRIMARY KEY,
  document_version TEXT NOT NULL,
  suite_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','passed','failed')),
  total_cases INTEGER NOT NULL DEFAULT 0,
  passed_cases INTEGER NOT NULL DEFAULT 0,
  failed_cases INTEGER NOT NULL DEFAULT 0,
  query_count INTEGER NOT NULL DEFAULT 0,
  generation_attempts INTEGER NOT NULL DEFAULT 0,
  estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
  results_json TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_fatman_release_qa_runs_completed
  ON fatman_release_qa_runs(document_version, completed_at DESC);


CREATE TABLE IF NOT EXISTS brvin_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS brvin_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  owner_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brvin_projects_status
  ON brvin_projects(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS brvin_applications (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  slug TEXT NOT NULL UNIQUE CHECK (
    length(slug) BETWEEN 1 AND 64
    AND slug = lower(slug)
    AND slug GLOB '[a-z0-9]*'
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND substr(slug, -1, 1) GLOB '[a-z0-9]'
  ),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_label TEXT NOT NULL DEFAULT '',
  repository_url TEXT NOT NULL DEFAULT '',
  repository_default_branch TEXT NOT NULL DEFAULT 'main',
  runtime_provider TEXT NOT NULL DEFAULT 'cloudflare-workers',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brvin_applications_status
  ON brvin_applications(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS brvin_application_environments (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  application_id TEXT NOT NULL
    REFERENCES brvin_applications(id) ON DELETE RESTRICT,
  environment_key TEXT NOT NULL CHECK (
    length(environment_key) BETWEEN 1 AND 32
    AND environment_key = lower(environment_key)
    AND environment_key GLOB '[a-z0-9]*'
    AND environment_key NOT GLOB '*[^a-z0-9-]*'
    AND substr(environment_key, -1, 1) GLOB '[a-z0-9]'
  ),
  display_name TEXT NOT NULL DEFAULT '',
  worker_name TEXT NOT NULL DEFAULT '',
  worker_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_brvin_app_env_application_status
  ON brvin_application_environments(application_id, status, environment_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brvin_app_env_one_active_key
  ON brvin_application_environments(application_id, environment_key)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS brvin_connection_checks (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  environment_id TEXT NOT NULL REFERENCES brvin_application_environments(id) ON DELETE RESTRICT,
  nonce_hash TEXT NOT NULL CHECK (length(nonce_hash) = 64),
  proof_hash TEXT CHECK (proof_hash IS NULL OR length(proof_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('pending', 'proof_issued', 'connected', 'failed', 'expired')),
  ready INTEGER CHECK (ready IS NULL OR ready IN (0, 1)),
  authorized_source_count INTEGER CHECK (authorized_source_count IS NULL OR authorized_source_count >= 0),
  failure_code TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_brvin_connection_checks_environment_created
  ON brvin_connection_checks(environment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brvin_connection_checks_expiry
  ON brvin_connection_checks(status, expires_at);

CREATE TABLE IF NOT EXISTS brvin_application_project_grants (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  application_id TEXT NOT NULL
    REFERENCES brvin_applications(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL
    REFERENCES brvin_projects(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  revoked_at INTEGER,
  revoked_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_brvin_app_project_grants_project_status
  ON brvin_application_project_grants(project_id, status, application_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brvin_app_project_one_active_grant
  ON brvin_application_project_grants(application_id, project_id)
  WHERE status = 'active';


CREATE TABLE IF NOT EXISTS brvin_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brvin_collections_status
  ON brvin_collections(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS brvin_books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL DEFAULT '',
  expected_size INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  indexed_pages INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  collection_id TEXT NOT NULL DEFAULT 'general',
  search_prefix TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'pdf',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brvin_books_collection
  ON brvin_books(collection_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_brvin_books_status
  ON brvin_books(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_brvin_books_fingerprint
  ON brvin_books(source_sha256, expected_size, created_at);

CREATE TABLE IF NOT EXISTS brvin_project_books (
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  PRIMARY KEY(project_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_brvin_project_books_book
  ON brvin_project_books(book_id, project_id);

CREATE TABLE IF NOT EXISTS brvin_project_collections (
  project_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  PRIMARY KEY(project_id, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_brvin_project_collections_collection
  ON brvin_project_collections(collection_id, project_id);

CREATE TABLE IF NOT EXISTS brvin_service_clients (
  client_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brvin_service_clients_project
  ON brvin_service_clients(project_id, client_id);

CREATE TABLE IF NOT EXISTS brvin_project_search_usage (
  project_id TEXT NOT NULL,
  billing_month TEXT NOT NULL,
  query_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(project_id, billing_month)
);

CREATE TABLE IF NOT EXISTS brvin_activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id TEXT,
  book_id TEXT,
  project_id TEXT,
  agent TEXT NOT NULL,
  phase TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brvin_activity_created
  ON brvin_activity_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brvin_activity_import
  ON brvin_activity_events(import_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_brvin_activity_book
  ON brvin_activity_events(book_id, id DESC);

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

CREATE TABLE IF NOT EXISTS brvin_provider_connections (
  provider TEXT PRIMARY KEY CHECK (provider IN ('github','cloudflare')),
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  secret_ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS brvin_oauth_states (
  state_hash TEXT PRIMARY KEY CHECK (length(state_hash)=64),
  provider TEXT NOT NULL CHECK (provider IN ('github','cloudflare')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brvin_oauth_states_expiry
  ON brvin_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS brvin_connection_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brvin_connection_events_created
  ON brvin_connection_events(created_at DESC);

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

export const BRVIN_OWNER_METADATA_MIGRATION_KEY = "2026-11-05-brvin-owner-label-v1";

/**
 * Add teacher/owner display metadata to existing BRVIN projects and applications.
 * This is descriptive admin metadata only; it is not an authorization boundary.
 * The checks make the migration safe for databases created before these columns
 * existed, and the read-back handles concurrent Worker isolates racing the ALTER.
 */
export async function ensureBrvinOwnerMetadataSchema(db: D1Database): Promise<void> {
  const ensureColumn = async (table: "brvin_projects" | "brvin_applications"): Promise<void> => {
    const readColumns = async () => db.prepare("PRAGMA table_info(" + table + ")")
      .all<{ name: string }>();
    const before = await readColumns();
    if ((before.results ?? []).some(column => column.name === "owner_label")) return;
    try {
      await db.prepare("ALTER TABLE " + table + " ADD COLUMN owner_label TEXT NOT NULL DEFAULT ''").run();
    } catch (error) {
      const after = await readColumns();
      if (!(after.results ?? []).some(column => column.name === "owner_label")) throw error;
    }
  };

  await ensureColumn("brvin_projects");
  await ensureColumn("brvin_applications");
  await db.prepare(
    "INSERT OR IGNORE INTO brvin_migrations (migration_key,applied_at) VALUES (?,?)"
  ).bind(BRVIN_OWNER_METADATA_MIGRATION_KEY, Date.now()).run();
}

export const BRVIN_CONNECTION_METADATA_MIGRATION_KEY = "2026-11-05-brvin-connection-metadata-v1";

/**
 * Store non-secret application integration references only. These values do not
 * authorize GitHub access or prove that a Cloudflare Worker is connected.
 */
export async function ensureBrvinConnectionMetadataSchema(db: D1Database): Promise<void> {
  const ensureColumn = async (
    table: "brvin_applications" | "brvin_application_environments",
    column: "repository_url" | "repository_default_branch" | "runtime_provider" | "worker_name" | "worker_url",
    definition: string,
  ): Promise<void> => {
    const readColumns = async () => db.prepare("PRAGMA table_info(" + table + ")")
      .all<{ name: string }>();
    const before = await readColumns();
    if ((before.results ?? []).some(item => item.name === column)) return;
    try {
      await db.prepare("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition).run();
    } catch (error) {
      const after = await readColumns();
      if (!(after.results ?? []).some(item => item.name === column)) throw error;
    }
  };

  await ensureColumn("brvin_applications", "repository_url", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("brvin_applications", "repository_default_branch", "TEXT NOT NULL DEFAULT 'main'");
  await ensureColumn("brvin_applications", "runtime_provider", "TEXT NOT NULL DEFAULT 'cloudflare-workers'");
  await ensureColumn("brvin_application_environments", "worker_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("brvin_application_environments", "worker_url", "TEXT NOT NULL DEFAULT ''");
  await db.prepare(
    "INSERT OR IGNORE INTO brvin_migrations (migration_key,applied_at) VALUES (?,?)"
  ).bind(BRVIN_CONNECTION_METADATA_MIGRATION_KEY, Date.now()).run();
}

async function ensureFatmanImportJobSchema(env: Env): Promise<void> {
  if (!env.DB) return;
  // Existing installations have the single-book import table already. Add the
  // optional metadata in place so the original 538-page import remains valid.
  const columns = await env.DB.prepare("SELECT name FROM pragma_table_info('fatman_import_jobs')").all<{ name: string }>();
  const names = new Set((columns.results ?? []).map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["book_id", "TEXT"],
    ["book_title", "TEXT"],
    ["page_count", "INTEGER NOT NULL DEFAULT 538"],
  ];
  for (const [name, definition] of additions) {
    if (!names.has(name)) {
      await env.DB.prepare("ALTER TABLE fatman_import_jobs ADD COLUMN " + name + " " + definition).run();
    }
  }
}



const BRVIN_LEGACY_TABLE_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["vrain_migrations", "brvin_migrations"],
  ["vrain_projects", "brvin_projects"],
  ["vrain_collections", "brvin_collections"],
  ["vrain_books", "brvin_books"],
  ["vrain_project_books", "brvin_project_books"],
  ["vrain_project_collections", "brvin_project_collections"],
  ["vrain_activity_events", "brvin_activity_events"],
];

const BRVIN_LEGACY_INDEX_NAMES = [
  "idx_vrain_projects_status",
  "idx_vrain_collections_status",
  "idx_vrain_books_collection",
  "idx_vrain_books_status",
  "idx_vrain_books_fingerprint",
  "idx_vrain_project_books_book",
  "idx_vrain_project_collections_collection",
  "idx_vrain_activity_created",
  "idx_vrain_activity_import",
  "idx_vrain_activity_book",
] as const;

/** Rename the original knowledge registry in place; existing grants, events and book rows are retained. */
async function migrateLegacyBrvinTables(env: Env): Promise<void> {
  if (!env.DB) return;
  const db = env.DB;
  const readTables = async () => {
    const result = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
    return new Set((result.results ?? []).map((row) => row.name));
  };
  const names = await readTables();

  for (const [legacyName, brvinName] of BRVIN_LEGACY_TABLE_RENAMES) {
    if (names.has(legacyName) && names.has(brvinName)) {
      throw new Error("Both legacy and BRVIN registry tables exist for " + legacyName + "; refusing an unsafe merge.");
    }
    if (names.has(legacyName)) {
      try {
        await db.prepare("ALTER TABLE " + legacyName + " RENAME TO " + brvinName).run();
      } catch (error) {
        // Another Worker isolate may have completed the same idempotent rename concurrently.
        const refreshed = await readTables();
        if (refreshed.has(legacyName) || !refreshed.has(brvinName)) throw error;
      }
      names.delete(legacyName);
      names.add(brvinName);
    }
  }

  await db.batch(BRVIN_LEGACY_INDEX_NAMES.map((name) => db.prepare("DROP INDEX IF EXISTS " + name)));
}

async function ensureBrvinCompatibilitySchema(env: Env): Promise<void> {
  if (!env.DB) return;
  const db = env.DB;
  const now = Date.now();

  // Carry forward the previous migration marker without re-importing existing books.
  await db.prepare(
    "INSERT OR IGNORE INTO brvin_migrations (migration_key, applied_at) SELECT ?, applied_at FROM brvin_migrations WHERE migration_key = ?"
  ).bind("2026-11-03-fatman-books-to-brvin-v1", "2026-11-03-fatman-books-to-vrain-v1").run();
  await db.prepare("DELETE FROM brvin_migrations WHERE migration_key = ?")
    .bind("2026-11-03-fatman-books-to-vrain-v1").run();
  await db.prepare("UPDATE brvin_projects SET description = REPLACE(description, 'VRAIN', 'BRVIN') WHERE description LIKE '%VRAIN%'").run();

  await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO brvin_collections (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)"
    ).bind("general", "General Knowledge", "Shared reference material that can be assigned to selected projects.", now, now),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_collections (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)"
    ).bind("fatman-core", "Fatman Core", "The original reviewed Fatman reference volume.", now, now),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_projects (id, name, slug, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
    ).bind("fatman", "Fatman", "fatman", "SSC learning assistant. Access is limited to explicitly assigned BRVIN knowledge.", now, now),
  ]);

  // Records whether Vision OCR JSON was explicitly removed while the
  // original PDF and indexed page set remain available.
  const bookColumns = await db.prepare("PRAGMA table_info(brvin_books)").all<{ name: string }>();
  if (!(bookColumns.results ?? []).some(column => column.name === "vision_output_deleted_at")) {
    await db.prepare("ALTER TABLE brvin_books ADD COLUMN vision_output_deleted_at INTEGER").run();
  }
  if (!(bookColumns.results ?? []).some(column => column.name === "vision_output_deletion_started_at")) {
    await db.prepare("ALTER TABLE brvin_books ADD COLUMN vision_output_deletion_started_at INTEGER").run();
  }
  await db.prepare(
    "INSERT OR IGNORE INTO brvin_migrations (migration_key, applied_at) VALUES (?, ?)"
  ).bind("2026-11-04-brvin-vision-output-deleted-at-v1", Date.now()).run();

  const migration = await db.prepare(
    "SELECT migration_key FROM brvin_migrations WHERE migration_key = ?"
  ).bind("2026-11-03-fatman-books-to-brvin-v1").first<{ migration_key: string }>();

  if (!migration) {
    await db.prepare(
      "INSERT OR IGNORE INTO brvin_books (id, title, source_filename, source_sha256, expected_size, page_count, status, indexed_pages, error_message, collection_id, search_prefix, source_type, created_at, updated_at) " +
      "SELECT id, title, source_filename, source_sha256, expected_size, page_count, status, indexed_pages, error_message, 'general', 'fatman/books/' || id || '/pages/', 'pdf', created_at, updated_at FROM fatman_books"
    ).run();

    await db.prepare(
      "INSERT OR IGNORE INTO brvin_books (id, title, source_filename, source_sha256, expected_size, page_count, status, indexed_pages, collection_id, search_prefix, source_type, created_at, updated_at) " +
      "SELECT 'fatman-legacy-538', 'Fatman 2nd Edition', 'Built-in reviewed Fatman PDF', '', 0, 538, " +
      "CASE WHEN enabled = 1 AND indexed_pages = 538 THEN 'ready' ELSE 'needs_review' END, indexed_pages, " +
      "'fatman-core', 'fatman/pages/', 'legacy', updated_at, updated_at FROM fatman_book_state WHERE singleton_id = 1"
    ).run();

    await db.batch([
      db.prepare(
        "INSERT OR IGNORE INTO brvin_project_books (project_id, book_id, created_at, created_by) " +
        "SELECT 'fatman', id, created_at, 'migration' FROM brvin_books WHERE source_type = 'pdf'"
      ),
      db.prepare(
        "INSERT OR IGNORE INTO brvin_project_books (project_id, book_id, created_at, created_by) VALUES ('fatman', 'fatman-legacy-538', ?, 'migration')"
      ).bind(now),
      db.prepare(
        "INSERT OR IGNORE INTO brvin_project_collections (project_id, collection_id, created_at, created_by) VALUES ('fatman', 'fatman-core', ?, 'migration')"
      ).bind(now),
      db.prepare(
        "INSERT OR IGNORE INTO brvin_migrations (migration_key, applied_at) VALUES (?, ?)"
      ).bind("2026-11-03-fatman-books-to-brvin-v1", now),
    ]);
  }

  // Each project slug is its default trusted Worker client identity. A Service
  // Binding supplies this identity through ctx.props; request payloads cannot.
  await db.prepare(
    "INSERT OR IGNORE INTO brvin_service_clients (client_id,project_id,created_at,updated_at) " +
    "SELECT slug,id,created_at,updated_at FROM brvin_projects"
  ).run();
}

export async function ensureAnalyticsSchema(env: Env): Promise<void> {
  if (!env.DB) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await migrateLegacyBrvinTables(env);
      await env.DB!.batch(splitSchemaStatements().map((sql) => env.DB!.prepare(sql)));
      await ensureQuizSessionSchema(env);
      await ensureFatmanImportJobSchema(env);
      await ensureBrvinCompatibilitySchema(env);
      await ensureBrvinOwnerMetadataSchema(env.DB!);
      await ensureBrvinConnectionMetadataSchema(env.DB!);
      await ensureBrvin2ApplicationIdentities(env.DB!);
      await ensureBrvin2AskMoinaIdentities(env.DB!);
    })()
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  await schemaPromise;
}

export interface FatmanBookState {
  enabled: boolean;
  documentVersion: string;
  indexedPages: number;
  updatedAt: number;
}

export async function getFatmanBookState(env: Env): Promise<FatmanBookState> {
  if (!env.DB) return { enabled: false, documentVersion: "", indexedPages: 0, updatedAt: 0 };
  await ensureAnalyticsSchema(env);
  const row = await env.DB.prepare(
    "SELECT enabled, document_version, indexed_pages, updated_at FROM fatman_book_state WHERE singleton_id = 1"
  ).first<{ enabled: number; document_version: string; indexed_pages: number; updated_at: number }>();
  return {
    enabled: row?.enabled === 1,
    documentVersion: row?.document_version ?? "",
    indexedPages: Number(row?.indexed_pages ?? 0),
    updatedAt: Number(row?.updated_at ?? 0),
  };
}

export async function setFatmanBookState(
  env: Env,
  state: { enabled: boolean; documentVersion: string; indexedPages: number },
): Promise<void> {
  if (!env.DB) throw new Error("The analytics database is not configured.");
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(
    "UPDATE fatman_book_state SET enabled = ?, document_version = ?, indexed_pages = ?, updated_at = ? WHERE singleton_id = 1"
  ).bind(state.enabled ? 1 : 0, state.documentVersion, state.indexedPages, Date.now()).run();
  await env.DB.prepare(
    "UPDATE brvin_books SET status = ?, indexed_pages = ?, updated_at = ? WHERE id = 'fatman-legacy-538'"
  ).bind(state.enabled && state.indexedPages === 538 ? "ready" : "needs_review", state.indexedPages, Date.now()).run();
}

export interface FatmanReleaseQaRunSummary {
  runId: string;
  documentVersion: string;
  suiteVersion: string;
  status: "running" | "passed" | "failed";
  totalCases: number;
  passedCases: number;
  failedCases: number;
  queryCount: number;
  generationAttempts: number;
  estimatedCostMicrousd: number;
  results: unknown[];
  startedAt: number;
  completedAt: number | null;
}

export async function recordFatmanReleaseQaRunStarted(
  env: Env,
  runId: string,
  documentVersion: string,
  suiteVersion: string,
  startedAt = Date.now(),
): Promise<void> {
  if (!env.DB) throw new Error("D1 is required to store Fatman release QA status.");
  await ensureAnalyticsSchema(env);
  const result = await env.DB.prepare(
    "INSERT INTO fatman_release_qa_runs (run_id, document_version, suite_version, status, total_cases, passed_cases, failed_cases, query_count, generation_attempts, estimated_cost_microusd, results_json, started_at, completed_at) " +
    "VALUES (?, ?, ?, 'running', 0, 0, 0, 0, 0, 0, '[]', ?, NULL) " +
    "ON CONFLICT(run_id) DO UPDATE SET status='running', results_json='[]', completed_at=NULL, started_at=excluded.started_at"
  ).bind(runId, documentVersion, suiteVersion, startedAt).run();
  if (!result.success) throw new Error("D1 did not confirm the Fatman release QA start.");
}

export async function recordFatmanReleaseQaRun(
  env: Env,
  report: {
    runId: string;
    documentVersion: string;
    suiteVersion: string;
    status: "passed" | "failed";
    totalCases: number;
    passedCases: number;
    failedCases: number;
    queryCount: number;
    generationAttempts: number;
    estimatedCostMicrousd: number;
    results: unknown[];
    startedAt: number;
    completedAt: number;
  },
): Promise<void> {
  if (!env.DB) throw new Error("D1 is required to store Fatman release QA results.");
  await ensureAnalyticsSchema(env);
  const result = await env.DB.prepare(
    "INSERT INTO fatman_release_qa_runs (run_id, document_version, suite_version, status, total_cases, passed_cases, failed_cases, query_count, generation_attempts, estimated_cost_microusd, results_json, started_at, completed_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, total_cases=excluded.total_cases, passed_cases=excluded.passed_cases, failed_cases=excluded.failed_cases, query_count=excluded.query_count, generation_attempts=excluded.generation_attempts, estimated_cost_microusd=excluded.estimated_cost_microusd, results_json=excluded.results_json, completed_at=excluded.completed_at"
  ).bind(
    report.runId,
    report.documentVersion,
    report.suiteVersion,
    report.status,
    report.totalCases,
    report.passedCases,
    report.failedCases,
    report.queryCount,
    report.generationAttempts,
    report.estimatedCostMicrousd,
    JSON.stringify(report.results).slice(0, 48_000),
    report.startedAt,
    report.completedAt,
  ).run();
  if (!result.success) throw new Error("D1 did not confirm the Fatman release QA result write.");
}

export async function getLatestFatmanReleaseQaRun(env: Env): Promise<FatmanReleaseQaRunSummary | null> {
  if (!env.DB) return null;
  await ensureAnalyticsSchema(env);
  const row = await env.DB.prepare(
    "SELECT run_id, document_version, suite_version, status, total_cases, passed_cases, failed_cases, query_count, generation_attempts, estimated_cost_microusd, results_json, started_at, completed_at FROM fatman_release_qa_runs ORDER BY started_at DESC LIMIT 1"
  ).first<{
    run_id: string;
    document_version: string;
    suite_version: string;
    status: "running" | "passed" | "failed";
    total_cases: number;
    passed_cases: number;
    failed_cases: number;
    query_count: number;
    generation_attempts: number;
    estimated_cost_microusd: number;
    results_json: string;
    started_at: number;
    completed_at: number | null;
  }>();
  if (!row) return null;
  let results: unknown[] = [];
  try {
    const parsed = JSON.parse(row.results_json) as unknown;
    if (Array.isArray(parsed)) results = parsed;
  } catch {
    results = [];
  }
  return {
    runId: row.run_id,
    documentVersion: row.document_version,
    suiteVersion: row.suite_version,
    status: row.status,
    totalCases: Number(row.total_cases),
    passedCases: Number(row.passed_cases),
    failedCases: Number(row.failed_cases),
    queryCount: Number(row.query_count),
    generationAttempts: Number(row.generation_attempts),
    estimatedCostMicrousd: Number(row.estimated_cost_microusd),
    results,
    startedAt: Number(row.started_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
  };
}

export async function reserveFatmanSearchQuery(
  env: Env,
  monthlyLimit: number,
  now = Date.now(),
): Promise<{ allowed: boolean; queryCount: number }> {
  if (!env.DB || !Number.isSafeInteger(monthlyLimit) || monthlyLimit < 1) {
    return { allowed: false, queryCount: 0 };
  }
  await ensureAnalyticsSchema(env);
  const month = new Date(now).toISOString().slice(0, 7);
  const reserved = await env.DB.prepare(
    "INSERT INTO fatman_search_usage (billing_month, query_count, updated_at) " +
    "VALUES (?, 1, ?) ON CONFLICT(billing_month) DO UPDATE SET " +
    "query_count = query_count + 1, updated_at = excluded.updated_at " +
    "WHERE query_count < ? RETURNING query_count"
  ).bind(month, now, monthlyLimit).first<{ query_count: number }>();
  if (reserved) return { allowed: true, queryCount: Number(reserved.query_count) };
  const existing = await env.DB.prepare(
    "SELECT query_count FROM fatman_search_usage WHERE billing_month = ?"
  ).bind(month).first<{ query_count: number }>();
  return { allowed: false, queryCount: Number(existing?.query_count ?? monthlyLimit) };
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

export async function deleteQuizSession(env: Env, pollId: string): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  const result = await env.DB.prepare(`DELETE FROM quiz_sessions WHERE poll_id=?`).bind(pollId).run();
  if (!result.success) throw new Error("D1 did not confirm the quiz-session delete.");
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


export interface BrvinActivityInput {
  importId?: string | null;
  bookId?: string | null;
  projectId?: string | null;
  agent: string;
  phase: string;
  eventType: string;
  status?: string;
  message: string;
  details?: Record<string, unknown>;
  createdAt?: number;
}

/** Append-only operation telemetry used by the BRVIN live operations console. */
export async function recordBrvinActivity(env: Env, event: BrvinActivityInput): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  const detailsJson = event.details ? JSON.stringify(event.details) : null;
  const safeDetailsJson = detailsJson && detailsJson.length > 4_000
    ? JSON.stringify({ truncated: true, preview: detailsJson.slice(0, 3_800) })
    : detailsJson;
  await env.DB.prepare(
    "INSERT INTO brvin_activity_events (import_id, book_id, project_id, agent, phase, event_type, status, message, detail_json, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    event.importId ?? null,
    event.bookId ?? null,
    event.projectId ?? null,
    event.agent.slice(0, 80),
    event.phase.slice(0, 80),
    event.eventType.slice(0, 100),
    (event.status ?? "info").slice(0, 32),
    event.message.slice(0, 500),
    safeDetailsJson,
    event.createdAt ?? Date.now(),
  ).run();
}

function splitSchemaStatements(): string[] {
  return SCHEMA_SQL.split(";").map((statement) => statement.trim()).filter(Boolean).map((statement) => `${statement};`);
}
