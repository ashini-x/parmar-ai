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

A push to `main` runs validation and then:
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
