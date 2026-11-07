# BRVIN Operations Runbook

This is the detailed engineering/operator runbook for the current BRVIN production system in `ashini-x/parmar-ai`. It covers system-level procedures, admin API routes, troubleshooting and deployment. For day-to-day, beginner-friendly administrator tasks, use [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md).

For architecture and design decisions, see [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md). For connecting an application, see [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md).

## 1. Admin entry and access boundary

The BRVIN workspace is part of the protected `parmar-ai` admin application:

- Dashboard: `/admin/brvin`
- Dashboard script: `/admin/brvin/app.js`
- API root: `/admin/api/brvin/*`

Sign in through the existing Parmar admin authentication. The server enforces admin access for the page, script and API. POST APIs also enforce same-origin requests.

Do not expose the BRVIN admin endpoints without the existing admin guard. Do not use these routes as the public consumer integration interface.

The previous `/admin/vrain` URL is retained as a redirect/compatibility alias. Use `/admin/brvin` for all new documentation and operational instructions.

## 2. Current dashboard areas

The current workspace provides the following operational areas:

| Area | Use |
|---|---|
| Overview | View sources, collections, projects, total/indexed pages, ready/active/failed counts, current jobs and recent activity |
| Knowledge library | Upload PDFs, select a collection and initial projects, view page indexing progress, inspect a pipeline, archive or delete a source |
| Governance | Create projects and collections, manage direct project/book assignments and project/collection grants |

The dashboard lists current source and pipeline states; it does not replace the D1 registry as the authority for permissions or readiness.

## 3. Create an application project

1. Open Governance.
2. Create a project with a human-readable name and optional description.
3. Save the generated slug shown in the project tile.
4. Use that slug as the default Service Binding client ID when a same-account Worker is configured.

The system automatically creates:
- the internal project UUID;
- a unique URL-safe slug;
- a default service-client mapping where `client_id = slug`.

Do not manually generate an ID or API key. The client ID is not a secret credential. It is trusted only when supplied as deployment-controlled Service Binding props.

### Naming notes

The current slug generator normalizes to lowercase ASCII letters, digits and hyphens, trims leading/trailing hyphens and caps at 64 characters. Project names are limited to 100 characters and descriptions to 500 characters. The database enforces unique slugs. If a name produces an empty or conflicting slug, choose a distinct name.

Creating a project does not grant any source. A new project should report zero authorised sources until a book or collection is assigned.

## 4. Create a collection

1. Open Governance.
2. Create a collection with a clear name and description.
3. Treat the collection as a permission group, not merely a visual category.
4. Grant it only to projects that should read all ready sources in the collection.

A project granted a collection can receive access to future sources added to that collection once they finish processing and are marked ready. Review collection grants before placing additional books into a shared collection.

## 5. Upload a PDF knowledge source

1. Open the Knowledge Library.
2. Choose the destination collection.
3. Optionally select projects for direct book-level grants.
4. Select a PDF and provide a display title.
5. Confirm the OCR-cost acknowledgement.
6. Start the upload and allow the resumable upload to complete.
7. Monitor the pipeline card/activity history until processing and checks finish.

The current server-side validation accepts:
- SHA-256 fingerprint: 64 hexadecimal characters;
- file size: 8 bytes through 1 GB;
- page count: 1 through 2,000;
- a non-empty title and filename;
- explicit confirmation that Google Cloud Vision OCR usage may incur costs.

The upload uses private Google Cloud Storage and resumable upload sessions. Processing continues on the server after the upload has completed. Browser closure does not imply that the server-side Workflow has stopped.

### Pipeline stages

The dashboard presents five conceptual stages:

1. Secure upload.
2. Vision OCR.
3. Page indexing.
4. Retrieval QA.
5. Ready.

The backend tracks upload jobs, Vision operations, Workflow identifiers, page counts and activity events. A successful upload alone does not mean the source is retrievable.

## 6. Understand source statuses

Statuses observed in code and dashboard include:

| Status | Operational meaning |
|---|---|
| `uploading` | Resumable upload is in progress |
| `uploaded` | Upload completed; background processing has not reached ready |
| `processing` | OCR/indexing/recovery Workflow is working |
| `ready` | Source is eligible for retrieval when the project grant is valid and all pages are indexed |
| `failed` | A pipeline operation failed and needs inspection/recovery |
| `needs_review` | A source has not passed the required readiness condition |
| `archived` | Source is retained but is not eligible for normal retrieval |
| `deleting` | Full imported-book deletion Workflow is in progress |
| `delete_failed` | Deletion needs inspection/retry |

