-- Existing database migration for SawalNewton V1.1.
-- Run this ONCE against the existing sawalnewton-db.

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

CREATE INDEX IF NOT EXISTS idx_question_translations_language
  ON question_translations(language, question_id);
