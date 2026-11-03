# VRAIN Owner Operations Runbook

This runbook is for the single VRAIN owner. Consumer applications must never use owner endpoints or owner credentials.

## 1. Before the first deployment

### Cloudflare resources

Create a new D1 database, separate from Parmar AI:

~~~sh
npx wrangler d1 create vrain-control-plane
~~~

Copy its returned UUID into workers/vrain/wrangler.jsonc under the DB binding. Do not use Parmar AI's current D1 database ID.

Create the Worker resources and verify:
- Worker name: vrain-engine;
- D1 binding: DB;
- AI Search namespace binding: VRAIN_SEARCH, namespace vrain;
- Workflow binding: INGEST_WORKFLOW;
- scheduled trigger: every five minutes.

The Wrangler AI Search namespace binding is what grants the Worker access to its own namespace. See [Cloudflare AI Search Workers binding](https://developers.cloudflare.com/ai-search/api/search/workers-binding/) and [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

### Google Cloud resources

1. Use a dedicated Google Cloud project or a clearly separated service account for VRAIN.
2. Enable the Cloud Vision API.
3. Create a dedicated private GCS bucket.
4. Grant the VRAIN service account bucket-scoped object access sufficient to read the PDF, write Vision output, list/read OCR JSON, and write normalized OCR text. roles/storage.objectAdmin on this dedicated bucket is the straightforward all-object-access role for this implementation.
5. Ensure the principal can call the Vision API and use the project.
6. Do not make the bucket public.
7. Decide the data processing region before uploading restricted documents. The current code targets the global Vision endpoint.

Google's official PDF/TIFF instructions require Cloud Storage input and output for asynchronous file annotation and explain the required bucket permissions: [Vision PDF/TIFF OCR](https://cloud.google.com/vision/docs/pdf).

### Worker secrets and variables

From the repository root:

~~~sh
npx wrangler secret put VRAIN_ADMIN_TOKEN --config workers/vrain/wrangler.jsonc
npx wrangler secret put GCP_CLIENT_EMAIL --config workers/vrain/wrangler.jsonc
npx wrangler secret put GCP_PRIVATE_KEY --config workers/vrain/wrangler.jsonc
npx wrangler secret put GCP_PRIVATE_KEY_ID --config workers/vrain/wrangler.jsonc
~~~

Set in workers/vrain/wrangler.jsonc:
- VRAIN_GCS_BUCKET: actual private bucket name;
- VRAIN_SEARCH_INSTANCE: vrain-knowledge-v1 unless intentionally changed;
- VRAIN_MAX_PDF_BYTES: default 1073741824;
- VRAIN_MAX_PDF_PAGES: default 2000;
- VRAIN_MIN_RETRIEVAL_SCORE: default 0.2.

The config also contains a placeholder D1 UUID. Replace it before running remote migrations or deploying. Never commit service-account JSON or private keys.

## 2. Build, test, and deploy

From the repository root:

~~~sh
npm ci
npm run check:vrain
npm run test:vrain
npm run dry-run:vrain
npm run migrate:vrain:remote
npm run deploy:vrain
~~~

Do not deploy if the type check, test suite, or dry run fails. Confirm the migration command targets the VRAIN D1 binding and not Parmar AI's main database.

Health check:

~~~sh
curl https://<your-vrain-worker-domain>/health
~~~

The response may show whether the D1, workflow binding, AI Search binding, and Google credential configuration are present. It must never return secret values.

## 3. First owner setup

Create a project:

~~~sh
curl -X POST https://<your-vrain-worker-domain>/v1/admin/projects \\
  -H "Authorization: Bearer $VRAIN_ADMIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Parmar AI","description":"First VRAIN consumer"}'
~~~

Create a collection:

~~~sh
curl -X POST https://<your-vrain-worker-domain>/v1/admin/collections \\
  -H "Authorization: Bearer $VRAIN_ADMIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Fatman Hindi","description":"Hindi reference books","language":"hi"}'
~~~

Save the returned project ID and collection ID in your secure owner records. Do not put them in public screenshots if they are sensitive to your deployment.

## 4. Upload a source

The owner console should calculate SHA-256 and page count locally, then call:

~~~http
POST /v1/admin/documents/start
Authorization: Bearer <VRAIN_ADMIN_TOKEN>
Content-Type: application/json
~~~

Example body:

~~~json
{
  "title": "Fatman Hindi Edition",
  "filename": "fatman-hindi.pdf",
  "sha256": "<64-character-hex-sha256>",
  "size": 12345678,
  "pageCount": 538,
  "collectionId": "<collection-uuid>",
  "language": "hi"
}
~~~

Use the returned documentId. The Worker keeps the GCS resumable upload URI private.

Transfer the PDF as 8 MiB or smaller application/octet-stream chunks to:

~~~http
PUT /v1/admin/documents/{documentId}/chunks
Authorization: Bearer <VRAIN_ADMIN_TOKEN>
x-vrain-chunk-start: <byte-offset>
x-vrain-total-size: <full-file-length>
~~~

The JSON response contains the authoritative uploadedBytes. On a chunk retry or offset conflict, use that offset; do not guess the GCS state.

When all bytes are transferred:

~~~http
POST /v1/admin/documents/{documentId}/complete
Authorization: Bearer <VRAIN_ADMIN_TOKEN>
~~~

The Worker confirms the object size and launches the durable Workflow. From this point, the browser can close.

## 5. Monitor a job

Fetch:

~~~http
GET /v1/admin/jobs/{documentId}
Authorization: Bearer <VRAIN_ADMIN_TOKEN>
~~~

The response contains:
- document status and page counts;
- workflow and job stage;
- recent specialist events, oldest-to-newest;
- the latest error and its diagnostic details;
- a measured ETA range and confidence.

