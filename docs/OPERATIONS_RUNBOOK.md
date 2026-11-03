# Operations Runbook

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

## Add another book to Fatman

Use the administrator-only **Book library** page at `/admin/fatman/books` (also linked from `/admin`).

1. Select the PDF. The page reads the page count and calculates a SHA-256 fingerprint in the browser; the title is prefilled from the file name and can be edited.
2. Confirm the notice that Google Cloud Vision OCR may incur usage charges, then choose **Add book to Fatman**.
3. Keep the page open until the secure upload finishes. After that, OCR, chunked indexing, recovery and retrieval verification run in Cloudflare Workflows.
4. The Book library shows each title, page count, indexed-page progress and current status. Use **View** to inspect an in-progress job. Use **Resume** for a completed upload whose OCR/indexing needs recovery.
5. If the browser closes during file transfer, select the same PDF again. Its fingerprint lets the resumable uploader continue the existing transfer or start a fresh one if the session expired.

Additional books use unique `fatman/books/{bookId}/pages/page-000001.txt` keys in the existing Fatman AI Search instance. They do not overwrite the original `fatman/pages/` entries or change the original reviewed 538-page import/release gate. Only books whose page indexing and retrieval checks pass are exposed to Fatman answers.

The legacy `/admin/fatman` importer and `/admin/fatman/monitor` remain available for the original reviewed PDF. Do not give administrators GCP credentials or bucket access to use the Book library; missing service configuration must be handled by an infrastructure administrator.
