# Operations Runbook

## First-contact `/start` latency
- The `/start` welcome text is intentionally unchanged.
- Webhook authentication provisions only the dedicated `telegram_bots` table/index; it must not trigger the full analytics/BRVIN schema initializer.
- First-seen and `/start` analytics writes run after the welcome has been delivered. Command-menu sync and Google OAuth token prefetch remain background preparation.
- Use `telegram_webhook_authenticated.authenticationMs` and `telegram_start_welcome_delivery.deliveryMs` in Worker logs to separate authentication/D1 latency from Telegram's outbound message latency.
- Do not move full analytics migrations, BRVIN readiness checks, Gemini generation, or command-menu sync back in front of the welcome.

## First checks
1. Confirm Worker configuration.
2. Confirm Queue consumer and Durable Object.
3. Send one SSC question.
4. Confirm typing starts and stops.
5. Confirm answer delivery.
6. Confirm `/admin` analytics update.
7. Test Telegram connection from the dashboard.

## Telegram not responding
Check dashboard bot status, webhook info, Worker logs, Queue consumer, recent question-processing events, and Telegram delivery errors.

## Typing remains active
Inspect Queue retries, Durable Object leases/recovery, AI timeouts, and Telegram delivery failures. Typing must be bounded by recovery logic.

## Dashboard not interactive
Check the deployed revision, browser console, and generated dashboard JavaScript. Redeploy the exact verified revision if necessary.

## Student access action failure
For Grant/Revoke/Suspend/Unsuspend, verify admin session, same-origin request, `/admin/api/action` response, D1 state, and dashboard refresh. These mutations are server-side and verified.

## Telegram Test connection
The test action must not require a student Telegram ID. It should call Telegram `getMe` and `getWebhookInfo`. An `invalid_user_id` response indicates a regression in generic admin-action validation.

## Queue backlog
Check consumer health, retries, DLQ, Durable Object alarms, AI provider timeouts, and Telegram delivery. Do not delete state blindly.

## Secret rotation
Rotate at the provider, update Cloudflare, and validate the affected integration.

## Rollback
Use the last verified Cloudflare version. Do not treat an ad-hoc edited working directory as a rollback artifact.

## BRVIN knowledge operations

For the complete current administrator workflow, see [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md). For detailed engineering/operator troubleshooting, see [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md).

Use the administrator-only **BRVIN** console at `/admin/brvin` (also linked from `/admin`). The former `/admin/fatman/books` address redirects to BRVIN.

### Add a knowledge source
1. Enter a source title and choose a collection. The title defaults from the PDF filename if left blank.
2. Optionally select one or more projects to grant direct access. Leaving the selection empty does not grant the book to any project.
3. Choose the PDF. The browser validates the PDF header, calculates its SHA-256 fingerprint and reads its page count. Current upload guardrails are 1 GB and 2,000 pages per PDF.
4. Confirm the Google Cloud Vision OCR cost notice and start the secure resumable upload.
5. Keep the page open until transfer completes. OCR, indexing, recovery and retrieval QA continue in Cloudflare Workflows after the transfer is complete.

### Observe live specialist work
The right-hand BRVIN operations console refreshes every five seconds from the D1 event ledger. It shows real workflow events (not simulated agent activity): secure upload milestones, Vision OCR submission/completion, page-index progress and repairs, retrieval QA, recovery and readiness. Open **Operations** for a book to inspect its per-import event history and live Vision/Workflow status. The books list shows the registry status and indexed/expected pages.

### Manage project knowledge boundaries
- A collection organises sources but does not make them globally searchable.
- Assign a collection to a project to grant that project access to every verified book in that collection.
- Direct book grants can be managed independently for exceptions.
- Access is additive: a project can see a book through a direct book grant or through a collection grant.
- A newly created project has no book access until an administrator assigns sources.
- Fatman is pre-registered as a BRVIN project. Its existing reviewed 538-page source and the previously managed Fatman reference books are migrated into its grants. Newly uploaded documents are not automatically added to Fatman's knowledge unless selected or added to one of Fatman's assigned collections.

### Recovery and failure handling
If the browser closes during transfer, select the same PDF again so the fingerprint can resume the secure upload or start a fresh transfer if the GCS session expired. If the upload completed but indexing failed, use **Resume** from the job's operations controls when the saved Vision OCR result is available. If retrieval QA fails, the book remains unavailable to project retrieval until it passes.

Do not give administrators GCP credentials or direct bucket access. Do not mark a source ready manually or bypass its retrieval verification. The BRVIN console and APIs require the existing admin session; mutating API requests enforce same-origin CSRF checks. The shared D1 registry is migrated idempotently when analytics schema initialization runs.

The legacy `/admin/fatman` importer and `/admin/fatman/monitor` remain for the original reviewed Fatman PDF. They do not become the generic BRVIN ingestion surface.