A Studio frontend can refresh this endpoint every five seconds. A future release can replace polling with SSE/WebSocket event delivery without changing the event ledger.

Status meanings:
- uploading: file transfer is still in progress;
- uploaded: all bytes reached GCS, Workflow not yet started;
- processing: active Workflow stage;
- waiting_retry: recoverable interruption; Cron will restart it automatically;
- qa_failed: reserved for an explicit QA-failure state;
- ready: all current release gates passed;
- failed: permanent blocker or repair limit reached;
- archived: not eligible for retrieval.

## 6. Recovery operations

### Automatic path

For transient network/provider/indexing errors:
1. the failed stage writes an event;
2. the Recovery specialist classifies it;
3. the Workflow retries with exponential cooldown;
4. after its local retry window, D1 stores waiting_retry and a next-retry time;
5. the five-minute scheduled sweep claims due work;
6. a new Workflow instance resumes from the source/OCR/index checkpoint;
7. QA runs again;
8. only the final supervisor gate can publish.

Do not click Resume merely because the UI says waiting_retry. That state is the normal autonomous-recovery queue.

### Owner Resume

Use POST /v1/admin/jobs/{documentId}/resume only after reviewing the recorded blocker and fixing its cause, for example:
- adding a missing/rotated Google credential;
- restoring the required IAM permission;
- restoring an externally disabled API;
- resolving an account-level service issue.

Owner Resume does not make an invalid PDF valid and does not bypass integrity/QA checks.

### Permanent source failures

For a PDF signature failure, checksum mismatch, or page-count mismatch:
- do not publish the source;
- inspect the original local PDF;
- recompute its fingerprint and page count;
- upload the correct file again as a new document;
- archive or clean up the failed source after you have preserved any evidence needed for diagnosis.

## 7. Project access and API keys

Create a project API key:

~~~http
POST /v1/admin/projects/{projectId}/keys
Authorization: Bearer <VRAIN_ADMIN_TOKEN>
Content-Type: application/json
~~~

The response includes the plaintext vrn_live_... key once. Copy it to the consuming application's server-side secret manager immediately. VRAIN stores only a hash.

Grant a collection:

~~~http
PUT /v1/admin/projects/{projectId}/collections/{collectionId}
Authorization: Bearer <VRAIN_ADMIN_TOKEN>
~~~

Or grant one document directly:

~~~http
PUT /v1/admin/projects/{projectId}/documents/{documentId}
Authorization: Bearer <VRAIN_ADMIN_TOKEN>
~~~

Only ready documents can be retrieved even when a grant already exists.

To rotate a key:
1. issue a replacement key;
2. update the consumer's server-side secret;
3. verify a retrieval call using the replacement key;
4. revoke the old key using DELETE /v1/admin/keys/{keyId}.

Never share VRAIN_ADMIN_TOKEN with a consuming project.

## 8. Consumer API verification

List a project's permitted sources:

~~~sh
curl https://<your-vrain-worker-domain>/v1/knowledge/sources \\
  -H "Authorization: Bearer $VRAIN_PROJECT_API_KEY"
~~~

Retrieve passages:

~~~sh
curl -X POST https://<your-vrain-worker-domain>/v1/knowledge/retrieve \\
  -H "Authorization: Bearer $VRAIN_PROJECT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"Explain the doctrine of basic structure","maxResults":8}'
~~~

A valid response includes passages and original PDF page citations. The consumer must preserve the returned source metadata when generating an answer.

Test negative cases:
- no key;
- malformed key;
- revoked key;
- expired key;
- a key from another project;
- project with no grants;
- document not ready;
- a query whose only matching content is in a document not assigned to that project.

Every negative case must fail closed or return no unauthorized passage.

## 9. Troubleshooting matrix

| Symptom | Likely class | VRAIN response | Owner action |
|---|---|---|---|
| GCS 429/5xx or network timeout | Transient | Backoff and retry | None unless outage continues |
| Vision operation still running | In progress | Poll and persist state | None |
| Vision output is temporarily not visible | Transient | Retry output listing/reading | None |
| Page missing from OCR output after repair attempts | QA/source issue | Keep unpublished; then fail | Inspect PDF/page-count and re-upload |
| GCS object hash mismatch | Permanent integrity error | Reject source | Re-select the correct PDF |
| Vision/GCS permission denied | Configuration blocker | Stop hot retries | Fix service account IAM, then Resume |
| AI Search indexing unavailable | Transient | Retry the affected page/stage | None |
| Retrieval QA cannot recover expected page | Quality/index delay | Retry QA and indexing propagation | Inspect job events if persistent |
| Workflow instance missing or terminal while job still active | Orchestration interruption | Cron creates a replacement Workflow from D1 checkpoint | None |
| waiting_retry | Recoverable queue state | Five-minute sweep restarts it | Usually none |
| failed | Permanent blocker | No consumer publication | Fix cause, then owner Resume or re-upload |

## 10. Security and data handling checklist

- Keep GCS bucket private.
- Keep GCP_PRIVATE_KEY and VRAIN_ADMIN_TOKEN in Cloudflare secrets only.
- Do not put consumer keys in browser or mobile code.
- Store consumer key hashes only.
- Keep each project to its explicit document/collection grants.
- Do not expose GCS upload session URIs or source object names in consumer responses.
- Restrict GCS IAM to the dedicated VRAIN bucket.
- Apply production Cloudflare rate limits to API endpoints.
- Review D1 audit records after owner mutations.
- Back up D1 and define retention for audit/events before scale-up.
- Do not enable public administration or self-service account creation.
- Do not manually set a document to READY.
- Do not remove the old Parmar VRAIN path until migration comparison and rollback window pass.
