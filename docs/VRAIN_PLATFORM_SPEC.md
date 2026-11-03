# VRAIN — Knowledge Intelligence Platform Specification

**Status:** Standalone Worker implementation foundation in this branch. Not yet deployed or connected to production Parmar AI.  
**Owner model:** One human owner only. No public signup, invitations, external administrators, or customer-operated VRAIN consoles.  
**Reference implementation:** The existing Fatman document-import path in Parmar AI: private resumable Google Cloud Storage uploads, Google Cloud Vision asynchronous PDF OCR, page-level AI Search indexing, recovery, and page-grounded retrieval verification.

---

## 1. Product definition

VRAIN is a private, owner-operated knowledge ingestion and retrieval service. The owner uploads a document once, VRAIN validates and processes it, and the owner explicitly grants verified knowledge to individual consuming projects.

Parmar AI is the first consumer. Other applications can be added later without copying PDFs, OCR output, or indexes into each application.

VRAIN is a retrieval-augmented generation (RAG) service. It stores and indexes source knowledge and returns relevant passages with source citations. The consuming application remains responsible for using its own LLM to formulate a user-facing answer. VRAIN does not fine-tune a model merely by ingesting a book.

### Non-negotiable principles

1. **Single owner:** only the owner-controlled secret can create projects, collections, sources, grants, and keys or operate recovery controls.
2. **Consumer-only applications:** project API keys can retrieve only explicitly granted, published knowledge. They cannot administer VRAIN, upload documents, or publish content.
3. **Google Cloud Vision OCR:** use the same asynchronous PDF DOCUMENT_TEXT_DETECTION approach used for Fatman.
4. **Private source storage:** original PDFs and OCR intermediates stay in a private Google Cloud Storage bucket.
5. **Independent source verification:** VRAIN recomputes SHA-256 from the uploaded GCS object. It does not trust a browser-provided fingerprint by itself.
6. **Page-level provenance:** every indexed page retains document identity, language, and original PDF page number.
7. **QA before publication:** OCR coverage, indexing completeness, and page-grounded retrieval checks must pass before a source can become READY.
8. **Autonomous recovery:** transient failures are diagnosed, retried with backoff, and resumed from persisted checkpoints. Closing the browser must not stop a submitted processing job.
9. **Fail closed:** unknown projects, absent grants, invalid keys, partial documents, and non-ready sources produce no retrievable evidence.
10. **Truthful telemetry:** progress and ETA derive from persisted processing events and measured work, not animated or fabricated numbers.

## 2. Service boundaries

VRAIN is a separate Worker project inside the same GitHub repository:

~~~text
parmar-ai/
  src/                         Existing Parmar AI Worker (unchanged by extraction)
    vrain/                     Existing in-process VRAIN compatibility feature
    fatman/                    Existing Fatman compatibility pipeline
  workers/
    vrain/
      src/                     Standalone VRAIN Worker
      migrations/              Independent VRAIN D1 schema
      wrangler.jsonc           Independent Worker/resources
      test/                    Worker-specific tests
  docs/
    VRAIN_PLATFORM_SPEC.md
    VRAIN_OPERATIONS_RUNBOOK.md
~~~

The repository is shared; the runtime is not. The standalone Worker has its own:

- Worker deployment and environment variables.
- D1 database and migration history.
- Cloudflare Workflow binding.
- AI Search namespace and VRAIN-owned instance.
- Private GCS object prefix and service-account configuration.
- Owner authentication token and consumer API-key registry.

The existing Parmar AI Worker remains in place during migration. It must not be pointed at VRAIN's new D1 database or rewritten until the standalone Worker is provisioned and verified.

### Logical architecture