The retrieval service independently requires both `status = ready` and `indexed_pages = page_count`. Do not treat a UI label alone as proof that all permissions and retrieval checks are correct.

## 7. Assign or revoke access

There are two different grant types:

**Direct book grant**
- Grants one specific source to a project.
- Use it when an application should have a narrow, source-specific permission.

**Collection grant**
- Grants the collection to a project.
- Every ready source in that collection can be retrieved.
- Future sources added to that collection can become available after they are ready.

Use Governance to manage project/collection grants and the source's management controls to manage direct project assignments. Confirm the effective project access shown in the library after changing grants.

Access is calculated at retrieval time from D1. Do not rely on a cached project slug or old list of grants in a consumer application.

## 8. Inspect an import or a failed job

For a source in an active/failed state:

1. Open Overview or the Knowledge Library.
2. Find the source/job card.
3. Use Inspect / Inspect pipeline.
4. Review the job status, uploaded bytes, expected bytes, indexed pages, page count and error.
5. Review the associated BRVIN activity events in chronological context.
6. Identify whether the failure occurred during upload, Vision OCR, Workflow creation, page indexing, retrieval QA or cleanup.
7. Use Resume only when the dashboard offers it and the failed operation is in a resumable state.
8. Re-run the relevant tests or production acceptance checks after a fix.

### Vision operation completion versus OCR-output availability

For asynchronous PDF OCR, `done = true` on the Google Vision long-running operation is not sufficient evidence that BRVIN can index the source. The operation's successful `response.responses[].outputConfig.gcsDestination.uri` must match the import's registered temporary OCR prefix, and the expected per-page JSON files must exist in that prefix before page indexing starts.

The protected **Inspect processing pipeline** view reports:
- the expected OCR output prefix;
- the destination URI returned by Vision;
- a bounded list of object names, sizes and creation times found under the prefix;
- any operation-response, destination-mismatch or GCS-listing error.

For a PDF with `batchSize: 1`, the expected file for page N is `output-N-to-N.json` directly beneath the destination URI's prefix. The importer must not append another `ocr/` segment: the legacy prefix already includes its `ocr/` directory, while new BRVIN imports use their isolated temporary root directly. If Vision says complete but the expected object is absent:
1. Do not upload the PDF again.
2. Do not manually mark it ready or repeatedly resume indexing against a missing object.
3. Inspect the actual operation response and the listed output objects. Distinguish a Vision operation error, a destination mismatch, an empty GCS output prefix, and a GCS permission/listing failure.
4. Correct the underlying output destination/IAM issue first.
5. Only then schedule a fresh OCR operation. That may incur another Google Cloud Vision charge; obtain approval for the repeat OCR before triggering it.

The importer now validates the operation response and checks for all expected output objects before it starts the indexing child Workflow. This prevents a false OCR-complete state from sending an indexer into repeated 404 retries.

Do not manually mark the source ready as a workaround. The source must pass page coverage and retrieval requirements.

## 9. Archive, delete and OCR-only cleanup

These operations are not interchangeable.

### Archive

Archiving changes the source state so it is no longer returned by the ready-source resolver. Use archive when the source should be retained but removed from active retrieval.

### Delete an imported PDF

Full deletion is asynchronous and destructive. It is restricted to imported PDF sources; the built-in Fatman source is protected.

The deletion Workflow verifies the book's exact search prefix and storage prefix before deleting anything. It then:
1. inventories AI Search items only under that source's prefix;
2. deletes those page items in bounded batches;
3. rechecks that no indexed items remain;
4. removes the private source PDF and temporary OCR objects;
5. removes project grants, import/job rows and the registered PDF book row;
6. preserves project/collection definitions and the activity trail.

Wait for the deletion Workflow to finish and inspect its completion/failure activity. A partially completed deletion must be resumed/reconciled through the Workflow path, not by deleting arbitrary D1 rows manually.

### Clear all imported books

The dashboard has a guarded “Clear all imported books” control requiring the exact confirmation phrase `DELETE ALL BRVIN BOOKS`. It starts independent deletion workflows for eligible imported PDF books.

The operation deliberately preserves:
- the built-in reviewed Fatman source;
- project and collection definitions;
- activity/audit history.

Treat this as a destructive bulk operation. Confirm the selected environment and current backup/recovery posture before proceeding.

### Delete temporary Vision OCR output only

This is a separate retention action. It deletes the private GCS Vision OCR output prefix for an eligible ready/archived imported PDF but preserves:
- the original PDF;
- its indexed page set in AI Search;
- its BRVIN registration and project/collection relationships.

The deletion is tracked with D1 start/completion timestamps and an activity event. It is not a full book deletion.

