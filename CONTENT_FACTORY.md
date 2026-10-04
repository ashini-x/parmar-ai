# What this update adds

## Admin
`/admin/content`

## APIs
`GET /api/admin/content/candidates`
`GET /api/admin/content/batches`
`POST /api/admin/content/ingest`
`POST /api/admin/content/approve`

## AI pipeline
PDF/TXT/CSV
→ Gemini structured extraction
→ English + Hindi
→ topic + difficulty
→ source answer vs independent answer check
→ deterministic fingerprint
→ duplicate check
→ staging queue
→ publish to D1

## Database
New tables:
- `content_batches`
- `content_candidates`

New field:
- `question_fingerprints`

## Limits in this V1.2 factory
- PDF/TXT/CSV only
- 12 MB upload limit
- max 25 questions per AI run
- one source processed at a time

This is intentional for the first production-safe content pipeline. A later phase can move ingestion to R2/Queues for very large multi-paper backfills.