~~~mermaid
flowchart TD
  O[Single human owner] --> S[VRAIN Studio / owner console]
  S --> C[VRAIN control plane API]
  C --> D1[(VRAIN D1)]
  C --> W[Cloudflare Workflows]
  W --> I[Source integrity and SHA-256]
  I --> GCS[(Private Google Cloud Storage)]
  W --> V[Google Cloud Vision OCR]
  V --> GCS
  W --> N[Page normalization and provenance]
  N --> GCS
  N --> AS[(VRAIN AI Search namespace)]
  W --> Q[Independent retrieval QA]
  Q --> P[Final publication gate]
  P --> D1
  A[Parmar AI / other applications] --> API[VRAIN consumer API]
  API --> D1
  API --> AS
~~~

**VRAIN Studio** is the owner-facing control surface. The existing Parmar /admin/vrain page remains the current compatibility interface until a dedicated VRAIN Studio frontend is connected to the new owner API.

**VRAIN Engine** is the durable ingestion, OCR, indexing, QA, and recovery workflow.

**VRAIN API** is the authenticated consumer retrieval interface.

## 3. Identity, ownership, and access model

### 3.1 Owner authentication

The standalone Worker uses one high-entropy VRAIN_ADMIN_TOKEN stored as a Cloudflare Worker secret. Owner endpoints require:

~~~http
Authorization: Bearer <VRAIN_ADMIN_TOKEN>
~~~

This is an owner-only control-plane credential. It must never appear in browser JavaScript, HTML, local storage, app bundles, mobile apps, Git history, logs, or public documentation containing a real value.

The Parmar AI server may call owner endpoints using a server-side secret or an authenticated Worker service binding in a later integration. It must not relay the owner token to a browser.

There are no other VRAIN human accounts in this version. There is no public project-creation endpoint.

### 3.2 Projects and collections

- A **project** represents a consuming application, such as Parmar AI.
- A **collection** groups related documents, such as Fatman Hindi, Indian Polity, or Assamese reference material.
- A document belongs to one collection in this first schema.
- A project receives access only through an explicit direct-document grant or an explicit collection grant.
- A collection is not globally visible merely because it exists.
- A new project starts with zero knowledge grants.

Example:

~~~text
VRAIN owner
  ├── Project: Parmar AI
  │     └── Collection grant: Fatman Hindi
  └── Project: Future Study App
        └── Direct document grant: Assamese Dictionary
~~~

Removing a grant prevents future retrieval through that project. It does not delete the source PDF or remove grants held by another project.

### 3.3 Consumer API keys

Keys use the format:

~~~text
vrn_live_<high-entropy-random-secret>
~~~

Current implementation properties:

- Each key belongs to one project.
- Only the knowledge:read scope is accepted for consumer keys.
- VRAIN stores a SHA-256 hash of the complete secret, not the plaintext secret.
- The key prefix and non-secret metadata are retained for owner-side identification.
- The secret is returned only at creation time.
- Keys can expire and can be revoked.
- Rotation means issuing a replacement key, updating the application, validating it, and then revoking the old key.
- Revocation is immediate for subsequent authenticated requests.

Consumer keys do not receive upload, project-admin, collection-admin, key-management, or publication permissions. Separate write scopes are deliberately not part of this API.

A production deployment should also apply Cloudflare rate-limiting rules and monitor key usage. The current source records last-used time but does not yet implement a per-key quota ledger.

## 4. Document ingestion contract

### 4.1 Intake metadata

The owner supplies:
- title;
- original PDF filename;
- SHA-256 fingerprint computed from the selected file;
- byte size;
- PDF page count;
- target collection;
- optional language tag such as hi, en, or as.

The browser fingerprint supports duplicate detection and safe retry. It is not considered the final integrity check.

Current configurable guardrails default to:
- maximum source size: 1 GiB;
- maximum declared page count: 2,000 pages;
- chunk upload size: 8 MiB.

Google Cloud Vision's asynchronous PDF/TIFF endpoint supports up to 2,000 pages per file. See [Google Cloud Vision: Detect text in files (PDF/TIFF)](https://cloud.google.com/vision/docs/pdf).

### 4.2 Private resumable upload

