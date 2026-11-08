-- Reproducible seed for the isolated parmar-ai-m14-staging D1 database.
-- This registry contains only the single Physics pilot source. Do not copy
-- production student, tenant, conversation, or billing tables into this DB.
CREATE TABLE IF NOT EXISTS m14_source_registry (
  source_id TEXT PRIMARY KEY,
  source_object TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  expected_size INTEGER NOT NULL,
  uploaded_bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  vision_operation TEXT NOT NULL,
  indexed_pages INTEGER NOT NULL,
  book_id TEXT NOT NULL,
  book_title TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO m14_source_registry (
  source_id,
  source_object,
  source_sha256,
  expected_size,
  uploaded_bytes,
  status,
  vision_operation,
  indexed_pages,
  book_id,
  book_title,
  page_count,
  created_at,
  updated_at
) VALUES (
  '01238b3a-9902-4a42-90b4-574048ee4f00',
  'brvin/source-pdfs/01238b3a-9902-4a42-90b4-574048ee4f00/source.pdf',
  '062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c',
  77384,
  77384,
  'completed',
  'projects/project-90db7be4-619f-4ed7-89b/operations/342f72f46451ffd2',
  3,
  '01238b3a-9902-4a42-90b4-574048ee4f00',
  'Force and Laws of Motion - Class IX pilot handout',
  3,
  1794089075135,
  1794089254132
)
ON CONFLICT(source_id) DO UPDATE SET
  source_object = excluded.source_object,
  source_sha256 = excluded.source_sha256,
  expected_size = excluded.expected_size,
  uploaded_bytes = excluded.uploaded_bytes,
  status = excluded.status,
  vision_operation = excluded.vision_operation,
  indexed_pages = excluded.indexed_pages,
  book_id = excluded.book_id,
  book_title = excluded.book_title,
  page_count = excluded.page_count,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
