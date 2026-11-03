# Fatman autonomous indexing supervisor

The Fatman import is coordinated by the `FatmanImportWorkflow` Cloudflare Workflow. It is a deterministic workflow supervisor with separate task roles, not a set of unconstrained language-model agents.

## Roles

- **Coordinator / auditor** — enumerates the full AI Search item set, identifies completed, running, queued, failed and missing PDF pages, and dispatches the next work.
- **Page indexer** — reads a page's existing Google Vision OCR JSON from private GCS and indexes the text as one `.txt` AI Search item.
- **Recovery worker** — retries transient AI Search connectivity, rate-limit and server errors with exponential delays (30 seconds, 1, 2, 4, 8 and then 15 minutes). At the capped delay it keeps checking until service recovers.
- **Completeness verifier** — scans all 538 pages, repairs gaps in batches, and hands transient per-page failures to the recovery worker.
- **Retrieval quality verifier** — after every page is complete, tests book-grounded retrieval queries against pages 54, 269 and 485. Book mode is enabled only when each query returns its expected source page.

## Important invariants

- A complete GCS byte count means the PDF transfer is complete even if OCR or indexing later fails.
- AI Search pagination uses `result_info.total_count`; do not rely on `total_pages` being present.
- Old `.jpg` page records are legacy image-indexing records; the current book pipeline indexes OCR text as `.txt`.
- Every child task updates the D1 import record to the newest active workflow instance, so the monitor follows the actual worker/retry task.
- Temporary OCR output is retained until retrieval verification succeeds. Cleanup happens only after activation.
- The admin monitor is read-only. The Workflow owns all import, repair and activation changes.

## Operational checks

Open the protected admin monitor at `/admin/fatman/monitor`. It refreshes the server-derived AI Search state every 10 seconds. The importer remains at `/admin/fatman`.

A complete import is not the same as a completed PDF transfer: readiness requires 538 completed text items, no missing or failed pages, and successful verification of the three expected source pages. Until then, Fatman remains disabled.