1. The owner calls the upload-start endpoint.
2. VRAIN creates a private GCS resumable upload session.
3. The session URI is stored server-side in D1 and is never returned to the browser.
4. The browser sends bounded 8 MiB chunks to VRAIN.
5. VRAIN asks GCS for the remote upload offset before accepting each chunk.
6. If the browser retries a chunk, VRAIN returns the authoritative offset rather than duplicating bytes.
7. Closing the browser during transfer does not discard the GCS session. Selecting the same source again can continue from the server's recorded offset while the session remains valid.
8. If the GCS session expired, the owner can start a fresh transfer of the same source. The old incomplete record remains visible for cleanup.

The object path is:

~~~text
vrain/imports/{documentId}/source.pdf
~~~

The bucket must not be public.

### 4.3 Server-side source verification

Before OCR, VRAIN:
- confirms the GCS object exists;
- checks its byte size against the declared size;
- streams the object from GCS;
- validates the leading %PDF- signature;
- incrementally calculates SHA-256 without loading a 1 GiB PDF into Worker memory;
- compares the calculated digest with the intake fingerprint.

A mismatch is a permanent integrity failure. VRAIN must not OCR, index, or publish that object.

## 5. Google Cloud Vision OCR

The OCR provider is **Google Cloud Vision**, not Cloudflare OCR, Workers AI, or a substitute provider.

VRAIN calls:

~~~http
POST https://vision.googleapis.com/v1/files:asyncBatchAnnotate
~~~

With:
- GCS source URI pointing at the private PDF;
- MIME type application/pdf;
- feature DOCUMENT_TEXT_DETECTION;
- GCS destination under the document's private OCR prefix;
- batchSize: 1 to preserve simple page-to-output-file mapping.

The returned long-running operation name is persisted. VRAIN polls the operation resource until it is complete, then reads the JSON output objects from GCS.

Per-document output prefix:

~~~text
vrain/imports/{documentId}/ocr/{attemptId}/
~~~

