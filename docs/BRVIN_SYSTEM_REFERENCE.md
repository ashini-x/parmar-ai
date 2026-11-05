# BRVIN System Reference

**Status:** As-built architecture and operating contract  
**Last verified against source and production infrastructure:** 5 November 2026 (M8 handoff implementation deployed; production release acceptance passed)  
**Owning repository:** `ashini-x/parmar-ai`  
**Related consumer repository checked:** `ashini-x/askmoina-voice`

This is the canonical technical reference for BRVIN. It records what exists in code and production, where the important pieces live, how trust and knowledge access work, and which future integrations are not yet implemented. It is intended to prevent repeated repository and Cloudflare audits for ordinary design discussions.

When a future change alters code, D1 schema, bindings, access rules, ingestion, retrieval, deployment, or integrations, update this document and the relevant specialist document in the same change. Do not silently treat a planned feature as already shipped.

> **BRVIN 2 implementation and chat continuity:** read [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md), then [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md), this as-built reference, [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md) and [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md). The active product is a teacher-specific digital-brain knowledge platform and application connection manager. ChatGPT remains the user's software engineer using separate GitHub/Cloudflare authorizations. The autonomous Project Factory proposal is superseded historical documentation; do not follow its milestones. M0–M8 are complete; M4's fixed reference scaffold is retired and not a product requirement. M8 handoff generation is merged, deployed and production-accepted. M9 — live connection verification and activation is the next incomplete milestone; M10–M11 remain outstanding. The retired `brvin-test-client` scaffold must not be recreated.

## Product-scope correction — 5 November 2026

The user confirmed BRVIN's product goal: manage teacher-specific knowledge projects and securely connect independently built apps to them. BRVIN owns ingestion, OCR/indexing, projects, sources, collections, trusted app/environment identities, app-project grants, private retrieval, quotas, audit and connection verification. ChatGPT owns software design, code, repository work, CI/CD and deployment through its own provider connections. BRVIN does not require an autonomous coding model or software Project Factory. The earlier Project Factory specification is retained as historical only. The canonical target is [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md).

## 1. Executive architecture

BRVIN is a shared, project-scoped knowledge and retrieval layer. Multiple applications can use the same indexed knowledge corpus while receiving only the documents explicitly granted to their project.

The current architecture deliberately separates **knowledge administration and ingestion** from **private application retrieval**:

- The existing `parmar-ai` Worker owns the protected BRVIN admin workspace, upload gateway, Google Cloud upload/OCR orchestration, Cloudflare Workflow, D1 registration, access grants, and release verification.
- A second Worker, `brvin-service`, is the private retrieval boundary. Consumer Workers call it with Cloudflare Service Binding RPC. Legacy v1 methods resolve `ctx.props.clientId` to a single project; v2 methods resolve `ctx.props.applicationEnvironmentId` to an application, then verify its active grant for the requested project. Both paths check D1 source grants, search only authorised folders, and validate returned page keys again.
- The application that called BRVIN remains responsible for its own model, prompt, conversation state, tool/function-call handling, response formatting, and user delivery. BRVIN returns evidence; it does not generate the final answer.
- The former text-only reference-client scaffold was removed from `ashini-x/askmoina-voice` by PR #386 (merged 5 November 2026); PR #385 was closed without merging. It had never been deployed to Cloudflare. Its D1 application/environment/project/grant were retired. The generic connector and private BRVIN retrieval boundary remain. The first Project Factory acceptance app must be generated in its own new repository.

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

## 1.1 BRVIN 2 production state (5 November 2026 — after M8 handoff release)

