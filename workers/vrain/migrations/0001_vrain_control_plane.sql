PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vrain_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vrain_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'und',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vrain_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  expected_size INTEGER NOT NULL,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  gcs_object TEXT NOT NULL UNIQUE,
  gcs_upload_uri TEXT,
  page_count INTEGER NOT NULL,
  indexed_pages INTEGER NOT NULL DEFAULT 0,
  collection_id TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'und',
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading','uploaded','processing','waiting_retry','qa_failed','ready','failed','archived')),
  vision_operation TEXT,
  vision_output_prefix TEXT,
  ocr_repair_attempts INTEGER NOT NULL DEFAULT 0,
  workflow_instance_id TEXT,
  error_code TEXT,
  error_message TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES vrain_collections(id)
);

CREATE INDEX IF NOT EXISTS idx_vrain_documents_status_updated
  ON vrain_documents(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_vrain_documents_fingerprint
  ON vrain_documents(source_sha256, expected_size);
CREATE INDEX IF NOT EXISTS idx_vrain_documents_collection
  ON vrain_documents(collection_id, status);

CREATE TABLE IF NOT EXISTS vrain_project_documents (
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, document_id),
  FOREIGN KEY (project_id) REFERENCES vrain_projects(id),
  FOREIGN KEY (document_id) REFERENCES vrain_documents(id)
);

CREATE TABLE IF NOT EXISTS vrain_project_collections (
  project_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, collection_id),
  FOREIGN KEY (project_id) REFERENCES vrain_projects(id),
  FOREIGN KEY (collection_id) REFERENCES vrain_collections(id)
);

CREATE TABLE IF NOT EXISTS vrain_api_keys (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  expires_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES vrain_projects(id)
);
CREATE INDEX IF NOT EXISTS idx_vrain_api_keys_project_status
  ON vrain_api_keys(project_id, status);

CREATE TABLE IF NOT EXISTS vrain_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  state TEXT NOT NULL,
  stage TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  workflow_instance_id TEXT,
  last_heartbeat_at INTEGER NOT NULL,
  next_retry_at INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (document_id) REFERENCES vrain_documents(id)
);
CREATE INDEX IF NOT EXISTS idx_vrain_jobs_state_retry
  ON vrain_jobs(state, next_retry_at, last_heartbeat_at);

CREATE TABLE IF NOT EXISTS vrain_activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  document_id TEXT,
  project_id TEXT,
  specialist TEXT NOT NULL,
  stage TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES vrain_documents(id)
);
CREATE INDEX IF NOT EXISTS idx_vrain_activity_events_document
  ON vrain_activity_events(document_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_vrain_activity_events_created
  ON vrain_activity_events(created_at DESC);

CREATE TABLE IF NOT EXISTS vrain_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vrain_audit_log_created
  ON vrain_audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS vrain_schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO vrain_schema_version(version, applied_at)
VALUES (1, CAST(unixepoch('subsec') * 1000 AS INTEGER));
INSERT OR IGNORE INTO vrain_collections(id,name,description,language,status,created_at,updated_at)
VALUES ('general','General knowledge','Default collection for documents awaiting explicit project grants.','und','active',CAST(unixepoch('subsec') * 1000 AS INTEGER),CAST(unixepoch('subsec') * 1000 AS INTEGER));