The implementation uses a Google service-account JWT and OAuth access token. API keys are not used for the asynchronous PDF annotation request. See [Google Cloud Vision asynchronous PDF documentation](https://cloud.google.com/vision/docs/pdf) and [Vision authentication](https://cloud.google.com/vision/docs/authentication).

### IAM prerequisites

The service account needs:
- permission to read the input PDF object;
- permission to write Vision OCR output objects;
- permission for VRAIN to read, list, and write its own page-normalized objects;
- permission to call the Vision API.

For a simple dedicated bucket setup, grant the VRAIN service account bucket-scoped roles/storage.objectAdmin. This includes the source-read and output-write capabilities described in the Vision documentation. Prefer bucket-scoped access rather than project-wide storage administrator roles. Enable the Cloud Vision API in the Google Cloud project.

The code currently uses the global Vision endpoint. If a data-residency requirement calls for the EU or US endpoint, that must be configured deliberately before importing restricted material; the global endpoint does not promise regional processing.

## 6. Page normalization and indexing

VRAIN preserves two durable representations:

1. **Normalized OCR text** in private GCS, one text object per source PDF page:  
   vrain/books/{documentId}/ocr/page-000001.txt
2. **Search item** in the dedicated VRAIN AI Search instance, also one source item per PDF page:  
   vrain/books/{documentId}/pages/page-000001.txt

Each AI Search item includes:
- document ID;
- document title;
- original PDF page number;
- language tag.

The page is the provenance unit. AI Search may split page text into internal retrieval chunks, but every returned passage must still resolve to the containing document and original PDF page.

Empty/blank pages are represented explicitly as having no machine-readable text so page coverage can still be measured. They are not used as QA evidence.

The normalized text remains in private GCS so VRAIN can repair an index page without repeating OCR. The original PDF remains the authoritative source.

## 7. Specialist pipeline and QA gate

The Worker uses named, deterministic specialist stages. These are orchestrated code modules and durable workflow tasks, not unsupervised LLM agents with production credentials.

| Specialist | Responsibility | Success evidence |
|---|---|---|
| Source integrity specialist | Verify GCS object, PDF signature, byte count, server SHA-256 | Exact fingerprint match |
| Google Cloud Vision OCR specialist | Submit and poll asynchronous Vision operation | Vision operation completed |
| Document extraction specialist | Map OCR output objects to PDF pages; normalize and persist page text | Expected page set present |
| Page indexing specialist | Index each page under a VRAIN-owned prefix | Every page indexed/completed |
| Retrieval QA specialist | Build probes from OCR text and query the VRAIN search index | Expected source page keys recovered |
| Recovery specialist | Classify errors, repair affected stage, schedule another attempt | Job resumes from stored checkpoint |
| Final supervisor gate | Recheck deterministic release invariants and mark ready | All release conditions pass |

### QA conditions

A source can become READY only when all of these are true:

1. GCS object byte size matches the declared source size.
2. Server SHA-256 exactly matches the declared source fingerprint.
3. The source begins with a valid PDF signature.
4. Vision output covers the declared PDF page count; an unexpected extra page is a hard mismatch.
5. OCR JSON for every expected page can be read and mapped to that page.
6. Normalized page text has been persisted for every expected page, including explicit blank-page records.
7. AI Search confirms completed indexing for every page.
8. Distributed page-grounded retrieval probes recover their exact expected page keys.
9. The D1 record reports indexed_pages = page_count.
10. The final supervisor gate commits the READY state.

QA probes are spread across the document, including early, middle, late, and final pages. The implementation chooses up to five readable samples and requires at least three when the source has three or more pages. This is a deterministic retrieval gate, not a guarantee that every factual assertion inside a book has been semantically fact-checked.

A source remains unavailable to consumer retrieval while it is uploading, processing, waiting for recovery, QA-failed, or failed.

### Future QA extensions

Before calling VRAIN a general-purpose document-intelligence platform, the following should be added as separate measured gates:
- layout/heading/section detection;
- table reconstruction QA;
- language identification and script consistency checks;
- OCR confidence review for low-quality scans;
- document-level duplicate/edition detection;
- broader retrieval test sets, not only a handful of page samples;
- optional language-aware semantic review for Hindi, English, Assamese and mixed-script documents.

These are explicitly future extensions; the initial standalone Worker preserves the page-first Fatman pipeline.

## 8. Autonomous recovery and restart semantics

The owner should not be required to repeatedly diagnose ordinary provider interruptions.

### Retryable failures

Examples:
- network disconnects;
- DNS/socket errors;
- request timeouts;
- HTTP 408, 409, 429;
- HTTP 5xx responses;
- temporary Google Cloud or AI Search unavailability;
- AI Search indexing propagation delay.

The workflow makes up to eight attempts for a stage, with persisted backoff:
- 30 seconds;
- 1 minute;
- 2 minutes;
- 4 minutes;
- 8 minutes;
- 15 minutes;
- 15 minutes;
- 15 minutes.

If the local attempt window is exhausted, VRAIN moves the job to waiting_retry, stores the failed stage and reason, and schedules the next attempt. The five-minute Cron recovery sweeper claims due jobs and starts a new Workflow instance from the persisted document checkpoint. This repeats while the error remains classified as recoverable.

The sweeper also checks stale processing jobs. It inspects the recorded Workflow instance and only rebuilds a job when that instance is terminal or genuinely missing; a live Workflow is not intentionally duplicated.

### Non-retryable blockers

Examples:
- invalid or corrupted PDF;
- actual source hash differs from intake hash;
- declared page count does not match Vision output;
- unsupported file type;
- absent/revoked Google credentials;
- permission denied;
- a source that has insufficient readable text to form QA probes after repair attempts.

These must not be hot-looped. VRAIN records the reason and leaves the source unpublished. After correcting the underlying configuration or selecting a valid source, the owner may explicitly resume or re-upload.

### Recovery safety

"Retry indefinitely" means a recoverable job remains durable and eligible for automatic retries. It does not mean:
- retry permanent errors every few seconds;
- spawn unlimited parallel workflows;
- erase the original source or OCR output;
- bypass QA;
- mark a document ready because enough time has passed;
- let an automated agent rewrite and deploy production code.

The current source implements exponential cooldown and a scheduled recovery queue. A separate account-level cost budget, provider circuit-breaker thresholds, and automated alert thresholds remain deployment hardening tasks before large-scale ingestion.

## 9. Monitoring, events, and ETA

Every stage emits an append-only row in vrain_activity_events. Job state and the latest heartbeat are also persisted in D1.

The owner job view returns:
- document status;
- stage and specialist timeline;
- current and expected page counts;
- recent failure and recovery reason;
- retry/attempt metadata;
- last updated time;
- estimated remaining time range and confidence.

The current ETA estimate uses remaining pages and observed page-index duration from successful indexing events. It is intentionally a range. It is low-confidence until this Worker has enough historical runs, and it does not yet model all OCR-provider queue delays. A connected Studio frontend should poll the job view every five seconds or use a future event stream; polling the D1-backed event history is the current contract.

Closing the owner console does not stop a Cloudflare Workflow or the Cron recovery sweeper.

## 10. Consumer retrieval and citation contract

Consumer requests authenticate with a project-specific API key. VRAIN resolves the project from the key itself; the caller cannot choose or override a project slug in the request body.

Before searching:
1. validate the key hash and active state;
2. validate key expiry and knowledge:read scope;
3. resolve only the key's active project;
4. load directly granted documents and documents in explicitly granted collections;
5. restrict the candidate set to READY documents whose full page count is indexed.

After searching:
- reject any result whose page key does not begin with an allowed document prefix;
- verify the page number is within the registered page count;
- return the passage text, source title, document ID, original PDF page, and score;
- never return the original PDF or GCS object URI through this API.

The application can pass the retrieved passages and citations to Gemini, Vertex AI, or another model. The model should not be allowed to invent citations or change the source page metadata.

## 11. HTTP API in this implementation

Base URL is the standalone Worker's deployed HTTPS URL. Owner endpoints require VRAIN_ADMIN_TOKEN. Consumer endpoints require a project key.

### Owner/control-plane API

| Method | Path | Purpose |
|---|---|---|
| GET | /health | Binding/configuration health (no secret values) |
| GET, POST | /v1/admin/projects | List or create projects |
| GET, POST | /v1/admin/collections | List or create collections |
| POST | /v1/admin/projects/{projectId}/keys | Issue a project read key; secret shown once |
| GET | /v1/admin/projects/{projectId}/keys | List key metadata without secret hashes |
| DELETE | /v1/admin/keys/{keyId} | Revoke a key |
| PUT, DELETE | /v1/admin/projects/{projectId}/collections/{collectionId} | Grant/revoke collection access |
| PUT, DELETE | /v1/admin/projects/{projectId}/documents/{documentId} | Grant/revoke direct document access |
| GET | /v1/admin/documents | List sources and processing status |
| POST | /v1/admin/documents/start | Create resumable PDF upload |
| PUT | /v1/admin/documents/{documentId}/chunks | Relay one upload chunk to GCS |
| POST | /v1/admin/documents/{documentId}/complete | Verify upload completion and start Workflow |
| GET | /v1/admin/jobs/{documentId} | Read job, recent events, and ETA |
| POST | /v1/admin/jobs/{documentId}/resume | Owner-requested restart after fixing a blocker |

### Consumer API

| Method | Path | Purpose |
|---|---|---|
| GET | /v1/knowledge/sources | List published sources assigned to the key's project |
| POST | /v1/knowledge/retrieve | Retrieve passages and page citations |

### Upload request shape

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

Chunk upload uses an application/octet-stream body, up to 8 MiB, with:
- x-vrain-chunk-start: byte offset;
- x-vrain-total-size: complete file length.

The upload session URI is deliberately not returned to the caller.

### Retrieval request/response shape

~~~json
{
  "query": "Explain the doctrine of basic structure",
  "maxResults": 8
}
~~~

A successful response contains project, passages[] and citations[]. Each passage includes documentId, title, page, text, and score.

## 12. Data model

The standalone D1 migration creates:

- vrain_projects: consumer application identities;
- vrain_collections: document groupings and language metadata;
- vrain_documents: immutable source identity, upload, OCR, index, state and publication metadata;
- vrain_project_documents: explicit direct grants;
- vrain_project_collections: explicit collection grants;
- vrain_api_keys: hashed project key records, scopes, expiry and revocation;
- vrain_jobs: durable stage, attempt, heartbeat, workflow, next retry and error checkpoint;
- vrain_activity_events: append-only specialist events;
- vrain_audit_log: owner mutations;
- vrain_schema_version: standalone schema version marker.

The database is deliberately separate from Parmar AI's production D1.

## 13. Deployment isolation and cutover

The standalone Worker cannot be safely deployed until its real resources exist. The checked-in Wrangler config intentionally contains a placeholder D1 ID and GCS bucket name.

Provisioning order:
1. Create a dedicated D1 database named vrain-control-plane.
2. Replace the placeholder database_id in workers/vrain/wrangler.jsonc.
3. Create a dedicated private GCS bucket and set the bucket name in Worker vars.
4. Enable Cloud Vision API and grant the service account the required bucket/API permissions.
5. Add VRAIN_ADMIN_TOKEN, GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY, and optional GCP_PRIVATE_KEY_ID as Worker secrets.
6. Apply VRAIN D1 migrations.
7. Deploy vrain-engine; the bound VRAIN AI Search namespace and named instance must be verified.
8. Call /health, create a test project, upload a small test PDF, inspect every event, test retrieval and revoke the test key.
9. Run a second test with a multi-page Hindi PDF, then test a controlled retry in a non-production environment.
10. Only after verification, create the production Parmar AI project and key.

### Migration from the existing Parmar VRAIN

1. Keep existing src/vrain and Fatman paths operational.
2. Export the source registry and project/collection grants from existing D1.
3. For each source, compare title, SHA-256, byte size, page count, indexed count, and ready state.
4. Preserve original PDF object references during a controlled migration where bucket permissions allow; otherwise copy into the new private GCS bucket and verify the copied object digest.
5. Migrate or rebuild page items into the new VRAIN AI Search namespace. Never assume a key in the old shared namespace exists in the new one.
6. Run page coverage and retrieval QA again in the new Worker.
7. Create the Parmar AI project, explicitly grant the appropriate collections/documents, issue a read key, and integrate server-to-server.
8. Compare old and new retrieval results side-by-side on a fixed test set.
9. Cut over Parmar's retrieval call only after the comparison passes.
10. Retain the old path for a rollback period. Do not delete its records, objects, or index until cutover has been verified and rollback is no longer needed.

## 14. Implementation status: honest boundary

Included in this branch:
- independent Worker directory and Wrangler config;
- independent D1 schema and migrations;
- Google service-account JWT/OAuth;
- private resumable GCS uploads;
- server-side streaming SHA-256 and PDF signature verification;
- Google Cloud Vision asynchronous PDF OCR;
- page normalization and page-level AI Search indexing;
- durable Workflow stages and automatic recovery sweeper;
- page-grounded retrieval QA and deterministic publish gate;
- owner-only project, collection, grant and API-key endpoints;
- project-scoped read-only consumer API;
- job event history and provisional measured ETA;
- worker-specific SHA-256 tests and CI checks.

Not yet deployed/verified:
- a real dedicated VRAIN D1 ID;
- a real private VRAIN GCS bucket and IAM policy;
- Cloudflare secrets for the standalone Worker;
- a production VRAIN AI Search namespace/instance;
- a live end-to-end upload, Vision OCR, QA, key-auth retrieval test on the standalone Worker;
- the new VRAIN Studio UI;
- Parmar AI cutover from its in-process VRAIN implementation.

The existing Parmar AI Worker remains the currently deployed VRAIN console and compatibility path until a separate cutover is completed.