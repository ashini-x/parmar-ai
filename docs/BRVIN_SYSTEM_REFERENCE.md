# BRVIN System Reference

**Status:** As-built architecture and operating contract  
**Last verified against source and production infrastructure:** 5 November 2026  
**Owning repository:** `ashini-x/parmar-ai`  
**Related consumer repository checked:** `ashini-x/askmoina-voice`

This is the canonical technical reference for BRVIN. It records what exists in code and production, where the important pieces live, how trust and knowledge access work, and which future integrations are not yet implemented. It is intended to prevent repeated repository and Cloudflare audits for ordinary design discussions.

When a future change alters code, D1 schema, bindings, access rules, ingestion, retrieval, deployment, or integrations, update this document and the relevant specialist document in the same change. Do not silently treat a planned feature as already shipped.

> **BRVIN 2 implementation and chat continuity:** see [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md) first, then read [BRVIN_AUTONOMOUS_PROJECT_FACTORY.md](BRVIN_AUTONOMOUS_PROJECT_FACTORY.md) in full. M0–M5 are implemented. The original M6 Connect Application wizard is merged and deployed in the parmar-ai admin Worker (PR #75, merge 7ee4b58320ba457ac2ac94651ad872fd0b937445), but it is a narrow first adapter, not the final autonomous administrator/Project Factory. On 5 November 2026 the user approved a broader goal: administrator-level GitHub/Cloudflare technical authority, automatic credential and secret provisioning, independent GitHub repository creation for each software project, and autonomous build/test/deploy/verification. The revised first incomplete milestone is M6 — Delegated Provider Administration & Credential Lifecycle. The independent brvin-test-client scaffold in askmoina-voice is historical only; PR #385 is superseded and must not be merged. The new acceptance app must be generated in its own repository by the Project Factory. This document remains an as-built reference: future Project Factory features are planned, not shipped, until the implementation ledger records evidence. Existing AskMoina Voice remains optional and its runtime must not be modified for BRVIN acceptance.

## Project Factory direction update — 5 November 2026

The canonical target now includes BRVIN's autonomous technical-administrator and software Project Factory role. The user has approved administrator-level GitHub and Cloudflare authority for BRVIN to create repositories, provision developer infrastructure, manage credentials/secrets, build/test/repair/deploy applications and verify them with dashboard-level oversight. See [BRVIN_AUTONOMOUS_PROJECT_FACTORY.md](BRVIN_AUTONOMOUS_PROJECT_FACTORY.md) for the approved target architecture and acceptance gates. This is a forward design decision, not a statement that those capabilities already exist in production. The current as-built system below remains authoritative for what is actually deployed.

## 1. Executive architecture

BRVIN is a shared, project-scoped knowledge and retrieval layer. Multiple applications can use the same indexed knowledge corpus while receiving only the documents explicitly granted to their project.

The current architecture deliberately separates **knowledge administration and ingestion** from **private application retrieval**:

- The existing `parmar-ai` Worker owns the protected BRVIN admin workspace, upload gateway, Google Cloud upload/OCR orchestration, Cloudflare Workflow, D1 registration, access grants, and release verification.
- A second Worker, `brvin-service`, is the private retrieval boundary. Consumer Workers call it with Cloudflare Service Binding RPC. Legacy v1 methods resolve `ctx.props.clientId` to a single project; v2 methods resolve `ctx.props.applicationEnvironmentId` to an application, then verify its active grant for the requested project. Both paths check D1 source grants, search only authorised folders, and validate returned page keys again.
- The application that called BRVIN remains responsible for its own model, prompt, conversation state, tool/function-call handling, response formatting, and user delivery. BRVIN returns evidence; it does not generate the final answer.
- A historical text-only reference-client scaffold exists as a separate Worker in `ashini-x/askmoina-voice`. It does not share the AskMoina Voice runtime or production state. It was designed to use its own app/environment identity, isolated test-project grant, tester token and Worker deployment. It is not deployed or connected, PR #385 is superseded, and it is not the Project Factory acceptance application.

### High-level flow

~~~text
ADMIN / INGESTION PLANE
Admin browser
    |
    | protected same-origin admin requests
    v
parmar-ai Worker
    |-- BRVIN admin UI and governance APIs
    |-- D1 registry, grants, jobs and activity log
    |-- resumable private Google Cloud Storage upload
    |-- Google Vision OCR
    |-- Cloudflare Workflow: indexing, recovery, QA, cleanup
    |-- shared Cloudflare AI Search index
    |
    +-----------------------------------------------------+
                                                          |
                                                          v
                                               Shared indexed pages


PRIVATE RETRIEVAL PLANE
Consumer Worker (currently parmar-ai / Fatman)
    |
    | Cloudflare Service Binding RPC
    | trusted v1 props.clientId / v2 props.applicationEnvironmentId; no request-supplied identity
    v
brvin-service (private Worker)
    |-- resolve client -> active project in D1
    |-- resolve ready books through direct/collection grants
    |-- search only the authorised AI Search folder prefixes
    |-- validate each result key against the grant set
    |-- enforce monthly per-project usage cap
    |
    v
Validated passages + book/page provenance
    |
    v
Consumer application's own Gemini/LLM prompt and answer
~~~

The two planes share the existing D1 registry and AI Search namespace. They do not create a database or index per app.

## 1.1 BRVIN 2 production state (5 November 2026 — after M6 wizard release)

- M1 added `brvin_applications`, `brvin_application_environments` and `brvin_application_project_grants` to the existing shared D1. The Parmar AI production application/environment and explicit Fatman project grant are seeded and active.
- M2 added `listAuthorizedProjectsV2()`, `getProjectStatusV2(input)` and `retrieveProjectContextV2(input)` to the private `BrvinRetrievalApi` entrypoint. V1 methods remain available.
- Parmar AI production carries both `clientId: fatman` and the generated production `applicationEnvironmentId`. `/health` checks v1/v2 Fatman readiness and source-count parity.
- Latest paired production release after M6 merge: `brvin-service` `f1ae2248-a5af-415e-8f7c-6dd6fd4d8d24` and `parmar-ai` `0828f742-0018-448c-a2ec-aa4bc97bea19`, each at 100% traffic. Release Validation #41915083328 and paired production acceptance #41915231086 passed; acceptance artifact `13363568373` records the release.
- End-user Fatman retrieval remains on v1. AskMoina Voice's v2 binding and Gemini Live connector/tool integration are deployed as an optional pilot. Do not make its camera/audio acceptance a BRVIN milestone gate.
- M4's independent reference-client scaffold is merged as `brvin-test-client` in the AskMoina repository (PR #381, merge `bf8e5a1e9fe7f451ad31430143ab52aaf801214e`). It has a text-only UI, tester-token gate, server-side v2 connector calls, separate Wrangler/TypeScript config and mock-backed acceptance tests.
- M6's Connect Application wizard is now deployed in the BRVIN admin workspace. It supports a fixed first adapter to the independent text Worker, requests narrow GitHub/Cloudflare authorization, creates a reviewable config PR, and does not merge or deploy that PR itself. It refuses to reuse the existing `askmoina-voice` or `parmar-ai` application identities. Live identity verification is an authenticated `/api/projects` call through the test Worker; Cloudflare's Worker settings API does not expose binding props.
- M6 is still in progress at the user-onboarding boundary. The Cloudflare account currently has no `brvin-test-client` Worker. Production D1 now contains the schema-on-demand tables `brvin_provider_connections`, `brvin_oauth_states` and `brvin_connection_events`, but there are no provider connection records and no dedicated `brvin-text-test-client` application, environment or project grant. The existing app/project/grant rows remain unchanged. The separate GitHub Actions secret `BRVIN_TEST_CLOUDFLARE_API_TOKEN` is not yet configured.
- The next live steps are admin GitHub App installation, Cloudflare OAuth authorization, registration of the isolated test identity, addition of the dedicated deployment secret, creation/review/merge of the generated Service Binding PR, separate text Worker deployment, and a successful real text retrieval test. M7 owns broader multi-app/project acceptance.
## 2. Architecture decisions that must remain stable

1. **One shared registry:** use the existing BRVIN tables in the shared D1 database. Do not create one D1 database per project or consumer app.
2. **One shared search resource:** projects share the existing Cloudflare AI Search instance and namespace. Do not create a new AI Search instance for every app or project.
3. **Project-level authorisation:** a project sees only ready sources granted directly or through a collection.
4. **Private retrieval Worker:** keep `brvin-service` without a public route and with `workers_dev: false`. Consumer Workers in the same Cloudflare account use Service Bindings.
5. **Identity is deployment-controlled:** the consumer does not send a project ID or client ID in a retrieval request. Cloudflare Service Binding properties provide the trusted client ID through `ctx.props`.
6. **Fail closed:** an unknown client, inactive project, missing grant, unsafe prefix, or failed retrieval must never fall back to an unfiltered search.
7. **No duplicated ingestion:** keep the existing upload/OCR/indexing pipeline. A consumer app must not re-upload or OCR the same book just to connect to BRVIN.
8. **Model ownership stays with the app:** BRVIN returns passages and provenance. The consumer app decides how to use those passages with Gemini or another model.
9. **Binding does not equal integration:** adding a Wrangler Service Binding only makes the RPC available. The app still needs a small typed adapter/tool handler that calls retrieval and supplies the returned evidence to its model.
10. **No cross-account shortcut:** Cloudflare Service Binding is an internal same-account mechanism. A consumer Worker in another Cloudflare account needs a separate authenticated gateway; that gateway is not currently implemented.

## 3. Runtime and infrastructure inventory

| Resource | Current responsibility | Configuration / source of truth |
|---|---|---|
| Cloudflare Worker `parmar-ai` | Admin, upload gateway, Fatman/Parmar application, workflow orchestration, production health | `wrangler.jsonc`, `src/index.ts` |
| Cloudflare Worker `brvin-service` | Private project-scoped retrieval RPC | `wrangler.brvin.jsonc`, `src/brvin/service-worker.ts` |
| D1 database `parmar-ai-admin-prod` | Shared admin/analytics data plus BRVIN registry, grants, usage and activity | D1 binding `DB`; schema in `src/analytics/db.ts` |
| Cloudflare AI Search | Shared indexed knowledge pages | Namespace binding `BRVIN_SEARCH` in retrieval Worker; existing instance configured by `BRVIN_SEARCH_INSTANCE` |
| Cloudflare Workflow | Long-running import/index/repair/delete/recovery tasks | Workflow binding `FATMAN_IMPORT`, class `FatmanImportWorkflow` in `src/fatman/workflow.ts` |
| Google Cloud Storage | Private source PDF and temporary OCR output storage | `FATMAN_GCS_BUCKET` and helpers in `src/fatman/import.ts` |
| Google Cloud Vision | Document OCR for uploaded PDFs | Google service-account configuration used by `parmar-ai` |
| GitHub Actions | Typecheck, tests, dry-runs, paired deployment, smoke checks, rollback and release manifest | `.github/workflows/release-validation.yml` |

### 3.1 The two Wrangler configurations

**`wrangler.jsonc` — `parmar-ai`**

This is the existing application/admin Worker. BRVIN-relevant bindings include:

- D1 binding `DB` to `parmar-ai-admin-prod`.
- Existing AI Search namespace binding `FATMAN_SEARCH` for ingestion, legacy Fatman paths and admin/QA functions.
- Workflow binding `FATMAN_IMPORT` to `FatmanImportWorkflow`.
- Service Binding `BRVIN_SERVICE` to service `brvin-service`, entrypoint `BrvinRetrievalApi`, with the legacy v1 `props.clientId: "fatman"` and the seeded Parmar AI production `props.applicationEnvironmentId`. V1 methods continue to resolve only the legacy client ID; v2 methods resolve only the trusted environment ID.

The `fatman` property means this Worker is acting as the Fatman consumer project. It does not give all applications Fatman's permissions.

**`wrangler.brvin.jsonc` — `brvin-service`**

This is the dedicated retrieval Worker. Its relevant settings are:

- `name: "brvin-service"`.
- `workers_dev: false`.
- D1 binding `DB` to the shared `parmar-ai-admin-prod` database.
- AI Search binding `BRVIN_SEARCH` to the existing `default` namespace.
- `BRVIN_SEARCH_INSTANCE: "fatman-2026-8b183803"`.
- `BRVIN_MIN_SCORE: "0.2"`.
- `BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT: "800"`.
- `ENVIRONMENT: "production"`.

The current AI Search instance name contains “fatman” because it is the already-populated shared resource. This does not mean the retrieval service is limited to the Fatman project. Do not rename or recreate the index just to change the label; existing pages are in that resource.

The private Worker does **not** need Telegram, Gemini/Vertex, Google Vision, GCS upload or Google service-account secrets. Do not copy these application secrets into `brvin-service`.

### 3.2 Legacy Fatman naming is intentional for now

Some generic ingestion and Workflow code remains under `src/fatman/`, with names such as:

- `FATMAN_IMPORT`
- `FatmanImportWorkflow`
- `FATMAN_SEARCH`
- `FATMAN_GCS_BUCKET`
- `FATMAN_INSTANCE_NAME`

Those names are a migration-era implementation detail. The BRVIN retrieval service itself uses BRVIN-owned names such as `BRVIN_SEARCH`, `BRVIN_SEARCH_INSTANCE`, `BRVIN_MIN_SCORE`, and `BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT`.

Do not assume the importer has already been renamed or moved into a separate BRVIN Worker. It has not. Do not copy the old Fatman-only state machine or credentials into a new consumer app.

## 4. Source-code map

| Path | Responsibility |
|---|---|
| `src/brvin/admin.ts` | BRVIN admin dashboard, overview, project/collection creation, source registration, assignments, archive/delete controls, activity display |
| `src/brvin/retrieval.ts` | Project source resolution, prefix validation, exact-page lookup, hybrid search, passage validation and formatting |
| `src/brvin/service-core.ts` | Trusted client resolution, monthly quota reservation, status and retrieval RPC orchestration |
| `src/brvin/service-worker.ts` | `WorkerEntrypoint` implementation, `ctx.props` identity extraction, default HTTP 404 response |
| `src/analytics/db.ts` | Shared schema creation, BRVIN migration/compatibility logic, project/book/collection/grant/usage/activity tables |
| `src/fatman/import.ts` | Reusable resumable GCS upload, Vision operation handling, import status, storage helpers |
| `src/fatman/workflow.ts` | Background import, OCR, page indexing, retries/repair, quality checks, test probes, source and OCR deletion, recovery |
| `src/config/env.ts` | Worker environment types, AI Search binding contracts, BRVIN RPC result and binding types |
| `src/index.ts` | HTTP routing, admin authentication, BRVIN admin route dispatch, health check, scheduled recovery/retention |
| `wrangler.jsonc` | Parmar application/admin Worker bindings |
| `wrangler.brvin.jsonc` | Private BRVIN retrieval Worker bindings and configuration |
| `test/brvin-service.test.ts` | Private service identity, retrieval and authorisation tests |
| `test/brvin.test.ts` | BRVIN retrieval and source-filtering tests |
| `test/brvin-admin-script.node.test.ts` | Admin surface, book lifecycle and regression guard tests |
| `scripts/production-smoke-test.mjs` | Production root and BRVIN-backed health check |
| `.github/workflows/release-validation.yml` | CI, dry-runs, deployment order, smoke test, acceptance manifest and rollback |

Useful starting points for a future engineer:

- To change who can read a book, inspect `src/brvin/retrieval.ts` and the grant handlers in `src/brvin/admin.ts`.
- To change the trusted caller identity, inspect `src/brvin/service-worker.ts`, `src/brvin/service-core.ts`, and the consumer's Service Binding props.
- To change PDF ingestion or background recovery, inspect `src/fatman/import.ts`, `src/fatman/workflow.ts`, and the workflow binding in `wrangler.jsonc`.
- To change the database schema, inspect `src/analytics/db.ts` and its idempotent schema/migration functions before editing a table.
- To change production rollout behavior, inspect the GitHub Actions workflow and smoke/acceptance scripts before touching Worker deployment settings.

## 5. D1 registry and data model

The BRVIN schema is created and compatibility-managed by `ensureAnalyticsSchema()` in `src/analytics/db.ts`. It is part of the existing application D1 database, not a standalone database.

| Table | Meaning |
|---|---|
| `brvin_projects` | One logical consumer/application project. Stores UUID, display name, unique slug, description and active/inactive status. |
| `brvin_collections` | Named reusable grouping of knowledge sources. |
| `brvin_books` | One registered source. Includes title, filename, SHA-256, expected size, page count, processing status, indexed page count, collection, search prefix, source type and timestamps. |
| `brvin_project_books` | Direct project-to-book grants. |
| `brvin_project_collections` | Project-to-collection grants. A project can retrieve ready books in a granted collection. |
| `brvin_service_clients` | Maps trusted Worker client IDs to projects. |
| `brvin_project_search_usage` | Monthly query counter for non-Fatman projects, keyed by project and billing month. |
| `brvin_activity_events` | Append-style audit/activity trail for ingestion, governance, Workflow and deletion phases. |
| `brvin_migrations` | Idempotent migration markers and compatibility state. |

The legacy `fatman_search_usage` table remains in use for the Fatman project so the existing Fatman usage counter is preserved. Do not reset or delete it when changing BRVIN project permissions.

### 5.1 Project identity is created automatically

When an administrator creates a project through the BRVIN dashboard:

1. The project name is normalized.
2. A slug is generated from the name using lowercase ASCII letters, digits and hyphens, capped at 64 characters.
3. A UUID is generated for the internal project ID.
4. The project row and default service-client mapping are inserted in one D1 batch.
5. The slug is also the default `client_id`.
6. An activity event is recorded.

For example, a project named “AskMoina” normally receives:

- Internal project ID: a generated UUID.
- Project slug: `askmoina`.
- Default client ID: `askmoina`.

The admin does not have to invent or manually type the UUID or client ID. Slugs must be unique. A collision will fail project creation and should be resolved by using a distinct project name. Names that do not normalize to a valid ASCII slug are rejected by the current slug generator.

**Important:** a client ID is not a password, API token, or cryptographic credential. It is the identity label that trusted deployment configuration supplies through a Service Binding's `props`. It must not be treated as a secret bearer token.

Creating a project does **not** automatically grant knowledge, create the consumer's Service Binding, modify another repository, or add a retrieval call to the consumer's model flow. Those are separate steps.

### 5.2 Grant semantics

A project can receive a source in two ways:

- **Direct grant:** a row in `brvin_project_books` grants a specific book.
- **Collection grant:** a row in `brvin_project_collections` grants the collection; all currently ready books in that collection become eligible.

A source is not globally readable merely because it exists in BRVIN. The retrieval service resolves sources only when all of the following are true:

- the client ID maps to a known project;
- the project is active;
- the source is in `ready` state;
- `indexed_pages = page_count`;
- the project has a direct book grant or a grant to that source's collection.

Collection grants are intentionally reusable. A new book uploaded into a collection already granted to a project can become accessible after it reaches the ready state. This is why collection assignment should be treated as a meaningful permission decision, not just a label.

Removing a direct grant or collection grant changes the source set used by future retrievals. The service re-reads grants from D1; access is not embedded permanently into an app's configuration.

### 5.3 Important source fields

- `id`: internal book/source identity.
- `source_type`: distinguishes imported PDFs from protected built-in/legacy sources.
- `status`: pipeline and availability state.
- `page_count` and `indexed_pages`: completeness check.
- `collection_id`: collection membership.
- `search_prefix`: authoritative folder prefix for this book's page items in AI Search.
- `source_sha256` and `expected_size`: upload identity/fingerprint and expected file length.
- `vision_output_deleted_at` and `vision_output_deletion_started_at`: state for optional OCR-output-only cleanup.

The D1 `search_prefix` is the authoritative relationship between a granted source and its indexed pages. Do not let a consumer choose an arbitrary folder or AI Search filter.

## 6. Retrieval trust boundary

The private service entrypoint is `BrvinRetrievalApi`, implemented by `BrvinRetrievalApi extends WorkerEntrypoint` in `src/brvin/service-worker.ts`.

The binding's configured properties are available as `this.ctx.props`. The service reads the client ID from `this.ctx.props.clientId`; it does not accept a caller-supplied project ID or client ID as part of the retrieval input.

The trust and retrieval sequence is:

1. Normalize and validate the trusted client ID.
2. Resolve `brvin_service_clients.client_id` to a project in D1.
3. Require the project to be active.
4. Resolve eligible books through direct and collection grants.
5. Require every eligible source to be ready and completely indexed.
6. Validate each source's search prefix before using it.
7. Search AI Search with a folder filter limited to the authorised prefix set.
8. Validate each returned page item's key against those same prefixes and the expected page-key format.
9. Check the parsed book/page identity and relevance threshold.
10. Return a bounded set of passages with provenance.

This is defence in depth: the search filter limits the corpus before retrieval, and the post-search key validation rejects anything outside the D1-authorised source set.

Unknown callers, inactive projects, empty grants, invalid prefixes and failures must not trigger an unfiltered or global query.

### 6.1 Search behavior and result bounds

Current code bounds retrieval to:

- Up to 3 unique query variants.
- Up to 2,000 characters per query after normalization.
- Up to 3 explicit PDF page numbers per request.
- Hybrid retrieval, up to 50 candidate chunks per query.
- A bounded response of up to 8 passages and bounded excerpt text.
- A configurable minimum relevance score, currently 0.2.
- Exact page lookup before semantic fallback when page numbers are supplied.

An exact page request is resolved under authorised source prefixes and the exact returned key/page is checked. Where supported and available, the exact-page path can return a bounded page image as well as text. If no exact page item is available and a textual query was also supplied, the service can fall back to semantic retrieval over the authorised sources.

These limits protect Worker memory, response size and search cost. Raise them only with tests and explicit capacity review.

### 6.2 Usage allowance

The current configured monthly query allowance is 800 per project. The code caps the maximum accepted configuration at 800, even if a higher value is supplied. The quota is reserved in D1 before retrieval.

- Fatman's counter remains in `fatman_search_usage` for compatibility.
- Other projects use `brvin_project_search_usage` keyed by project ID and month.
- The service returns a structured `MONTHLY_LIMIT_REACHED` failure when the allowance is exhausted.

The allowance is a service-side retrieval limit, not a replacement for the consumer application's own user-level quota, billing or rate limiting.

## 7. Private RPC contract

The RPC contract is documented in detail in [BRVIN_PRIVATE_RETRIEVAL_API.md](BRVIN_PRIVATE_RETRIEVAL_API.md). The two methods currently exposed are:

- `getProjectStatus()`: confirms that the caller identity maps to an active project and returns readiness plus the number of authorised ready sources. It does not return document text.
- `retrieveProjectContext({ queries, pageNumbers? })`: returns bounded, validated passages and optional exact-page images for the caller's granted sources.

Successful passages include source identity and citation provenance: book ID, book title, PDF page number, optional printed page/section, text and score. Consumers should preserve this provenance to support page citations in the final answer.

The default HTTP `fetch()` handler returns 404. The Worker is intended for internal RPC, not direct public HTTP use.

## 8. Ingestion and knowledge lifecycle

The current ingestion implementation is reusable but still lives in Fatman-named modules and uses the existing Worker/Workflow configuration.

### 8.1 Upload and registration

The protected BRVIN dashboard supports PDF upload. The server validates the submitted metadata, including:

- a SHA-256 fingerprint in 64-character hexadecimal form;
- file size from 8 bytes up to 1 GB;
- page count from 1 to 2,000;
- a title and safe filename;
- explicit confirmation that Google Cloud OCR may incur usage charges.

The browser uses a resumable upload path to private Google Cloud Storage. The Worker records the upload/import job in D1 and supports chunk upload, resume and completion. The BRVIN gateway then registers the book, collection membership and selected direct project grants. A new source is not automatically visible to every project.

### 8.2 Background processing

The background `FatmanImportWorkflow` coordinates long-running tasks. Its task vocabulary includes resume/index work, index chunks, repair chunks, cleanup chunks, monitoring, page retry, quality checks, release QA, retrieval probes, book deletion and OCR-output deletion.

At a high level, a normal import does the following:

1. Verify that the complete private upload exists and matches the expected byte size.
2. Submit the PDF for Google Vision Document Text Detection.
3. Track the long-running OCR operation and persist progress.
4. Process the OCR result into page-level text/evidence.
5. Index page items into the shared Cloudflare AI Search instance using the book's registered search prefix.
6. Verify indexed page coverage and run the applicable quality/retrieval checks.
7. Mark the source ready only when the required page set is complete.

D1 holds operational state and progress pointers; the PDF and temporary OCR payloads live in private GCS; the searchable page items live in AI Search. These are three different storage roles.

### 8.3 Readiness

A book is eligible for retrieval only when its D1 state is `ready` and its indexed page count equals its declared page count. Partial imports and failed/archived/deleting books are not eligible.

Do not mark a book ready manually just because OCR returned successfully. Completion means the page set has been indexed and the source can be retrieved within its authorised project boundary.

### 8.4 Recovery and retention

The `parmar-ai` Worker has a five-minute scheduled task that runs BRVIN recovery supervision and temporary Vision OCR retention supervision. Workflow IDs and progress are recorded so jobs can be inspected and resumed where supported.

Temporary Vision OCR output is eligible for cleanup under the 30-day retention policy. OCR-output-only deletion removes the temporary Vision OCR JSON objects but deliberately preserves the original PDF and the already-indexed page items. Full imported-book deletion is a separate destructive lifecycle.

### 8.5 Archive and deletion

Archiving a source is a governance/availability action; archived sources are not returned by the ready-source resolver.

Full deletion applies to imported PDF sources only. The Workflow validates the source type and exact expected search/storage prefixes, inventories and deletes only that source's AI Search items, verifies that the items are gone, removes the private source/OCR objects, then removes the book/job rows and project grants. The activity history and project/collection definitions remain.

The built-in reviewed Fatman source is protected from the imported-PDF deletion path. The admin's “clear imported books” control does not delete the built-in source or project/collection definitions.

## 9. BRVIN admin workspace

The protected admin workspace is served by the existing `parmar-ai` Worker:

- UI: `/admin/brvin`.
- Same-origin dashboard script: `/admin/brvin/app.js`.
- API root: `/admin/api/brvin/*`.

The old `/admin/vrain` page path redirects to `/admin/brvin`; the old API prefix is normalized to the BRVIN route. These are compatibility details, not the preferred new path.

The current workspace includes:

- **Overview:** source, collection, project and indexed-page metrics; active/failed jobs; recent activity.
- **Knowledge/library management:** PDF upload, collection selection, optional direct project assignment, per-source progress, pipeline inspection, archive and deletion controls.
- **Governance:** project and collection creation, direct book grants and project-to-collection grants.

Administrative APIs are protected by the existing admin authentication and POST requests are checked for same-origin use. Do not expose these routes as an unauthenticated public integration API.

### 9.1 Current capabilities versus the future wizard

Project creation already auto-generates project UUID, slug and default client ID. The current dashboard does **not** yet provide a complete Connect Application wizard that edits another repository's Wrangler config, installs an app-side adapter, or validates an external application's model tool handler.

The admin interface can govern BRVIN identity and knowledge grants. Application integration still requires a one-time consumer-side configuration and code adapter unless a future guided automation implements that work.

## 10. Consumer application integration

### 10.1 Same-account Cloudflare Worker

For an application Worker in the same Cloudflare account:

1. Create a BRVIN project in the admin dashboard.
2. Grant the required books or collections.
3. Add a Service Binding in the consumer Worker's Wrangler config pointing to `brvin-service`, entrypoint `BrvinRetrievalApi`, with the generated project slug in `props.clientId`.
4. Add the typed binding contract to that application's environment type.
5. Call `retrieveProjectContext()` from the app's server-side question/tool handler.
6. Return the passages and provenance to the model as evidence.
7. Test successful access, denied access, empty results, quota exhaustion and service failure.

The consumer app does not need BRVIN's D1 binding, AI Search binding, GCS bucket, PDF, OCR credentials or BRVIN secrets. It should not bypass the service and query the shared index directly.

Official platform references:
- [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Service Binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Worker execution context and props](https://developers.cloudflare.com/workers/runtime-apis/context/)

### 10.2 What adding Wrangler alone does and does not do

A Service Binding exposes the private RPC methods to the application. It does **not** automatically:

- detect which user question needs a book search;
- call BRVIN from the application's model flow;
- place passages in Gemini/LLM context;
- decide how to cite pages;
- preserve source evidence through subsequent turns;
- create a UI or tool/function declaration.

Those responsibilities live in the app-side adapter. Once an app has this reusable adapter, adding another BRVIN project and changing only its binding identity/grants can be an admin/configuration operation rather than a new retrieval implementation.

### 10.3 AskMoina Voice — integration status at 4 November 2026

The separate repository `ashini-x/askmoina-voice` was checked during this audit:

- no BRVIN source files or BRVIN config were found;
- its deployed Worker did not have a `BRVIN_SERVICE` binding;
- it has its own D1 databases and Gemini Live function/tool pipeline;
- its Gemini Live tool-call handler is a natural integration point for a server-side BRVIN retrieval tool.

AskMoina is in the same Cloudflare account, so the preferred path is a private Service Binding, not a public BRVIN endpoint. The planned integration is to add a BRVIN search function tool to AskMoina's existing Gemini Live tool list, have the handler call BRVIN, and return concise retrieved passages with book title and PDF page provenance to Gemini Live. Gemini Live continues to generate the answer. AskMoina's own conversation D1 and Gemini model remain separate.

No AskMoina code or production configuration was changed as part of this audit/documentation update.

### 10.4 Other Cloudflare accounts or non-Cloudflare applications

A Worker in a different Cloudflare account cannot directly use this private same-account Service Binding. For that future case, build a separate authenticated HTTPS gateway in front of the internal service. The gateway should have per-project credentials, secure hashed credential storage, rotation/revocation, request validation, rate limiting, quotas and audit events.

Keep `brvin-service` private behind the gateway. Do not turn on `workers.dev` or expose the internal RPC Worker as a shortcut.

The public gateway is **not implemented** as of the verification date. A generic no-code connector for arbitrary applications is also not implemented.

## 11. Deployment, verification and release safety

The GitHub Actions workflow is the deployment authority.

### Pull request / validation path

- Install dependencies.
- Run TypeScript checks.
- Run Vitest and Node-specific tests.
- Dry-run the private BRVIN Worker config.
- Dry-run the main Parmar Worker config.

### Production deployment path

On a push to `main`, the workflow:

1. Captures the current 100%-traffic deployment version for both Workers. It refuses to deploy if safe rollback targets cannot be read.
2. Deploys `brvin-service` first.
3. Deploys `parmar-ai` second.
4. Runs root, health, BRVIN connectivity and Fatman source-readiness smoke tests.
5. Writes and uploads a production release manifest with the source revision and both deployed Worker version identifiers.
6. Rolls back the Parmar Worker and/or BRVIN Worker as appropriate if the deployment or release gate fails.
7. Rechecks production health after rollback.

A manual `workflow_dispatch` run performs credential preflight and live acceptance verification without deploying production.

### Production health contract

The Parmar `/health` endpoint must report:

- `ok: true`;
- `status: "healthy"`;
- `brvinRetrievalConnected: true`;
- `brvinReady: true`;
- an integer `authorizedSources` greater than zero for the Fatman consumer.

A production app without a configured BRVIN binding is degraded. The current smoke test intentionally verifies the existing Fatman consumer path, not every future third-party application.

### Verified production snapshot

At the 4 November 2026 audit:

- both `parmar-ai` and `brvin-service` existed in the Cloudflare account;
- `brvin-service` had workers.dev disabled and no public route;
- `parmar-ai` had the Service Binding to `BrvinRetrievalApi` with `clientId: "fatman"`;
- the shared D1 database and AI Search binding were present;
- only the Fatman project was registered as a consumer project in the production registry at that point;
- the latest inspected release-validation run was successful and its manifest reported the BRVIN connectivity and Fatman source-readiness checks as passed.

This is a dated operational snapshot, not a replacement for the workflow's release manifest. The manifest produced by each future deployment is the authoritative record for that deployment.

## 12. Test and acceptance map

Run locally:

~~~sh
npm run check
npm test
npm run test:node
npx wrangler deploy --config wrangler.brvin.jsonc --dry-run
npx wrangler deploy --dry-run
~~~

Relevant test suites:

- `test/brvin-service.test.ts`: consumer identity mapping, access filtering and service behavior.
- `test/brvin.test.ts`: retrieval behavior, source prefix and passage validation.
- `test/brvin-admin-script.node.test.ts`: admin lifecycle, deletion protections and regression guards.

Production acceptance must include more than “the Worker is up.” Verify:

1. Private Worker has no public route.
2. Valid Fatman Service Binding resolves to the active Fatman project.
3. Unknown/unregistered client fails closed.
4. Inactive project fails closed.
5. A project with no grants returns no passages and performs no search.
6. Direct book grant works.
7. Collection grant works.
8. Revoking a grant removes the source from subsequent retrieval.
9. Search receives only authorised folder prefixes.
10. Returned keys outside the authorised source set are rejected.
11. Exact PDF-page lookup returns the expected page/provenance where the item exists.
12. Quota exhaustion returns the structured limit response.
13. Worker unavailability is handled as an unavailable/degraded retrieval result, not a global search fallback.
14. Fatman answer generation, Telegram queue/retry, Durable Object continuity and citation formatting remain unchanged.
15. Both Worker deployments are captured in the release manifest and rollback targets remain available.

## 13. Explicit non-goals and prohibited shortcuts

These are not current BRVIN capabilities:

- a public cross-account API gateway;
- a generic arbitrary-app no-code SDK/wizard;
- automatic changes to external repositories;
- automatic insertion of retrieval results into any app's prompt without adapter code;
- per-app D1 databases;
- per-project AI Search indexes;
- copying PDFs or OCR output into each consumer app;
- moving all ingestion/admin code into `brvin-service`;
- moving Gemini answer generation into BRVIN.

Do not:

- expose the private Worker publicly to avoid implementing the consumer binding;
- accept a project ID/client ID from the retrieval request body;
- share all books with all projects by default;
- grant a broad collection without understanding that future sources in the collection may become available;
- delete shared search resources when removing one project;
- delete the Fatman quota history while preserving the project;
- copy the source PDF, GCS credentials, Vision credentials, D1 binding or AI Search binding into a consumer app;
- assume a green health check proves a new consumer's question-to-answer integration works.

## 14. Documentation ownership and change checklist

Update this reference whenever a change affects one of these:

- Worker names, bindings, entrypoint or privacy/public-route settings;
- D1 database, table schema, migrations, source fields or usage accounting;
- project/client identity generation or trust model;
- direct/collection grant semantics;
- search prefix format, filters, ranking, relevance threshold or result limits;
- PDF upload, OCR, indexing, retries, recovery, QA, archival or deletion;
- admin routes, controls or permissions;
- consumer integration contract or model-tool handling;
- quotas, secrets or storage retention;
- GitHub Actions deployment, smoke tests, acceptance or rollback.

Also update:
- [Private Retrieval API](BRVIN_PRIVATE_RETRIEVAL_API.md) for RPC contract changes;
- [App Integration Guide](BRVIN_INTEGRATION_GUIDE.md) for onboarding changes;
- [Operations Runbook](BRVIN_OPERATIONS_RUNBOOK.md) for admin or operational changes.

The canonical principle: **code and deployed configuration define the implementation; this document explains the current design and where to verify it.** Never use this guide as a reason to skip tests, release manifests, or a targeted check after a material code/infrastructure change.
