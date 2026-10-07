-- Reference schema. The Worker auto-initializes this schema on the first authenticated
-- admin/analytics request, so dashboard-only deployment does not require a CLI migration.
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