- M1 added `brvin_applications`, `brvin_application_environments` and `brvin_application_project_grants` to the existing shared D1. The Parmar AI production application/environment and explicit Fatman project grant are seeded and active.
- M2 added `listAuthorizedProjectsV2()`, `getProjectStatusV2(input)` and `retrieveProjectContextV2(input)` to the private `BrvinRetrievalApi` entrypoint. V1 methods remain available.
- Parmar AI production carries both `clientId: fatman` and the generated production `applicationEnvironmentId`. `/health` checks v1/v2 Fatman readiness and source-count parity.
- Latest paired production release after M8: `brvin-service` deployment `b778ed64-c168-4e17-9473-eec04ed67e00`, version `3737180d-9317-464f-8e12-816b266f1fc2`; `parmar-ai` deployment `fab3a262-b1c9-415d-9431-738c953d6451`, version `96a626c5-c11c-4e7b-9202-a040cd434da7`. Main Release Validation #713 (run `42067800093`) passed paired deployment and root/health/private BRVIN/Fatman production acceptance; artifact `13434543663`.
- End-user Fatman retrieval remains on v1. AskMoina Voice's v2 binding and Gemini Live connector/tool integration are deployed as an optional pilot. Do not make its camera/audio acceptance a BRVIN milestone gate.
- The former M4 independent reference-client scaffold was originally merged as `brvin-test-client` in AskMoina PR #381, then retired by PR #386. Its Worker source, Wrangler/TypeScript config, tests and dedicated deploy workflow are no longer in the AskMoina repository. It was never deployed. The shared BRVIN connector remains.
- The historical Project Factory provider-administrator preflight and configured-scope correction were deployed through PRs #82, #83 and #88. They are part of the as-built code but are no longer an active product milestone. Do not ask the user to complete broad GitHub/Cloudflare administrator re-consent for the narrowed knowledge-platform goal. Audit any runtime dependencies before simplifying or removing this legacy UI; no credential should be revoked or deleted as a side effect.
- The existing BRVIN GitHub App is installed on the `ashini-x` account. Its broader Project Factory permission upgrade and All-repository scope were never accepted as requirements for the clarified product. The saved Cloudflare OAuth grant remains `workers-scripts.edit offline_access`; this historical connection is not required to deliver the knowledge-platform workflow through ChatGPT's own integrations. Do not request additional consent or delete/revoke the existing provider configuration until its code/runtime dependencies have been audited.
- The old fixed text-test application/environment are revoked, its project is inactive, its only application-project grant is revoked, and stale PR #385 metadata has been cleared from the GitHub provider connection. PR #385 was closed without merging; PR #386 removed the undeployed scaffold. The sample Rain Gardens PDF remains ready but unassigned.
- The old provider-admin/test-client sequence above is superseded. Do not create the retired `brvin-test-client`, provision its token/secret, or reauthorize provider scopes for that purpose. M6 teacher-focused admin workspace, M7 application/repository/runtime registration and M8 ChatGPT integration handoff are complete. M9 live v2 connection verification is the next milestone; M10 knowledge assignment/isolation and M11 operations/handover remain not started.
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

### 9.1 Shipped admin capabilities

The production dashboard currently includes:

- **Overview:** source, collection, knowledge-project, application and indexed-page metrics; active/failed jobs; recent activity.
- **Knowledge sources:** PDF upload, collection selection, optional direct project assignment, per-source progress, pipeline inspection, archive and deletion controls.
- **Collections:** collection creation and source grouping.
- **Knowledge projects:** teacher/owner label, project name/description, direct-book and collection grants, source/ready-source counts, active application counts, current-month retrieval usage, project detail modal (sources, collections, applications and project-scoped recent events), edit and activate/deactivate actions.
- **Applications:** teacher/owner label, purpose, app registry metadata, environment identities, active project grants, edit/suspend/revoke lifecycle and explicit registration-only/unverified status. The UI never presents a registered environment as live-connected; M9 owns live verification.
- **Legacy provider settings:** historical GitHub/Cloudflare administrator-preflight controls are retained in a collapsed legacy disclosure, are not part of teacher/app onboarding, and do not trigger periodic provider checks while closed. Existing stored provider credentials were not deleted, revoked or reauthorized.

Administrative APIs are protected by existing admin authentication and POST requests are checked for same-origin use. Do not expose these routes as an unauthenticated public integration API.

### 9.2 M6 — teacher-focused admin workspace deployed