## 10. Troubleshooting by symptom

### Semantic search returns whole pages or unrelated pages

First distinguish the two retrieval modes:

- A request with `pageNumbers` is an exact-page lookup. When exact items are found, BRVIN returns the requested page text directly and skips semantic AI Search.
- A semantic request has a query and **no** `pageNumbers`. It returns reranked candidate excerpts with their original physical PDF page provenance.

For the semantic path, verify the production Core settings in this order:

1. The AI Search instance is using hybrid retrieval (vector + BM25) with RRF fusion, and the query filter contains only D1-authorised source prefixes.
2. The request asks for a bounded candidate set (currently 16) and supplies `retrieval.match_threshold`; it does not request all chunks.
3. Request-level reranking is enabled with `@cf/baai/bge-reranker-base`. Review the returned `scoring_details.reranking_score`, not only the fused `chunk.score`.
4. The reranker threshold is applied before output. When a reranking score is unavailable (for example, a legacy/disabled reranking path), BRVIN applies its meaningful-query-term coverage fallback. Every returned item key and parsed page is validated against the same authorised source set.
5. Semantic passages are bounded excerpts, not the whole OCR page. Compare the returned `pdfPage` with the original physical PDF page.

Current defaults are set in `wrangler.brvin.jsonc`: `BRVIN_MATCH_THRESHOLD=0.3`, `BRVIN_RERANKING_ENABLED=true`, and `BRVIN_RERANKING_MIN_SCORE=0.4`. The model ID can be changed to a Cloudflare-supported reranker without changing any consumer's answer-generation provider. BRVIN itself does not call Gemini or generate the final answer.

### Existing indexed items after a chunk-size change

Chunk size is an indexing-time setting, not a query-time option. The shared AI Search instance is configured for 256-token chunks with 10% overlap. Existing built-in items must be synchronised after a configuration change before their chunk inventory reflects the new setting.

