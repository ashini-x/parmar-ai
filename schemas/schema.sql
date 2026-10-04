CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

  correct_option TEXT NOT NULL,

  explanation TEXT,

  source TEXT,

  is_active INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,

  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,

  score INTEGER,
  total_questions INTEGER NOT NULL,

  time_taken_seconds INTEGER,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS attempt_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,

  position INTEGER NOT NULL,

  selected_option TEXT,
  answered_at TEXT,

  FOREIGN KEY (attempt_id)
    REFERENCES attempts(id),

  FOREIGN KEY (question_id)
    REFERENCES questions(id),

  UNIQUE (attempt_id, position),
  UNIQUE (attempt_id, question_id)
);
