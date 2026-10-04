CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  exam TEXT NOT NULL,
  tier TEXT,
  year INTEGER,
  shift TEXT,

  subject TEXT NOT NULL,
  topic TEXT,
  difficulty TEXT,

  question_text TEXT NOT NULL,

  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,

  correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  explanation TEXT,
  source TEXT,

  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'hi')),

  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  explanation TEXT,

  translation_status TEXT NOT NULL DEFAULT 'reviewed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  UNIQUE (question_id, language)
);


CREATE TABLE IF NOT EXISTS content_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  source_sha256 TEXT NOT NULL,
  exam TEXT NOT NULL,
  tier TEXT,
  year INTEGER NOT NULL,
  shift TEXT,
  subject TEXT NOT NULL,
  max_questions INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  extracted_count INTEGER NOT NULL DEFAULT 0,
  auto_ready_count INTEGER NOT NULL DEFAULT 0,
  needs_review_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS content_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL,
  source_question_number TEXT,
  exam TEXT NOT NULL,
  tier TEXT,
  year INTEGER NOT NULL,
  shift TEXT,
  subject TEXT NOT NULL,
  topic TEXT,
  difficulty TEXT,
  english_question TEXT,
  english_option_a TEXT,
  english_option_b TEXT,
  english_option_c TEXT,
  english_option_d TEXT,
  english_explanation TEXT,
  hindi_question TEXT,
  hindi_option_a TEXT,
  hindi_option_b TEXT,
  hindi_option_c TEXT,
  hindi_option_d TEXT,
  hindi_explanation TEXT,
  source_correct_option TEXT,
  verified_correct_option TEXT,
  answer_verification TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  ambiguity_note TEXT,
  fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'needs_review',
  duplicate_question_id INTEGER,
  duplicate_candidate_id INTEGER,
  error_message TEXT,
  raw_ai_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES content_batches(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_batches_source_sha256
  ON content_batches(source_sha256);

CREATE INDEX IF NOT EXISTS idx_content_candidates_status
  ON content_candidates(status, id DESC);

CREATE INDEX IF NOT EXISTS idx_content_candidates_batch
  ON content_candidates(batch_id, sequence_no);

CREATE INDEX IF NOT EXISTS idx_content_candidates_fingerprint
  ON content_candidates(fingerprint);


CREATE TABLE IF NOT EXISTS question_fingerprints (
  question_id INTEGER PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_question_fingerprints_fingerprint
  ON question_fingerprints(fingerprint);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  score INTEGER,
  total_questions INTEGER NOT NULL,
  time_taken_seconds INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS attempt_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  selected_option TEXT,
  answered_at TEXT,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id),
  FOREIGN KEY (question_id) REFERENCES questions(id),
  UNIQUE (attempt_id, position),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_questions_subject_active
  ON questions(subject, is_active);

CREATE INDEX IF NOT EXISTS idx_questions_year_subject
  ON questions(year, subject);

CREATE INDEX IF NOT EXISTS idx_question_translations_language
  ON question_translations(language, question_id);

CREATE INDEX IF NOT EXISTS idx_attempts_user
  ON attempts(user_id, started_at);

CREATE INDEX IF NOT EXISTS idx_attempt_questions_attempt
  ON attempt_questions(attempt_id, position);