M6 shipped in [PR #91](https://github.com/ashini-x/parmar-ai/pull/91), merge commit `4ab6c555af64f5972607a9b9f409c181d0883c7f`.

- PR Release Validation #700 passed type-check, unit tests, Node/browser-script tests and both Worker bundle validations.
- Main Release Validation #701 deployed the paired Workers and passed root, worker health, private BRVIN Service Binding, Fatman retrieval and production release acceptance.
- Production `owner_label` columns exist on `brvin_projects` and `brvin_applications`; migration marker `2026-11-05-brvin-owner-label-v1` is present.
- Production project/application summary queries executed successfully with read-only D1 API calls (`rows_written=0`). Fatman remains active and its existing `fatman -> fatman` v1 mapping remains.
- Production versions: `brvin-service` `9657e7ef-394e-43ac-abd7-2a3564d9500f` and `parmar-ai` `fbcb906b-8d42-430d-815d-c4b9d4891f4f`, each at 100% traffic in deployment history.
- No provider credential was removed, reauthorized or revoked. No M7 wizard or M8 prompt generator was started.

**Manual verification limitation:** the admin route requires the administrator's authenticated browser session. This session did not have that login session available for a visual click-through. The dashboard client contract is covered by passing Node/browser-script tests, and the deployed backend/schema/query behavior was verified against production. The administrator can visually confirm the signed-in workspace at `/admin/brvin`; do not claim that this session performed the click-through.

### 9.3 M7 application connection registry — deployed

M7 shipped in [PR #93](https://github.com/ashini-x/parmar-ai/pull/93), merge commit `3f7803fe5e3cc0f9894292a8ce7ad6c79a6d11d6`.

- PR Release Validation #704 passed type-check, unit tests, Node/browser-script tests and both Worker bundle checks.
- Main Release Validation #705 deployed the paired Workers and passed root, worker health, private BRVIN Service Binding, Fatman retrieval and production release acceptance.
- Production D1 migration marker `2026-11-05-brvin-connection-metadata-v1` is present. Application repository/default branch/runtime fields and environment Worker name/URL fields are available with safe defaults.
- Production read-back confirmed the existing Parmar AI and AskMoina app/environment identity records remain, including the revoked historical BRVIN Text Test Client. Fatman remains active and its `fatman -> fatman` v1 mapping remains. November 2026 Fatman usage read back as 31. All checks were read-only (`rows_written=0`).
- Production versions: `brvin-service` `146cb9f6-84c2-4321-87f6-c82045643fef`; `parmar-ai` `4c4cfe12-ea03-417d-bf1e-8ee8e26c9d81`.
- The wizard stores an existing GitHub repository URL/default branch and optional Worker name/HTTPS URL references. It does not provision repositories, Workers, secrets, bindings or deployments. It does not prove ChatGPT can access a GitHub repo.
- Environments are intentionally still Pending. M9 owns live private Service Binding verification before they may be shown as Connected.

### 9.4 M8 ChatGPT integration handoff — deployed and complete

M8 shipped in [PR #95](https://github.com/ashini-x/parmar-ai/pull/95), merged to main as \`81bc036ca1ffd2ae7d3ce6ed0170ee2e1e69d9fd\`.

The admin application/environment cards expose Generate ChatGPT handoff. A protected read-only endpoint regenerates the handoff from current saved application and environment metadata, validates active status and environment-to-application ownership, and returns a versioned prompt plus structured manifest. The modal shows the revision and generation date and provides copy controls for both outputs.

The generator names private service \`brvin-service\`, entrypoint \`BrvinRetrievalApi\`, binding \`BRVIN_SERVICE\`, and v2 methods \`listAuthorizedProjectsV2()\`, \`getProjectStatusV2({ projectId })\` and \`retrieveProjectContextV2(input)\`. The trusted binding property is \`applicationEnvironmentId\`, never the legacy v1 \`clientId\`. The prompt directs ChatGPT to vendor a reviewed, pinned copy of \`packages/brvin-connector\`, integrate retrieval server-side into the consumer's existing model/tool path, preserve source/page provenance, and complete the security/test checklist.

The generator reads only allowlisted application, repository, environment and runtime metadata plus a configured non-secret BRVIN account-ID reference. It does not inspect the legacy GitHub App/Cloudflare OAuth credential vault. M7 does not record the target consumer's actual Cloudflare account ID, so the handoff requires explicit same-account verification before deployment. Non-Cloudflare runtime providers are blocked for this same-account Service Binding path.

The handoff does not provision or modify a consumer repository, Worker, binding, secret, project grant or deployment, and does not claim a live connection. Every registered environment remains Pending until M9 live verification succeeds.

**Validation:** PR Release Validation [#711](https://github.com/ashini-x/parmar-ai/actions/runs/42067500863) passed typecheck, unit/integration tests, Node/browser-script tests and both Worker bundle validations. Main Release Validation [#713](https://github.com/ashini-x/parmar-ai/actions/runs/42067800093) passed paired deployment, root/health/private BRVIN/Fatman smoke and production release acceptance; artifact \`13434543663\`.

**Production deployment versions:** \`brvin-service\` version \`3737180d-9317-464f-8e12-816b266f1fc2\`; \`parmar-ai\` version \`96a626c5-c11c-4e7b-9202-a040cd434da7\`.

**Verification limitation:** This session did not have an authenticated admin browser for a manual visual click-through or an actual per-app copy test. CI validated the generated browser script, route and generator contracts. No specific consumer is claimed Connected.

### 9.5 Remaining admin and connection work

M6 and M7 delivered the teacher-focused Knowledge Projects/Application workspace, editable repository/runtime metadata, generated environment identity registration, explicit project grants, and Pending connection state. M8's one-time ChatGPT handoff generator is complete and deployed in PR #95.

The live consumer-side identity probe, authenticated success/failure reporting, and Connected state are not yet implemented. Those belong to M9 and require an ADR for probe authentication and replay protection first. M10 still owns the broader teacher assignment/isolation acceptance workflow. Until M9 passes for an actual deployed consumer, every registered environment must remain Pending.
 
## 10. Consumer application integration

### 10.1 Supported same-account v2 connection

For a new consumer Worker in the same Cloudflare account:

1. Register the consumer application in the BRVIN admin workspace.
2. Register a trusted environment for each intended deployed environment (production, staging, preview).
3. Use the generated immutable environment UUID as `props.applicationEnvironmentId`.
4. Add a private Service Binding in the consumer Worker to `brvin-service`, entrypoint `BrvinRetrievalApi`.
5. Use the v2 methods `listAuthorizedProjectsV2()`, `getProjectStatusV2({ projectId })` and `retrieveProjectContextV2(input)`.
6. Wire retrieval into the consumer application's server-side model/tool handler.
7. Preserve source title, book/source ID and physical PDF page provenance in the consumer's answer flow.
8. Test allowed/revoked/unknown projects, no evidence, quota exhaustion and service failure.

The consumer app does not need BRVIN's D1 binding, AI Search binding, GCS bucket, PDF/OCR credentials or BRVIN master secrets. It must not query shared AI Search or D1 directly.

V2 identity comes only from deployment-controlled Service Binding `ctx.props.applicationEnvironmentId`. A request body cannot set or override the identity. A project ID is only a selector checked against an active application-project grant. New v2 integrations must not use the legacy v1 `props.clientId`.

### 10.2 App-side model and user responsibilities

A Service Binding exposes private RPC methods; it does not wire the application's model flow. The consumer app must:
- authenticate its own users;
- determine which BRVIN project(s) the authenticated user may access;
- call the appropriate BRVIN v2 method server-side;
- provide bounded returned evidence to its own model as untrusted source material;
- generate the final answer and display accurate source/page citations;
- preserve its own sessions, users and conversation history.

The existing BRVIN application-project grant is application-wide, not user-specific. A multi-teacher application must enforce user-to-project authorization itself. For a dedicated teacher app, the app may have a single teacher knowledge project grant.

### 10.3 ChatGPT's role in the one-time integration

ChatGPT remains the user's application engineer. The M8 admin handoff generator creates a non-secret, repository- and environment-specific prompt plus structured manifest from current BRVIN registry values. It supplies the exact private v2 binding identity, connector source location, security rules and test checklist. The user ensures that the repository is available in ChatGPT's own GitHub connection. ChatGPT uses its separately authorized GitHub/Cloudflare tools to modify the consumer repo, test and deploy it. The handoff does not authorize those connections or itself create infrastructure.

BRVIN cannot authorize OpenAI's GitHub connector or guarantee that a newly created private repository is automatically visible to ChatGPT. A repository URL recorded in BRVIN is metadata, not proof of ChatGPT or BRVIN source-control access.

### 10.4 AskMoina Voice and other consumers

AskMoina Voice remains an optional independent consumer and must not be used as a fixed BRVIN test-client host. Its current integration state must be read from the latest repo and production ledger before any work; historical 4 November audit statements are not current deployment evidence.

The first teacher-focused proof consumer may be a separate SSC Mathematics Telegram bot repository, built and deployed by ChatGPT/user. BRVIN's acceptance responsibility is to register and verify its private knowledge connection and prove teacher/project isolation—not to create the bot.

### 10.5 Other Cloudflare accounts or non-Cloudflare applications

A Worker in a different Cloudflare account cannot directly use the private same-account Service Binding. A server outside Cloudflare also cannot call the private Worker directly. Design a separate authenticated HTTPS gateway in a later milestone before supporting those consumers.

Keep `brvin-service` private. Do not turn on `workers.dev` or expose the internal RPC Worker as a shortcut. The public gateway is not implemented.


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


## M8 handoff generator — implementation in progress (5 November 2026)

The implementation branch brvin/m8-chatgpt-integration-handoff adds:
- src/brvin/handoff.ts: pure manifest/prompt builder plus the read-only D1-backed handoff endpoint;
- GET /admin/api/brvin/applications/handoff?applicationId=...&environmentId=...: validates UUIDs, requires an active app and environment, verifies the environment belongs to that app, and regenerates from current saved metadata;
- src/brvin/admin.ts: per-environment Generate ChatGPT handoff control, revision/date display, copyable prompt and JSON manifest;
- tests for manifest fields, exact v2 binding identity, environment/app scoping, secret exclusion, unsupported runtime and browser-script/route integration.

The generator includes only explicitly allowlisted application, repository, environment, runtime and non-secret BRVIN account metadata. It does not read legacy GitHub App or Cloudflare OAuth vault entries. The target Cloudflare account is not stored in M7, so the handoff records it as unverified and instructs ChatGPT to compare the actual target deployment with the BRVIN account before deploying. Non-Cloudflare runtime providers are blocked for this private same-account binding design.

**Current status:** implementation and unit/UI tests are on the branch; PR validation and production deployment are pending. This does not mark an environment Connected and does not implement M9.
