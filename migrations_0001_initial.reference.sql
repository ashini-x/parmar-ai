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