Use the Cloudflare AI Search **Sync Item** API on the exact existing item ID (or the dashboard's per-item sync action):

```http
PATCH /accounts/{account_id}/ai-search/namespaces/default/instances/{instance_id}/items/{item_id}
Content-Type: application/json

{"next_action":"INDEX","wait_for_completion":true}
```

This reprocesses the already stored AI Search item. It does not upload the source PDF or run Google Vision OCR again. It can consume Cloudflare AI Search ingestion usage, so re-index a small source first and verify both item logs and the actual `/chunks` inventory. A request can time out while the backend later completes; do not submit concurrent duplicate syncs while the item is `queued` or `running`. Retry an item only after checking its current status, item logs and chunks. Never bulk-sync the whole corpus before a pilot passes acceptance.

**8 November 2026 pilot result:** the existing three Physics page items completed item-scoped re-indexing under the new setting, with page 1 = 3 chunks, page 2 = 4 chunks and page 3 = 4 chunks. Page 2 initially logged a Workers AI timeout; the single item-scoped retry completed successfully with 4 chunks. The original PDF, Vision OCR files, page count and D1 source readiness were unchanged.

The direct AI Search engine smoke check used the exact Physics folder filter, hybrid retrieval, BGE reranking and cache disabled. It ranked the Newton second-law evidence on PDF page 2 first (0.993), the worked example on page 3 first (0.9995), and the bus-braking answer-key evidence on page 3 first (0.9994). This verifies the search engine's page-key ranking, not the complete consumer authorisation boundary. Finish the protected BRVIN Teachers v2 test under [RETRIEVAL_TEST_RUNBOOK.md](https://github.com/ashini-x/brvin-teachers/blob/main/docs/RETRIEVAL_TEST_RUNBOOK.md); do not substitute a direct AI Search API call for the consumer Service Binding test.

### Project shows connected but no passages

Check in this order:

1. The Service Binding props use the project's generated slug.
2. The project exists in `brvin_service_clients` and is active.
3. The book is `ready`.
4. `indexed_pages = page_count`.
5. The project has a direct book grant or a grant to the book's collection.
6. The source's `search_prefix` points to the actual indexed folder.
7. The question is within the source's content and the result meets the configured relevance threshold.

An authorised source count above zero only means some eligible source exists. It does not guarantee that every question has a matching passage.

### `CLIENT_NOT_REGISTERED`

The trusted client ID did not map to an active project. Check the Service Binding's `props.clientId` and the row in `brvin_service_clients`. Do not try to fix this by adding a client ID to the RPC request body; the service intentionally ignores caller-provided identity.

### `ready: false` or zero authorised sources

The Service Binding may be connected correctly, but the project has no ready sources. Review grants, collection membership and source status/index completeness.

### `MONTHLY_LIMIT_REACHED`

The project has reached its monthly BRVIN retrieval allowance. Check the relevant usage record:
- Fatman uses `fatman_search_usage`.
- Other projects use `brvin_project_search_usage`.

Do not delete usage rows as a reset workaround. Review the service usage policy and cost requirements before changing limits.

### `BRVIN_UNAVAILABLE` or `RETRIEVAL_FAILED`

Check Cloudflare Worker health/logs, D1 availability, AI Search binding/instance configuration and recent deployments. Respect the `retryable` field. Do not make the caller fall back to an unrestricted global index search.

### Public URL returns HTTP 404

This is expected for the private `brvin-service` Worker. Its default HTTP handler returns 404 and `workers_dev` is disabled. Test it through the consumer's internal Service Binding, not a browser or public Worker URL.

### Production `/health` reports degraded

The existing `parmar-ai` health check calls BRVIN project status for its configured Fatman client. Check:
- `BRVIN_SERVICE` Service Binding in `wrangler.jsonc`;
- `service: "brvin-service"`;
- `entrypoint: "BrvinRetrievalApi"`;
- `props.clientId: "fatman"`;
- active Fatman project and its grants;
- `wrangler.brvin.jsonc` D1 and AI Search bindings.

## 11. Relevant admin API routes

All routes are served by `parmar-ai` and require admin authentication. POST endpoints also require same-origin validation.

| Method | Route | Purpose |
|---|---|---|
| GET | `/admin/api/brvin/overview` | Dashboard metrics, projects, collections, books, jobs and recent activity |
| GET | `/admin/api/brvin/status?id=...` | Import status, Workflow/Vision status and import activity |
| GET | `/admin/api/brvin/diagnostics/storage` | Private GCS upload diagnostics |
| POST | `/admin/api/brvin/projects` | Create project and default client identity |
| POST | `/admin/api/brvin/collections` | Create collection |
| POST | `/admin/api/brvin/upload/start` | Start a registered BRVIN PDF upload |
| POST | `/admin/api/brvin/upload/:id/chunk` | Upload a resumable chunk |
| POST | `/admin/api/brvin/upload/:id/resume` | Resume the upload |
| POST | `/admin/api/brvin/upload/:id/complete` | Complete the upload |
| POST | `/admin/api/brvin/books/assign` | Update direct project grants |
| POST | `/admin/api/brvin/projects/collections` | Update project/collection grants |
| POST | `/admin/api/brvin/books/archive` | Archive a source |
| POST | `/admin/api/brvin/books/delete` | Delete an imported book |
| POST | `/admin/api/brvin/books/delete-vision-output` | Delete OCR output only |
| POST | `/admin/api/brvin/clear` | Start bulk deletion of imported books |

Fatman-specific import/monitoring routes also exist under `/admin/api/fatman/*`. The generic importer still uses some Fatman-named internals; do not assume those legacy routes or bindings are already renamed.

## 12. Deployment and rollback

The production release workflow is `.github/workflows/release-validation.yml`.

A push to `main` that changes runtime code, tests, build/deployment configuration or release scripts runs validation and then the paired production deployment. Documentation-only and workflow-policy-only pushes are excluded by the workflow's `push.paths` filter, so they do not redeploy production. Pull requests still run validation for all changed files.

Cloudflare Workers Builds remains connected to `ashini-x/parmar-ai` for optional build/version artifacts, but it is **not** a production deployment authority. On 7 November 2026 its production command was changed from `npx wrangler deploy` to `npx wrangler versions upload`, which uploads a Worker version without promoting it to live traffic. Its main-branch trigger also excludes `*.md` and `docs/**`. Do not restore `npx wrangler deploy` in that independent build configuration or add another auto-deploy path. Only `.github/workflows/release-validation.yml` may promote production, because it deploys both `brvin-service` and `parmar-ai` with paired rollback and acceptance.

For an eligible production push:
1. captures the current 100%-traffic deployment versions for both Workers;
2. deploys `brvin-service`;
3. deploys `parmar-ai`;
4. checks the Parmar root and `/health`;
5. verifies the private BRVIN connection and Fatman source readiness;
6. writes a production release manifest containing both Worker deployment/version IDs;
7. rolls back the affected Worker(s) if release acceptance fails;
8. checks health again after rollback.

The workflow refuses to start deployment if it cannot capture safe rollback targets.

A manually dispatched `workflow_dispatch` run performs credential preflight and verifies live production acceptance without deploying.

### Local validation

~~~sh
npm run check
npm test
npm run test:node
npx wrangler deploy --config wrangler.brvin.jsonc --dry-run
npx wrangler deploy --dry-run
~~~

Never deploy only one side of the binding relationship casually. The private retrieval Worker and its caller must agree on the entrypoint, method shape, project identity and result contract.

## 13. Scheduled operations

The `parmar-ai` Worker has a five-minute schedule that invokes:
- BRVIN Workflow recovery supervision;
- temporary Vision OCR retention supervision.

The other configured scheduled trigger also performs the existing daily analytics cleanup and Fatman release-QA checks under their respective conditions.

If scheduled work appears stuck:
- inspect D1 job state and Workflow instance ID;
- inspect activity events for the last successful phase;
- inspect Workflow status;
- check the five-minute supervisor's Worker logs;
- use the supported resume/retry action when applicable.

Do not create a second independent scheduler or manually run duplicate Workflow IDs without checking idempotency and active job state.

## 14. Security and data-handling checklist

- [ ] Keep `brvin-service` private; do not enable a public route or workers.dev.
- [ ] Keep `parmar-ai` admin endpoints behind admin authentication and same-origin checks.
- [ ] Never accept a project/client identity from a consumer request body.
- [ ] Do not share sources with all projects by default.
- [ ] Treat collection grants as permissions that may cover future books.
- [ ] Do not copy Google, Telegram, GCS or Vertex secrets into the retrieval Worker or consumer app.
- [ ] Do not put the Service Binding in browser/mobile client code.
- [ ] Preserve monthly usage counters and audit/activity events.
- [ ] Use the guarded Workflow deletion path instead of direct storage/index/database deletion.
- [ ] Treat retrieved document text as untrusted evidence in the model prompt.
- [ ] Do not log unnecessary raw PDFs, OCR payloads, student questions or private model context.

## 15. Related reference

- [System Reference](BRVIN_SYSTEM_REFERENCE.md)
- [App Integration Guide](BRVIN_INTEGRATION_GUIDE.md)
- [Private Retrieval API](BRVIN_PRIVATE_RETRIEVAL_API.md)


## 16. D1 query efficiency and manual dashboard refresh

BRVIN Admin, the Main Admin Control Center, Fatman Admin, Fatman Library and the Fatman Monitor use manual refresh only. Each page performs one initial read; administrators use the visible Refresh button when an updated snapshot is needed. No browser polling timer should be reintroduced. Ingestion, OCR, indexing, retries and retention are server-side Workflows and continue independently of browser tabs.

The previous BRVIN Admin overview polled every five seconds. Cloudflare's 6 November D1 query analytics attributed the largest part of the day's `parmar-ai-admin-prod` read volume to two repeated overview queries:
- The source list's correlated per-book lookups for the latest Vision OCR cleanup event (about 3.69 million rows read across 1,161 executions in the reported window).
- The seven-day event summary (about 888 thousand rows read across 1,034 executions in the reported window).

These figures are the observed historical analytics snapshot, not a current live counter. The relevant new partial index is:

```sql
CREATE INDEX IF NOT EXISTS idx_brvin_activity_book_vision_cleanup
  ON brvin_activity_events(book_id, created_at DESC, id DESC)
  WHERE event_type IN ('source.vision_ocr_delete_failed','source.vision_ocr_deleted');
```

It targets the correlated `book_id + event_type + latest created_at` lookup. The index is created idempotently by the existing `ensureAnalyticsSchema` schema bootstrap and was verified in production D1 on 7 November 2026 after release #868. Avoid repeated EXPLAIN/analytics queries during a free-tier cap incident.

### D1 quota incident response

- Do not delete a database to recover rows_read allowance. Database deletion does not refund rows already read in the UTC day.
- Stop dashboard polling first and close unused admin/monitor tabs.
- Avoid repeated manual refreshes while the account is at its daily read cap; D1 can return error 7500 until midnight UTC.
- Keep active production databases: `parmar-ai-admin-prod`, `brvin-teachers-app`, `askmoina-prod`, `askmoina-preview` and `parmar-ai-admin-preview`.
- `askmoina-ops` has no current binding among the eight deployed Workers and no repository code reference was found, but it is **not empty**. A read-only inventory on 7 November found six user tables and 12 user rows: `admin_oauth_states` 0, `admin_sessions` 0, `provider_events` 8, `provider_health` 2, `request_sessions` 2; D1 also maintains `_cf_KV`. Size: 81,920 bytes. A Cloudflare SQL export completed and generated a temporary signed URL, but the dump could not be retrieved into durable backup storage in this session. Do not delete this database until a durable export has been downloaded/stored, the historical provider telemetry is reviewed, and deletion is separately approved.
- The configured Veda production and preview database IDs currently return Cloudflare 404 and are absent from the D1 inventory. Keep this as a resource/configuration discrepancy; do not recreate or repoint either binding without separately reviewing the Veda isolation and migration state.

## 17. Retire the legacy BRVIN Connect provider

The old `BRVIN Connect` GitHub App and Cloudflare OAuth vault belong to the historical Project Factory proposal, not to the current teacher knowledge-management or consumer deployment flow. Current BRVIN Teachers uses its own application/environment Service Bindings; GitHub repository changes and Cloudflare deployments use the separately authorized ChatGPT connections.

The protected **Revoke BRVIN Connect and erase stored credentials** action was deployed in Core release #868. It has not yet been executed; the latest read-only D1 check on 7 November still showed both GitHub and Cloudflare as `connected` with encrypted credential bundles present. It is exposed in **BRVIN Admin → Legacy provider settings** and requires the authenticated administrator to type `UNINSTALL BRVIN CONNECT` exactly. The endpoint also checks same-origin protection. The current remote session did not have the Core Admin session cookie, so it could not invoke this protected action. The connected Cloudflare OAuth integration also lacks the API-token-only `OAuth Client Read` and `OAuth Client Write` permissions; attempting to list the OAuth clients returned HTTP 403. Do not bypass the admin route or manually erase the encrypted credentials before provider-side revocation. When the authorized admin session is available, the action:
1. Verifies the stored GitHub App installation ID/account against GitHub's current installation list and uninstalls only the recorded `ashini-x` installation.
2. Revokes the legacy Cloudflare OAuth refresh/access tokens.
3. Marks the two provider records revoked and erases their encrypted private key/client secret from Core D1.
4. Retains non-secret audit metadata and reports partial failure instead of claiming success.

It does not delete the GitHub App registration or the Cloudflare OAuth client registration. After the protected action reports both providers revoked, finish the account registrations:
- Delete `BRVIN Connect` (`brvin-connect`) from GitHub Developer Settings → GitHub Apps. Verify no other team or system uses the App before deleting the registration.
- Delete the obsolete Cloudflare OAuth client from the account's OAuth client settings only if it was created exclusively for BRVIN Connect and is not shared by another integration.

The legacy OAuth client and App-registration deletion steps remain administrator-console actions; do not confuse uninstalling an App installation with deleting the App registration itself.

The GitHub App registration is owned by the `ashini-x` personal account (`BRVIN Connect`, slug `brvin-connect`, recorded installation `178850001`). GitHub's documented deletion path is **Settings → Developer settings → GitHub Apps → BRVIN Connect → Advanced → Delete GitHub App**; deleting the registration also uninstalls any remaining installations. Confirm the exact app name before accepting GitHub's final deletion prompt. See [GitHub's deletion guide](https://docs.github.com/en/apps/maintaining-github-apps/deleting-a-github-app).

The Cloudflare OAuth client must be identified by its registered redirect URI `https://parmar-ai.thenewtongs.workers.dev/admin/brvin/connect/cloudflare/callback` and the BRVIN Connect name before deletion. The account's Manage Account → OAuth clients page is the UI route. API deletion requires a Cloudflare API token with `OAuth Client Write`; enumeration requires `OAuth Client Read`. The current OAuth connector does not satisfy either requirement. See [Cloudflare OAuth Clients API](https://developers.cloudflare.com/api/resources/iam/subresources/oauth_clients/) and [OAuth client setup](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/).


## 18. BRVIN Teachers pilot OCR-output diagnosis

For the failed BRVIN Teachers Physics source, use the authenticated read-only endpoint `GET /admin/api/brvin/status?id=cbe1dc5d-ac02-4809-ac18-7e00ac305c96`. Its `pipeline.vision` object includes the Vision operation's reported `outputDestinations`, the registered `expectedOutputUri`, and the bounded object list under that prefix. The endpoint requires the same Core Admin session as `/admin/brvin`. Compare those values before any resume or new OCR operation; do not upload the PDF again.


## 12. Full imported-PDF deletion: pagination, retries and live progress

Full deletion is a source-scoped Cloudflare Workflow. The operator action is available for imported PDF records in `ready`, `failed`, `completed`, `archived` and `delete_failed` states. It first reserves the source as `deleting`, then removes only the matching book's AI Search page items, private source-PDF object generations, temporary Vision OCR object generations, direct project-book grants, and paired BRVIN/Fatman import registry rows. Project and collection definitions, the application-project grant, teacher metadata and activity/audit history are preserved.

**AI Search pagination must stay at or below 50 items per page.** The provider rejects `per_page=100` with `AiSearchError: Too big: expected number to be <=50`. Both the initial prefix-scoped inventory and the post-delete verification use the shared `BRVIN_DELETION_SEARCH_PAGE_SIZE=50` request helper. Deletion still proceeds in bounded batches of 25, and every candidate key is checked against the exact source-specific `search_prefix` before deletion.

The workflow writes an append-only `book.deletion_progress` activity event as work advances. The Core Admin Books table and Live pipelines view read the latest event and display its server-computed percentage, phase, message and failed state. The weighted progress bands are:
- inventory 0–5%;
- indexed AI Search removal 5–60%;
- zero-remaining verification 60–65%;
- private source-PDF object generations 65–80%;
- temporary Vision OCR object generations 80–95%;
- D1 grant/registry cleanup 95–99%;
- 100% only after registry rows are verified removed.

GCS progress counts object generations processed and successfully deleted. A 404 means an object generation has already disappeared and counts as processed. The final GCS result still reports soft-delete retention and hard-delete times: 100% means the source is removed from active GCS listings, AI Search and BRVIN registry, not that Google Cloud soft-delete recovery retention has elapsed.

If the workflow fails, the source and import rows remain inaccessible with `delete_failed`, the last completed percentage is retained, and the exact error is displayed in red. The operator can use **Manage → Retry deletion** after correcting the cause. Retries re-inventory the source prefix and remaining GCS object generations; already-removed AI Search items and GCS generations are not treated as fatal missing objects. Do not manually delete D1 rows or issue a broad AI Search/GCS prefix delete.


The Core Admin dashboard refreshes the overview every 5 seconds only while at least one book is in `deleting`. It backs off to 15 seconds while the browser tab is hidden, refreshes promptly when the tab becomes visible, and stops polling when all deletions become terminal (`delete_failed` or removed). There is no permanent 5-second polling loop when no deletion is active.


## 13. BRVIN ingestion throughput and cost policy

The BRVIN page-indexing workflow uses Cloudflare AI Search's asynchronous Items API. `items.upload()` returns after the item is accepted/queued; completion is confirmed later from the source-scoped item status inventory. Do not equate successful upload submission with indexed/searchable content.

### BRVIN Teachers page-count detection and page map

- Collection-scoped `brvin-collection:` PDF registrations store page count `0` as an explicit not-yet-detected sentinel. The consumer does not submit a page count.
- After Google Vision reports completion, Core inventories the isolated per-page JSON output prefix. The Vision request uses `batchSize=1`, so the inventory must contain exactly one `output-N-to-N.json` file for every consecutive page from 1 through N.
- Core rejects a truncated inventory, duplicates, unexpected filenames, gaps, out-of-prefix objects, zero pages and counts above 2,000. It then persists the verified count to the paired import, library and BRVIN book rows and confirms all three records agree before page indexing begins.
- Legacy non-collection imports keep their existing page-count behavior, including the historical 538-page Fatman path. The frozen retrieval RPC v2 contract is unchanged.
- Each existing source-monitor pass also stores a compact `pageStateMap` in its normal activity event (`c/r/q/e/m` = completed/running/queued/error/missing). The consumer popup renders this saved snapshot and does not issue extra AI Search status scans on its own refresh timer.
- This behavior is live following Core release [#888](https://github.com/ashini-x/parmar-ai/actions/runs/42417392419), with `parmar-ai` version `5eead825-46cb-4122-a351-634865696142` and `brvin-service` version `5ad1f448-1700-4e06-abdc-0b39287b89b8` at 100% traffic. BRVIN Teachers release [#42417513862](https://github.com/ashini-x/brvin-teachers/actions/runs/42417513862) consumes the saved map inside the existing scrollable progress dialog.
### Page submission
- Submit a maximum of **3 PDF pages concurrently** using independent, deterministic Cloudflare Workflow steps.
- Keep Workflow page chunks at the existing maximum of 8 pages and split them into ordered batches of 3. This provides bounded parallel throughput without flooding the shared AI Search instance.
- Each page remains independently retryable and idempotent by its immutable BRVIN page key. On resume/retry, the existing exact-key lookup is performed before a new item is uploaded.
- Each page step uses a short bounded automatic retry (2 retries, 2-second exponential delay). If a provider/network error remains transient, the workflow records it and leaves the missing page to the source monitor/recovery path. Permanent input or configuration errors still fail immediately.
- Repair chunks use the same concurrency limit and idempotency contract.

### Monitoring
Use one source-scoped status monitor rather than calling `uploadAndPoll()` independently for every page. Cloudflare's per-item `uploadAndPoll()` default is a one-second polling interval. Per-page pollers multiply status requests with PDF page count; the shared monitor scans the source prefix once per pass and can identify missing, queued, running, completed and failed pages together.

The polling cadence is size-aware because an AI Search Items list supports at most 50 results per call:
- up to 10 pages: first check after 15 seconds, then every 30 seconds;
- 11–100 pages: first check after 30 seconds, then every 45 seconds;
- more than 100 pages: first check after 45 seconds, then every 60 seconds.

This reduces idle time for small teacher PDFs without making large-book monitoring issue frequent multi-page inventory scans. The monitor persists exact completed-page counts and does not infer completion from upload submission.

Concurrency remains fixed at 3 after this release. The deployment did not run a provider-backed comparison against 4, 6 or 8: the existing Physics pilot stopped before indexing because its Vision output was missing, and no separate staging AI Search resource was available for controlled testing. No concurrency increase or live benchmark is claimed. No representative, provider-backed comparison against 4, 6 or 8 is recorded for the shared production AI Search instance. Do not raise the limit based on synthetic timing alone. The existing pilot source stopped before indexing because its expected Vision output was missing, so it cannot be reused as a valid indexing benchmark without another OCR operation. Run any higher-concurrency comparison on a separate staging AI Search instance with representative small, medium and large PDFs; record end-to-end READY time, page submit attempts, throttles, retries, AI Search inventory calls, and retrieval QA/provenance results. Increase the production limit only if 4/6/8 is measurably faster without extra throttling, retry amplification, duplicate keys or any QA regression.

### Retrieval QA
- Start page-grounded retrieval QA immediately after the monitor confirms every expected item has status `completed` and no item is failed.
- Do not add a fixed one-minute post-index sleep. The QA queries themselves verify search visibility. If the search result is temporarily not visible, the existing durable QA retry path applies bounded backoff (30 seconds up to 15 minutes).
- Preserve the current page-grounded verification rules, sampled-page coverage, distinctive OCR probes, provenance checks and READY gate. Do not reduce QA coverage to improve a stopwatch result.
- Use the production AI Search default top-10 result window for QA rather than requesting 50 chunks. This keeps the QA retrieval envelope aligned with normal consumer search and avoids returning excess chunks; distinctive OCR probes and retry-on-miss preserve page-provenance verification.
- Keep one Vision OCR operation for the PDF and reuse its stored outputs for page indexing; never perform another OCR operation as an indexing retry.

### Why not use per-item polling?
Cloudflare documents that `items.uploadAndPoll()` polls the item until indexing completes (default 1-second polling). This is useful when a single document must be searchable immediately. BRVIN is a multi-page asynchronous ingestion workflow; a source-scoped durable monitor is more efficient because it observes all pages together and avoids a separate high-frequency poller for every page.

### Acceptance and measurement
Benchmark representative small (1–10 page), medium (11–100 page) and large (>100 page) PDFs using:
- PDF upload completion;
- Vision operation completion and output verification;
- page submission completion;
- first/last page becoming `completed` in AI Search;
- retrieval-QA start/pass;
- total time from upload completion to READY;
- AI Search list calls, page upload attempts, retry counts and QA query count.

A faster result is accepted only if all expected pages reach `completed`, retrieval QA passes with the original PDF-page provenance, no duplicate page keys are created, and READY remains gated on successful QA.


## 14. Verified production rollout of indexing optimization

- Core performance PR: [#131](https://github.com/ashini-x/parmar-ai/pull/131), merge SHA `920f94749f3174420160942670f4b81b583ae3c2`.
- Paired release: [GitHub Actions #42411000687](https://github.com/ashini-x/parmar-ai/actions/runs/42411000687); typecheck/tests/build, deployment, first-attempt health smoke and production release acceptance all passed.
- `parmar-ai`: version `fa5f5fd4-eb77-4d0c-ad07-cd8255b214f2`, deployment `70c15041-c41a-4ed4-9986-673653b6bb0e`, 100% traffic.
- `brvin-service`: version `0abbe7e6-3a7d-4e34-8f46-321f12796d58`, deployment `4cc87836-634e-4b61-9ee8-4d3859df838d`, 100% traffic.
- The optimization applies to future ingestion runs. Do not re-upload or re-index existing READY sources just to activate it.
- Benchmark the next representative uploads against the prior Newton pilot baseline (about 6m45s from PDF source registration to READY in the previous production run). Record stage timings, page counts, list calls, page submission retries and QA query counts. This is a baseline, not a guaranteed target; AI Search's service-side indexing latency remains external to BRVIN.
