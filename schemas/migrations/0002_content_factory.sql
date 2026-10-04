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

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_batches_source_sha256
  ON content_batches(source_sha256);

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

  FOREIGN KEY (batch_id)
    REFERENCES content_batches(id)
    ON DELETE CASCADE
);

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
