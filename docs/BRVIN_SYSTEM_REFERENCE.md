# BRVIN System Reference

**Status:** As-built architecture and operating contract  
**Last verified against source and production infrastructure:** 14 November 2026. Cloudflare confirms active production parmar-ai v779, brvin-service v156, isolated M15 staging v104 and Teachers v12, all at 100%. Production selectors remain Cloudflare AI Search. Current staging receipt 0f5f9769-452a-466e-b5ae-735ddba6378a passed page-target and provenance checks; no independent human qrels, cross-subject evidence, runtime gate or cutover is established.
**Owning repository:** `ashini-x/parmar-ai`  
**Related consumer repository checked:** `ashini-x/brvin-teachers` (separate downstream app); `ashini-x/askmoina-voice` remains an optional consumer

This is the canonical technical reference for BRVIN. It records what exists in code and production, where the important pieces live, how trust and knowledge access work, and which future integrations are not yet implemented. It is intended to prevent repeated repository and Cloudflare audits for ordinary design discussions.

When a future change alters code, D1 schema, bindings, access rules, ingestion, retrieval, deployment, or integrations, update this document and the relevant specialist document in the same change. Do not silently treat a planned feature as already shipped.

> **BRVIN continuation:** start with [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md), then use [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md) for the M6–M17 milestone ledger. This file is the current as-built technical reference; its dated lower sections are historical checkpoints, while the top deployment/provider snapshot and master plan are current. M6–M11 are complete. The real BRVIN Teachers consumer passed semantic retrieval with physical PDF-page provenance, explicit Not Authorised denial after grant revocation, and successful retrieval after access was restored. The autonomous Project Factory and old M3 reference-client plans have been removed from the active documentation tree. Do not revive them or recreate the retired `brvin-test-client`.

## Current product boundary

BRVIN is the shared, teacher-specific knowledge platform and application connection manager described in [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md). BRVIN owns knowledge ingestion, storage, OCR/indexing, projects, grants, private retrieval, quotas, activity and connection verification. ChatGPT remains the user's separately authorized engineer for consumer-application code and deployment. BRVIN is not an autonomous coding agent, repository factory, provider credential vault or BRVIN-owned CI/CD service.

The superseded Project Factory and retired M3 reference-client proposals have been removed from the active documentation tree. Do not treat their old milestones or test-client designs as current requirements. The old reference-client Worker was never deployed and must not be recreated.

## 1. Executive architecture

BRVIN is a shared, project-scoped knowledge and retrieval layer. Multiple applications can use the same indexed knowledge corpus while receiving only the documents explicitly granted to their project.

The current architecture deliberately separates **knowledge administration and ingestion** from **private application retrieval**:

- The existing `parmar-ai` Worker owns the protected BRVIN admin workspace, upload gateway, Google Cloud upload/OCR orchestration, Cloudflare Workflow, D1 registration, access grants, release verification, and the separate named `BrvinTeachersManagementApi` WorkerEntrypoint used by BRVIN Teachers for administrative project/collection/source lifecycle operations.
- A second Worker, `brvin-service`, is the private retrieval boundary. Consumer Workers call it with Cloudflare Service Binding RPC. Legacy v1 methods resolve `ctx.props.clientId` to a single project; v2 methods resolve `ctx.props.applicationEnvironmentId` to an application, then verify its active grant for the requested project. Both paths check D1 source grants, search only authorised folders, and validate returned page keys again.
- The application that called BRVIN remains responsible for its own model, prompt, conversation state, tool/function-call handling, response formatting, and user delivery. BRVIN returns evidence; it does not generate the final answer.
- The former text-only reference-client scaffold was removed from `ashini-x/askmoina-voice` by PR #386 (merged 5 November 2026); PR #385 was closed without merging. It had never been deployed to Cloudflare. Its D1 application/environment/project/grant were retired. The generic connector and private BRVIN retrieval boundary remain. The remaining M11 acceptance app is a genuine independent teacher-focused consumer, engineered and deployed by ChatGPT/user through the existing authorized workflows.

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


PRIVATE TEACHER MANAGEMENT PLANE
BRVIN Teachers Operator Console / server
    |
    | same-account Service Binding
    | named export: BrvinTeachersManagementApi
    | deployment-controlled applicationEnvironmentId
    v
parmar-ai Worker
    |-- validate active brvin-teachers app/environment + Worker name
    |-- create/update teacher-owned projects and collections
    |-- manage same-teacher collection grants
    |-- register and transfer source PDF chunks
    +-- reuse existing GCS / Vision / Workflow ingestion


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

## 1.1 Historical production snapshot — 8 November 2026

- Core maintenance PR [#110](https://github.com/ashini-x/parmar-ai/pull/110) was squash-merged as `b473139c4b65fd52fb35204a4e88a2fd4305b0bc`. Release validation [#868](https://github.com/ashini-x/parmar-ai/actions/runs/42393606814) passed typecheck, unit/integration tests, Node/browser-script tests, both Worker dry-runs, paired production deployment, root/`/health` checks, private BRVIN connectivity and Fatman source-readiness smoke acceptance. The previous 100%-traffic Core versions before the 8 November release were `parmar-ai` `92fea836-de6f-4791-98e8-3c1bfcc49698` (deployment `23aceae0-7887-4605-a507-7413c7e19c32`) and `brvin-service` `83c180a5-b041-4019-ae9f-a205e2968b78` (deployment `5e327c76-ed79-42a4-bd53-e3c835accf36`).
- BRVIN automatic PDF page-count detection and the downstream source page map shipped in Core PR [#133](https://github.com/ashini-x/parmar-ai/pull/133), merged as `9c0b6da978e60cc98778d8838a4d99867390fb2e`; Release validation [#888](https://github.com/ashini-x/parmar-ai/actions/runs/42417392419) passed typecheck, full Vitest and Node tests, both Worker dry-runs, paired production deployment, live root/health/private BRVIN/Fatman source-readiness checks and the release acceptance manifest. Active 100%-traffic versions are `parmar-ai` `5eead825-46cb-4122-a351-634865696142` (deployment `045e0ef6-12cc-44fd-bc72-f0e4bec9940e`) and `brvin-service` `5ad1f448-1700-4e06-abdc-0b39287b89b8` (deployment `e04a9792-941b-4d64-bed0-02bfea96d53c`). The feature uses the already-required one-output-per-page Vision inventory; it adds no OCR operation, D1 schema migration or retrieval RPC v2 change.

- The latest verified paired production deployment is Release validation run [#42426578685](https://github.com/ashini-x/parmar-ai/actions/runs/42426578685) on 7 November 2026, source revision [`2274fd6`](https://github.com/ashini-x/parmar-ai/commit/2274fd694af88f1b88a34fa1e0e9bfc092c36c9d). Its production acceptance artifact records root, health, BRVIN Service Binding and Fatman retrieval as passed and both Workers at 100% traffic: `parmar-ai` version `9c0f07cd-5b68-4a55-9883-50b407183cee` (deployment `12b352b0-7040-4939-92c8-73a863c34f2c`) and `brvin-service` version `ce17b0bf-cfe2-47c4-b4c3-c85dddda9460` (deployment `560c5686-658f-4594-823d-b4080e6d61f5`). This deployed revision includes the existing AI Search hybrid/reranking precision path. The subsequent 8 November Core `main` commits are documentation-only; the M13 provider-boundary/corpus work is on a separate review branch and is not deployed. Production remains AI Search; no Vertex or Qdrant resources are connected.

- M13 branch note (not deployed): `brvin/m13-provider-boundary-corpus` / draft PR [#147](https://github.com/ashini-x/parmar-ai/pull/147) introduces the provider port and optional durable corpus only. The Core production selector remains AI Search and the corpus-write flag remains false. The new GCS manifests are outside the 30-day temporary Vision prefix; generations are keyed by the source PDF hash, Vision operation ID and chunker/normalizer versions, with one fixed manifest per physical PDF page. Manifests preserve raw OCR and the stable provider item key, and include Vision page confidence only when returned by the source response. No Qdrant or Vertex implementation is deployed.
- BRVIN Admin, the Main Admin Control Center, Fatman Admin, Fatman Library and Fatman Monitor now use manual refresh rather than recurring browser polling. The existing server-side Workflows and scheduled supervisors continue OCR, indexing, retries, QA, recovery and retention independently of browser sessions.
- The production D1 database `parmar-ai-admin-prod` has the verified partial index `idx_brvin_activity_book_vision_cleanup(book_id, created_at DESC, id DESC)` for the two Vision cleanup event types. It was added idempotently and read back from `sqlite_master` on 7 November after the paired Worker release.
- The production admin/registry remains in the existing `parmar-ai` Worker and D1 database `parmar-ai-admin-prod`. The shared AI Search namespace and existing GCS bucket `parmar-fatman-ocr-90db7be4` remain in use.
- The post-deployment storage diagnostic previously verified lifecycle configuration permissions **READY** and the exact 30-day OCR lifecycle rule **INSTALLED**. The rule is limited to the dedicated temporary Vision OCR prefix; source PDF paths are protected.
- The authenticated Operations walkthrough on 6 November showed 33 project searches that month, zero active-environment connection failures, 404 failed activity events in the previous seven days and zero OCR cleanup failures. The 404 value is a count of activity rows with status `failed`, not an HTTP status or count of currently recoverable jobs.
- BRVIN Teachers (`ashini-x/brvin-teachers`) is a separate downstream consumer. Its Production application and environment are registered and active in the BRVIN registry. The deployment-controlled Production environment identity is `515e7752-20ff-42f9-b393-7c8130a64bf8`; both private consumer bindings target `BrvinTeachersManagementApi` on `parmar-ai` and `BrvinRetrievalApi` on private `brvin-service`. BRVIN Admin accepted the one-time private retrieval proof on 6 November 2026. The registry's latest proof snapshot is `connected`, with zero ready sources at the time of proof; the check preceded project/source creation.
- The live pilot has one teacher profile (`TCH-000001`), one active Physics project (`TCH-000001-PRJ-001`), one teacher-notes collection (`TCH-000001-PRJ-001-COL-001`) and a 3-page PDF source. Production D1 confirms the source is `ready`, with `page_count=3` and `indexed_pages=3`; the deployed Teachers progress map shows all three page tiles indexed. No PDF re-upload or OCR retry was required to reach readiness.
- The first production retrieval diagnostic exposed a precision issue: each Physics page had originally been stored as one large 1,024-token chunk. The shared AI Search instance is now configured for 256-token recursive chunks with 10% overlap, hybrid vector + BM25 retrieval using RRF fusion, keyword OR matching, and BGE cross-encoder reranking. The three existing pilot items were re-indexed without re-uploading the PDF or re-running Google Vision OCR; their confirmed chunk counts are page 1: 3, page 2: 4, page 3: 4. The earlier page-2 Workers AI timeout was recovered by a successful item-scoped retry.
- A live AI Search engine smoke check (restricted to the Physics source prefix, reranking enabled and cache bypassed) returned Newton's second-law evidence from PDF page 2 first (reranking score 0.993), the 4 kg worked example from page 3 first (0.9995), and the bus-braking answer-key evidence from page 3 first (0.9994; related explanatory evidence also exists on page 1). These direct engine checks verify candidate ranking and page-key provenance.
- The authenticated BRVIN Teachers v2 consumer semantic-retrieval check then passed. On 8 November 2026, the operator supplied a screenshot from the protected `/operator/retrieval-test` route showing two relevant Newton second-law passages from the Physics pilot handout, both cited to physical PDF page 2, with displayed relevance scores 0.993 and 0.960. The retrieved text supports the relationship between net force, mass and acceleration. This exercises the actual consumer binding and useful source retrieval, rather than a direct AI Search request.
- M6–M11 are **COMPLETE**. The BRVIN Teachers consumer passed useful semantic retrieval, correct physical PDF-page provenance, Not Authorised denial after access revocation, and successful retrieval after the Physics access grant was restored. No student/channel/model runtime is implemented or authorized.
- The legacy BRVIN Connect retirement code and protected UI are deployed, but retirement is **not yet executed**. The latest read-only Core D1 check on 7 November still showed both GitHub and Cloudflare provider rows as `connected`. The protected button is on `/admin/brvin` under **Legacy provider settings**; it requires an authenticated Core Admin session and the exact confirmation `UNINSTALL BRVIN CONNECT`. The current Cloudflare connector is OAuth-based and the OAuth Clients API returned HTTP 403 because this connection has no `OAuth Client Read`/`OAuth Client Write` API-token permissions. No provider credential, installation or OAuth registration was altered. After the protected action succeeds, delete the GitHub App registration and the dedicated Cloudflare OAuth client registration separately.
- AskMoina Voice remains an optional independent consumer and must not be treated as a fixed BRVIN test-client host. The retired `brvin-test-client` scaffold must not be recreated.


## 1.2 Historical production and provider-migration snapshot — 12 November 2026

Cloudflare read-only deployment/settings read-back confirms the following current 100% deployments:

| Worker | Environment | Version | Deployment | Traffic |
|---|---|---|---|---:|
| `parmar-ai` | production | `5c55b8a6-151b-4d21-8748-30d221507923` | `91a074f0-241f-4c29-b18f-f5f2eeb1fd1c` | 100% |
| `brvin-service` | production | `e59d976e-07ba-4974-b1bd-56a9a48e5555` | `e0a86373-d290-4259-aa99-edc62308095b` | 100% |
| `parmar-ai-m14-staging` | staging | `8d732f8b-b14c-4e47-aeae-ce39d8db9f9f` | `41a5ac03-af07-4212-bfb2-2199f4bb69f9` | 100% |
| `brvin-teachers` | production | `68d6694c-6371-4cae-8a25-4af40ca15706` | `31ff2a01-b0f4-4be8-92d3-63e2d91adddf` | 100% |

Production Core remains on the existing provider: both `parmar-ai` and `brvin-service` have `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`; `parmar-ai` has `BRVIN_CORPUS_MANIFEST_ENABLED=false`. Production has no Qdrant/Vertex retrieval binding or credentials. The subsequent Core PRs #237, #238 and #241 contain only the M15 staging operator/module/tests, CI and documentation changes; PR #241 fixes the Items Workers binding wire format by sending string-valued metadata while leaving `pdf_page` declared as a numeric custom-metadata field. Post-merge Core Release validation [#43317133059](https://github.com/ashini-x/parmar-ai/actions/runs/43317133059) passed full typecheck/tests/build; the production classifier skipped credential/live-production/deployment jobs.

The isolated staging Worker has Vertex `gemini-embedding-001` in `asia-south1` at 768 dimensions, its dedicated M15 Qdrant collection, separate staging AI Search bindings and isolated D1. Post-merge staging workflow [#43317133051](https://github.com/ashini-x/parmar-ai/actions/runs/43317133051) passed typecheck, focused M14/M15 tests (including the string-valued upload-metadata regression), versioned provider-setting verification and Wrangler dry-run, then deployed Worker version `a1158a7c-4422-4768-93e0-140363e791c2` (version 98), deployment `b46a8d37-362c-4ac3-94f8-68f602d367a3`, at 100%. Cloudflare version read-back confirms the isolated M15 Qdrant/AI Search bindings and staging D1 remain attached. The M15 multi-source operator is staging-only at `/admin/m15/benchmark/multi-source`.

BRVIN Teachers remains a downstream private v2 consumer. Its Worker has only `BRVIN_MANAGEMENT` to `parmar-ai` / `BrvinTeachersManagementApi`, `BRVIN_SERVICE` to `brvin-service` / `BrvinRetrievalApi`, and its own D1. It has no Qdrant/Vertex SDKs, credentials, embeddings, or direct provider bindings. The existing private v2 contract, D1 authorization authority, Core Admin and Teachers Operator Console remain unchanged.

**M15 status: IN PROGRESS.** The eight-page M15 Physics source and pinned three-page M14 Physics handout are READY. Authorization/revocation passed 8/8 under e305a581-3d3c-469c-b2b5-093598783df4. The five-case paired Core v2 receipt fa1b8076-9375-480b-bb4b-e22d1c13d9bb passed its seven structural, authorization, provenance and quota checks. The latest expanded 12-query receipt 0f5f9769-452a-466e-b5ae-735ddba6378a also passed operational checks: both providers completed 12/12, found all 11 query-specific page targets across seven source/page pairs, and had zero provenance violations. AI Search returned no candidates for either expected no-match query; Qdrant returned five unrelated candidates. Staging usage is 45 after 24 reservations. These page-target and sequential-latency results are not human passage qrels or load/SLO evidence. The staging registry currently contains only these two Physics sources. The blank 109-candidate review pack still needs independent human labels; M15 also needs another subject family, held-out source/query groups, no-match/near-miss precision, recovery/throttling, representative load, cost, quota redesign and rollback. No gate, cutoff, reranker or provider winner is selected. Production remains on AI Search.


## 1.3 Current Cloudflare read-back — 14 November 2026

Cloudflare deployment, settings and binding read-back on 14 November 2026 confirms the following versions at 100% traffic:

| Worker | Environment | Version | Deployment |
|---|---|---|---|
| `parmar-ai` | production | `04e4ac51-06a0-4514-9470-f5547a8cc0cd` (v779) | `51c90a18-170c-4ae1-8f39-7b6225450581` |
| `brvin-service` | production | `0e291556-7e84-4958-b132-712e6d394eda` (v156) | `9a3be7e6-33b0-4556-a1c4-da3c66d1c258` |
| `parmar-ai-m14-staging` | isolated staging | `8df7d3c4-fcf5-4ead-9e19-b71ed439cfae` (v103) | `6aceb081-12ef-49db-b1fe-dbcc4f36ea56` |
| `brvin-teachers` | production | `68d6694c-6371-4cae-8a25-4af40ca15706` (v12) | `31ff2a01-b0f4-4be8-92d3-63e2d91adddf` |

Core PR #272 merged as `9bcae39f5e6b9deafd794da3ec1ec4a65922f4aa`. Release validation [#43548129464](https://github.com/ashini-x/parmar-ai/actions/runs/43548129464) passed typecheck, full Vitest, Node tests and both Worker bundle validations; the production deployment and live-production verification jobs were skipped. The isolated staging workflow [#43548129462](https://github.com/ashini-x/parmar-ai/actions/runs/43548129462) passed its focused M14/M15 tests, provider-setting verification and Wrangler dry-run, then deployed only the isolated staging Worker. Cloudflare read-back confirms `parmar-ai-m14-staging` v104 at 100%, deployment `7163bad8-8389-43c6-94cf-5e9446797c20`, version `bd08057b-cb0b-4907-8b09-6916048afabe`. Staging `/health` returned 200 and the staging benchmark health endpoint reported ready. Production remains parmar-ai v779 and brvin-service v156; Teachers remains v12. No production deployment occurred.

**Production provider and consumer boundary:** `parmar-ai` and `brvin-service` both retain `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`; `parmar-ai` retains `BRVIN_CORPUS_MANIFEST_ENABLED=false`. The private retrieval Worker has D1 and the AI Search namespace, with no Qdrant URL/API key, Vertex embedding model or Vertex retrieval credential. The dedicated staging Worker alone has the M15 Qdrant/Vertex and separate staging AI Search bindings. Teachers v12 has only `BRVIN_MANAGEMENT` to `parmar-ai`, `BRVIN_SERVICE` to `brvin-service`, and its own D1; no Qdrant/Vertex credentials, SDKs, embedding generation or provider route are present in that consumer Worker.

**Quota read-back:** the student-facing `DAILY_QUESTION_LIMIT` production variable is `10`; Core source defaults are also 10/day, with the existing burst settings retained (5 questions per 10 seconds). This is separate from the Core project-level retrieval allowance: the live `brvin-service` v156 has `BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT=800` and was built with a code maximum of 800. Isolated staging v104 is built with a 300,000 code maximum, `BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT=300000`, and `BRVIN_RETRIEVAL_CIRCUIT_BREAKER=false`. Production's configured allowance and deployed code remain 800; the breaker is not yet configured there. This is quota plumbing only; production quota policy, fair-share, capacity and cost gates remain open.

**Current M15 receipt state:** isolated staging D1 contains three passed rows: baseline 18728f63-e13d-4e73-880f-a2b980844d04, post-score-floor paired receipt fa1b8076-9375-480b-bb4b-e22d1c13d9bb, and expanded receipt 0f5f9769-452a-466e-b5ae-735ddba6378a. November project usage is 45. The expanded run used 24 reservations (21→45), completed 12/12 against both providers, found 11/11 page-target instances across seven distinct source/page pairs, and had zero provenance violations. AI Search returned zero candidates for both no-match prompts; Qdrant returned five unrelated candidates. Sequential p50/p95 was 3,333/6,762 ms for AI Search and 1,162/1,216 ms for Qdrant/Vertex (n=12; not load/SLO evidence). The two staging sources are both Physics. The existing review pack remains ungraded by independent human reviewers; no gate or cutoff is selected.

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
| `brvin_projects` | One logical consumer/application project. In addition to UUID/name/slug/description/status, BRVIN Teachers-managed records store owning application, external TCH tenant reference, subject, PRJ reference and idempotent management-request metadata. |
| `brvin_collections` | Named reusable grouping of knowledge sources. BRVIN Teachers-managed collections record owning application/tenant, originating project, COL reference and idempotency metadata. |
| `brvin_books` | One registered source. Includes title, filename, SHA-256, expected size, page count, processing status, indexed page count, collection, search prefix, source type and timestamps. BRVIN Teachers sources also store owning application/tenant, originating collection and SRC reference. |
| `brvin_project_books` | Direct project-to-book grants. |
| `brvin_project_collections` | Project-to-collection grants. A project can retrieve ready books in a granted collection. |
| `brvin_service_clients` | Maps trusted Worker client IDs to projects. |
| `brvin_project_search_usage` | Monthly query counter for non-Fatman projects, keyed by project and billing month. |
| `brvin_activity_events` | Append-style audit/activity trail for ingestion, governance, Workflow and deletion phases. |
| `brvin_reference_sequences` | Atomic parent-scoped PRJ/COL/SRC human-readable reference counters for BRVIN Teachers-managed records. |
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
- `owner_application_id` and `owner_tenant_ref`: non-secret BRVIN Teachers owner correlation; not a credential.
- `origin_collection_id` and `source_ref`: the original collection identity and SRC reference for a teacher-managed source.

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

The production precision path is deliberately two-stage and remains evidence-only:

- Up to 3 unique query variants, each normalized and bounded to 2,000 characters.
- Up to 3 explicit physical PDF page numbers per request.
- Hybrid vector + BM25 candidate retrieval, with RRF fusion and the exact D1-authorised folder prefixes.
- Up to 16 candidate chunks per query, with a request-level vector threshold of 0.3.
- Cloudflare's independent `@cf/baai/bge-reranker-base` cross-encoder is enabled per semantic request; its default score threshold is 0.4. The model ID and thresholds are environment-configurable. It ranks evidence; it does not generate a natural-language answer.
- BRVIN bypasses AI Search similarity cache for each request so current index contents are evaluated rather than a cached response for a similar prompt.
- Local meaningful-term coverage remains a second relevance guard. Ordinals such as `second` are meaningful terms, not stop words.
- A bounded semantic response contains at most 6 passages across at most 4 physical PDF pages, at most 2 passages per page, and at most 1,800 characters per semantic passage. The score is the reranking score when available, otherwise the vector/fused score used by the fallback path.
- Exact-page lookup remains a distinct path: up to 3 explicitly requested pages are resolved by exact authorised item key before semantic fallback, with exact-page text separately bounded to 4,500 characters and scanned-page images subject to the existing byte cap.

The shared AI Search index is configured for 256-token recursive chunks with 10% overlap. These settings apply during indexing; an existing item must be synchronised again to receive the new chunking. This is an AI Search re-index operation over the already stored OCR page text, not a Google Vision/OCR rerun. Existing source records remain scoped by their original D1-authorised page prefix and physical PDF page keys.

The v1/v2 RPC response shape, source grants, per-project quota accounting and physical `pdfPage` provenance are unchanged. The connected application still chooses Gemini or another answer model and is responsible for the final answer. Raise retrieval limits or thresholds only through a measured evaluation and explicit capacity review.

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
- **Knowledge projects:** teacher/owner label, project name/description, direct-book and collection grants, source/ready-source counts, active application counts, current-month retrieval usage, project detail modal (sources, collections, application grant history and project-scoped recent events), edit and activate/deactivate actions. The M10 branch adds grant/revoke controls directly in the project detail modal.
- **Applications:** teacher/owner label, purpose, app registry metadata, environment identities, active project grants, edit/suspend/revoke lifecycle and last verified connection state. The M10 branch adds an inline grant control on each application card. Application-project grants are app-wide; a multi-teacher consumer must separately enforce authenticated user-to-project mapping in its own server-side code.
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
- At the M7 release checkpoint, environments were intentionally Pending. M9 now provides the per-environment live private Service Binding verification required before an individual environment is shown as Connected.

### 9.4 M8 ChatGPT integration handoff — deployed and complete

M8 shipped in [PR #95](https://github.com/ashini-x/parmar-ai/pull/95), merged to main as `81bc036ca1ffd2ae7d3ce6ed0170ee2e1e69d9fd`.

The admin application/environment cards expose Generate ChatGPT handoff. A protected read-only endpoint regenerates the handoff from current saved application and environment metadata, validates active status and environment-to-application ownership, and returns a versioned prompt plus structured manifest. The modal shows the revision and generation date and provides copy controls for both outputs.

The generator names private service `brvin-service`, entrypoint `BrvinRetrievalApi`, binding `BRVIN_SERVICE`, and v2 methods `listAuthorizedProjectsV2()`, `getProjectStatusV2({ projectId })` and `retrieveProjectContextV2(input)`. The trusted binding property is `applicationEnvironmentId`, never the legacy v1 `clientId`. The prompt directs ChatGPT to vendor a reviewed, pinned copy of `packages/brvin-connector`, integrate retrieval server-side into the consumer's existing model/tool path, preserve source/page provenance, and complete the security/test checklist.

The generator reads only allowlisted application, repository, environment and runtime metadata plus a configured non-secret BRVIN account-ID reference. It does not inspect the legacy GitHub App/Cloudflare OAuth credential vault. M7 does not record the target consumer's actual Cloudflare account ID, so the handoff requires explicit same-account verification before deployment. Non-Cloudflare runtime providers are blocked for this same-account Service Binding path.

The handoff does not provision or modify a consumer repository, Worker, binding, secret, project grant or deployment, and did not itself claim a live connection. Each environment remains Pending until its own M9 live verification succeeds.

**Validation:** PR Release Validation [#711](https://github.com/ashini-x/parmar-ai/actions/runs/42067500863) passed typecheck, unit/integration tests, Node/browser-script tests and both Worker bundle validations. Main Release Validation [#713](https://github.com/ashini-x/parmar-ai/actions/runs/42067800093) passed the initial feature deployment. The subsequent closeout release [#715](https://github.com/ashini-x/parmar-ai/actions/runs/42068966058) also redeployed the unchanged M8 code and passed paired deployment, root/health/private BRVIN/Fatman smoke and production release acceptance; latest artifact `13434968943`.

**Production deployment versions:** `brvin-service` version `797ea8a6-6735-44c4-afad-2dd19bf2363c`; `parmar-ai` version `5e248a66-1c1a-45df-a23a-fd7b8d941032`.

**Verification limitation:** This session did not have an authenticated admin browser for a manual visual click-through or an actual per-app copy test. CI validated the generated browser script, route and generator contracts. No specific consumer is claimed Connected.

### 9.5 M9 live connection verification — production accepted

M9 shipped in [PR #98](https://github.com/ashini-x/parmar-ai/pull/98), merged as `1a57f53965f30c3de89eb51570548f99eb893e4f`. [Release Validation #728](https://github.com/ashini-x/parmar-ai/actions/runs/42079493490) and [Main Release Validation #729](https://github.com/ashini-x/parmar-ai/actions/runs/42079795434) passed. Release #729 deployed both Workers and passed root, health, private BRVIN Service Binding and Fatman retrieval acceptance. Production versions: `brvin-service` `af406a76-ec5c-4e0b-b401-80dfb1ff2a38`; `parmar-ai` `6e27a398-0bf4-4dba-8cc4-a0e17977bb4e`. Release artifact: `13440845149`.

On 6 November 2026, the administrator used the authenticated BRVIN admin UI to run **Verify connection** for Parmar AI → Production. The user-visible result was **Connected**. A read-only D1 query of `brvin_connection_checks` for environment `00000000-0000-4000-8000-000000000102` independently confirmed `status=connected`, a non-null `proof_hash`, populated `completed_at`, `ready=1`, `authorized_source_count=1` and no failure code. Proof consumption completed at **6 November 2026, 00:12:12.665 IST**. The query wrote zero rows. Raw nonce/proof values are not persisted or disclosed; only hashes are stored.

This closes M9's valid production connection-verification path. Automated M9 tests cover wrong-environment, inactive, expired, forged and replayed challenge/proof rejection. The manual production check exercised the valid Parmar AI Production path; a separate live negative-identity exercise was not performed.

**What Connected proves:** the registered production environment identity is active, the deployed consumer reached private `brvin-service` using its trusted Service Binding identity, the one-time proof was consumed, and the service reported one ready authorised source.

**What it does not prove:** consumer end-user login, Gemini/model/tool wiring, per-teacher user-to-project mapping or cross-teacher isolation. These remain M10/M11 responsibilities. The app-wide application-project grant is not per-user authorisation.

**Next active milestone:** M10 is now complete; its implementation and production acceptance are recorded below. M11 — operations, usage visibility, recovery and administrator handover — is next.

### 9.6 M10 teacher knowledge assignment and isolation — complete

M10 shipped through [PR #99](https://github.com/ashini-x/parmar-ai/pull/99), squash-merged to `main` as `0068d74d8b164cfc64fbc43c23d9449ae8745db5`.

**Admin workflow delivered:**
- Application cards can grant an additional active knowledge project or revoke an existing project grant.
- Knowledge-project details can grant an active application and revoke existing app grants; grant history remains visible.
- Project details provide shortcuts to each listed source's direct-book grant editor and to the collection-grant selector for that project.
- The UI explains that app-project grants are application-wide. A consumer that serves multiple teachers must authenticate the user and map that user to a permitted project on its own server.

**Authorization acceptance delivered:**
- Two distinct trusted application/environment identities represent Teacher A and Teacher B.
- Each app lists only the projects explicitly granted to it; both can access a deliberately shared project.
- Cross-project requests are rejected before quota reservation and AI Search.
- The next retrieval after app-project grant revocation is rejected.
- Direct book grants and collection grants remain independent source-scope controls; only ready, fully indexed books are searched.
- Future ready books added to an already-granted collection are included automatically.
- Inactive projects and environments fail closed.
- Admin API tests cover multiple projects per app, one project shared across apps and idempotent grant behavior. Browser-script tests cover both grant-control views and direct/collection access shortcuts.

**Validation and production evidence:**
- PR Release Validation [#755](https://github.com/ashini-x/parmar-ai/actions/runs/42098579862) passed TypeScript, unit, Node/browser-script tests and both Worker bundle dry-runs.
- Main Release Validation [#756](https://github.com/ashini-x/parmar-ai/actions/runs/42098761142) deployed the paired Workers; root, health, private BRVIN Service Binding, Fatman retrieval and production release acceptance passed.
- `brvin-service` version `97c8b017-0994-4be3-9045-110d8a892b99`; `parmar-ai` version `91222548-5ecc-49e0-8fa8-45daac2e19a6`; artifact `13448441278`.
- Read-only D1 verification (`rows_written=0`) confirmed existing Fatman app-project grants and Parmar AI Production's M9 `connected` proof record remain unchanged. No migration or production test teacher/project/grant was added.

**Scope boundary:** M10's automated fixtures test separate consumer applications, not a shared consumer application's end-user login/session. BRVIN's app-project grants are app-wide. Any future consumer that serves multiple teachers must implement and test its own authenticated user-to-project policy before using multiple teacher projects. The admin UI controls were checked by browser-script contract tests; a separate authenticated visual click-through was not performed in this session.

**Next milestone:** M11 — operations, usage and quota visibility, connection/ingestion recovery, audit and administrator handover.

### 9.7 M11 operations, usage and administrator handover — complete, including real-consumer authorization acceptance

M11's initial implementation shipped in [PR #100](https://github.com/ashini-x/parmar-ai/pull/100), squash-merged as `f7801a558d2a0dae82a449a2ebf0196e24da3fee`. PR Release Validation [#764](https://github.com/ashini-x/parmar-ai/actions/runs/42104068272) passed TypeScript, unit tests, Node/browser-script tests and both Worker bundle dry-runs. Main Release Validation [#768](https://github.com/ashini-x/parmar-ai/actions/runs/42104739449) deployed both Workers; root/health/private BRVIN/Fatman smoke and release acceptance passed; artifact `13450708616`.

The deployed Operations view includes:
- Per-project monthly query use and remaining allowance, driven by the same Core limit helper as retrieval enforcement. Live production uses the configured 800/month value; the code maximum is 300,000, deployed only in isolated staging so far. App grant views show the associated project counter as shared, not application-attributed usage.
- Current environment connection counts, failed/warning event summaries and OCR retention state.
- Event filters for attention, retention, connections, ingestion and governance.
- A protected read-only GCS diagnostic that separates core object permissions from optional bucket lifecycle permissions.
- Failure-aware OCR-only cleanup state, paused unattended retries after a failure, and a manual retry path after GCS permissions are repaired.
- A nontechnical administrator runbook at [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md).

Production versions: `brvin-service` deployment `10fdd281-5f71-4261-b2da-adf568391458`, version `86114707-0bc3-4ee6-a227-bdb9bd9bcc5b`; `parmar-ai` deployment `224c1165-d65b-4693-9f42-1425ffa70521`, version `17386b5c-affb-4064-a261-3eb89c98179d`.

**Production retention finding:** a read-only production audit found Vision OCR cleanup failing because the ingestion service account cannot inspect bucket policy with `storage.buckets.get` on `parmar-fatman-ocr-90db7be4`. The 30-day lifecycle safety net also requires `storage.buckets.get` and `storage.buckets.update`. The observed source was READY with 3/3 pages indexed; its original PDF and searchable pages were retained. No GCP IAM permission was changed by M11 implementation or deployment.

**Read-only D1 verification:** (`rows_written=0`) confirmed existing AskMoina Voice → Fatman and Parmar AI → Fatman grants unchanged, the historical test grant still revoked, and Parmar AI Production's M9 connection record still `connected`, `ready=1`, one authorised source and proof hash present. Production counts remain 3 applications, 2 projects, 3 grant records and 1 connection check. No D1 migration, test tenant, app/project/grant, secret or binding was added or changed.

**Authenticated Operations walkthrough — 6 November 2026:** The administrator reviewed Operational summary, Live pipelines and Specialist activity. The dashboard showed 33 project searches this month, 0 active-environment connection failures, 404 failed events in the last seven days, 0 OCR cleanup failures and no attention required. Source inspection confirms the failed-events card is a seven-day count of activity rows with status `failed`; it is not an HTTP 404 code or a count of currently recoverable failures. Live pipelines reported no active processing or deletion jobs. The failure filter showed repeated older 5 November `storage.buckets.get` permission failures. The latest storage-retention records showed an OCR-only deletion request at 3:36:38 AM and a completed retention event at 3:36:44 AM on 6 November. The original PDF and indexed pages remain available; event details report `objectVersionsFound=0` and `objectVersionsDeleted=0`, so this event does not establish that any object bytes were deleted. No retry or delete control was used during the walkthrough.

**Completed M11 consumer evidence — 8 November 2026:** The real BRVIN Teachers Production consumer returned two relevant semantic passages from the Physics pilot source, both with physical PDF page 2 provenance (displayed relevance scores 0.993 and 0.960). The operator then revoked the application's access to Physics and confirmed the consumer displayed **Not Authorised** on a subsequent request. After restoring the Physics access grant, the same consumer successfully answered again. This completes the real-consumer retrieval, provenance, denial and restoration acceptance. The denial/restoration outcomes are recorded from the operator's explicit confirmation; no separate screenshot or HTTP response capture was supplied for those actions. M11 is complete; no commercial or end-to-end readiness claim is made.
 
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

The BRVIN Teachers platform (`ashini-x/brvin-teachers`) is a separate downstream consumer repository, not part of BRVIN Core. Its Operator Console, teacher profile foundation and classroom/collection/source workflows are deployed, as are both private bindings to the named `BrvinTeachersManagementApi` and frozen `brvin-service` v2 retrieval contract. Its Production application/environment is active and the one-time private proof is accepted. The real Physics project and collection exist, and the registered 3-page source is READY at 3/3 indexed pages. The shared AI Search items were re-indexed under 256-token chunks with 10% overlap, producing 3/4/4 chunks across the three pages. The protected real-consumer semantic query returned two relevant page-2 passages with displayed relevance scores 0.993 and 0.960. After the Production application grant was revoked, the consumer displayed Not Authorised; after access to Physics was restored, the same consumer answered again. M11 is complete. Existing Parmar AI remains a standalone product and is not automatically a BRVIN Teachers tenant. BRVIN owns and enforces teacher knowledge, source readiness and project/source grants; the consumer continues to own user/channel authentication and model orchestration.

### 10.5 Other Cloudflare accounts or non-Cloudflare applications

A Worker in a different Cloudflare account cannot directly use the private same-account Service Binding. A server outside Cloudflare also cannot call the private Worker directly. Design a separate authenticated HTTPS gateway in a later milestone before supporting those consumers.

Keep `brvin-service` private. Do not turn on `workers.dev` or expose the internal RPC Worker as a shortcut. The public gateway is not implemented.

### 10.6 BRVIN Teachers management and retrieval identity — registered, source ready, retrieval and authorization acceptance complete

The separate BRVIN Teachers application lives in `ashini-x/brvin-teachers`. Its latest known production Worker version is `f0942e0a-49f0-468f-b59c-e58d6eb7c16b` (deployment `73699f1d-f9da-4fe4-90bb-77bebc0daf64`, 100% traffic). Its Application D1 has one real teacher row and one active Physics project mapping.

The Core management implementation was merged as [parmar-ai PR #107](https://github.com/ashini-x/parmar-ai/pull/107) and deployed in paired release [#42171109140](https://github.com/ashini-x/parmar-ai/actions/runs/42171109140). The consumer's private `BRVIN_MANAGEMENT` binding targets the named `BrvinTeachersManagementApi` entrypoint on `parmar-ai`; its `BRVIN_SERVICE` binding targets private `brvin-service` / `BrvinRetrievalApi`. Both use the same deployment-controlled `applicationEnvironmentId` `515e7752-20ff-42f9-b393-7c8130a64bf8`. This is not a public REST API and is not part of `BrvinRetrievalApi`.

A read-only production registry check on 7 November confirmed the BRVIN Teachers application and Production environment are active. The one-time challenge/proof flow was accepted on 6 November 2026; its readiness snapshot recorded zero sources because it preceded creation of the pilot's knowledge records. The real teacher has one active Physics project, one teacher-notes collection and one 3-page PDF source in Core. The source is now `ready` with 3/3 pages indexed. The three page items were re-indexed into 3/4/4 chunks under the 256-token / 10%-overlap configuration. On 8 November, the protected consumer retrieval-test route returned two relevant Newton second-law excerpts from physical PDF page 2, with displayed relevance scores 0.993 and 0.960.

The Core entrypoint receives its `applicationEnvironmentId` only through deployment-controlled WorkerEntrypoint props. It verifies the active BRVIN application/environment, exact application slug `brvin-teachers` and registered Worker name `brvin-teachers`. Every project/collection/source operation checks the trusted application, TCH owner reference, BRVIN-owned record and active project/collection grant. It supports project/collection create/list/update, same-tenant collection sharing/revocation and source list/start/chunk/complete/resume/status. PDFs continue through the existing private GCS, Google Vision and Cloudflare Workflow pipeline. The consumer never receives GCS session URIs, provider credentials or direct Core D1/AI Search access.

The additive D1 metadata migration is present in production: owner/origin/reference columns on BRVIN project/collection/source records, request-id/hash fields, `brvin_reference_sequences`, and `fatman_import_jobs.dedupe_scope`. Existing BRVIN Admin uploads retain their legacy global deduplication scope; Teachers uploads use the originating collection as deduplication scope so identical files in unrelated collections remain independent records.

The protected management-health indicator in the Operator Console is a separate UI diagnostic from BRVIN Admin's retrieval proof and was not part of the M11 retrieval/revocation acceptance reported here; it can be visually checked during a future authenticated operator session. M11's real-consumer acceptance is complete: after application access to Physics was revoked, the consumer displayed Not Authorised; restoring Physics access allowed it to answer again. The consumer does not yet implement a student-facing channel/authentication/model runtime.

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


### 9.7 D1 usage optimization and legacy provider retirement — merged and deployed

The 6 November 2026 free-tier D1 usage incident was primarily driven by recurring administrative browser polling and unindexed repeated overview queries, not by the teacher knowledge ingestion pipeline. Historical Cloudflare analytics attributed approximately 3.69 million rows read to the per-book latest Vision-cleanup event lookup (1,161 executions) and approximately 888 thousand to the seven-day activity summary (1,034 executions) in the reported daily window.

Core maintenance PR [#110](https://github.com/ashini-x/parmar-ai/pull/110) was squash-merged on 7 November 2026 and deployed through successful paired production release [#868](https://github.com/ashini-x/parmar-ai/actions/runs/42393606814):
- Removed recurring browser polling from BRVIN Admin, the Main Admin Control Center, Fatman Admin, Fatman Library and Fatman Monitor. Each screen loads an initial snapshot and retains an explicit manual Refresh action.
- Kept all server-side Cloudflare Workflows and scheduled supervisors (OCR, indexing, retries, QA, cleanup and retention) independent of browser tabs.
- Added and verified in production the partial index `idx_brvin_activity_book_vision_cleanup(book_id, created_at DESC, id DESC)`, restricted to `source.vision_ocr_delete_failed` and `source.vision_ocr_deleted`.
- Added a protected, typed-confirmation action at `POST /admin/api/brvin/connect/revoke` to uninstall the recorded `ashini-x` installation of the legacy BRVIN Connect GitHub App, revoke legacy Cloudflare OAuth tokens and erase encrypted credentials only after provider-side revocation succeeds.
- Preserved active consumer Service Bindings, BRVIN application/environment identities, GitHub repository access used by the current engineering connection, and all production D1 records.
- Audited the Cloudflare Workers Builds connection after a docs-only push unexpectedly uploaded a duplicate `parmar-ai` version. Its production deploy command is now `npx wrangler versions upload` (version upload only; no promotion to live traffic), with `*.md` and `docs/**` excluded. GitHub Actions is the sole production promotion/deployment authority and deploys `parmar-ai` plus `brvin-service` as a pair.

The legacy provider retirement action is deployed but has not been run. The last read-only provider-status check still showed the GitHub and Cloudflare provider rows as `connected` with encrypted credentials present. It requires an authenticated administrator to type exactly `UNINSTALL BRVIN CONNECT`. It does not delete the GitHub App registration or Cloudflare OAuth client registration; those manual account actions should follow only after verifying the registrations are dedicated to BRVIN Connect and the revocation results are complete.

The GitHub App registration and Cloudflare OAuth client registration are separate account-owned objects. The [GitHub REST API documentation](https://docs.github.com/en/rest/apps/apps) documents deleting an installation separately from managing the App registration. Cloudflare documents its [OAuth token revocation endpoint](https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/) and [OAuth client registry](https://developers.cloudflare.com/api/resources/iam/) separately.

The D1 quota incident also identified `askmoina-ops` as a possible orphan (no current Worker D1 binding or repository reference was found), but a read-only audit on 7 November confirmed it is **not empty**. It has six user tables: `admin_oauth_states` (0 rows), `admin_sessions` (0), `provider_events` (8), `provider_health` (2), and `request_sessions` (2), plus the D1-managed `_cf_KV` table. The database is 81,920 bytes. A Cloudflare SQL export reached `status=complete` and generated a temporary signed download URL, but this session could not retrieve/store the SQL dump as a durable backup. It has **not** been deleted. Preserve it until a durable export is stored and ownership/retention is explicitly decided. The Veda production/preview IDs recorded in AskMoina configuration were absent from the D1 inventory at the time of the incident; treat this as a separate resource/configuration discrepancy, not a cleanup target.



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


## 14. Production release: cost-aware indexing optimization

Core optimization PR [#131](https://github.com/ashini-x/parmar-ai/pull/131) merged as `920f94749f3174420160942670f4b81b583ae3c2`. Paired production workflow [#42411000687](https://github.com/ashini-x/parmar-ai/actions/runs/42411000687) passed typecheck/tests/build, deployed both Core Workers, passed root + BRVIN-backed health smoke on the first attempt and passed production release acceptance. Live traffic is 100% on `parmar-ai` version `fa5f5fd4-eb77-4d0c-ad07-cd8255b214f2` (deployment `70c15041-c41a-4ed4-9986-673653b6bb0e`) and private `brvin-service` version `0abbe7e6-3a7d-4e34-8f46-321f12796d58` (deployment `4cc87836-634e-4b61-9ee8-4d3859df838d`). Both deployed 7 November 2026. Acceptance artifact is attached to workflow run #42411000687.

This release changes future page submission throughput, status-monitor cadence and QA result-window cost. It does not retroactively reprocess existing ready sources. The fresh Newton pilot completed successfully before this optimization was deployed; use subsequent uploads as the benchmark cohort and compare time-to-READY and AI Search list/upload/QA counts against the prior baseline. No numeric speedup is claimed until representative small, medium and large PDFs have been measured.


## 15. M13 merge and M14 isolated retrieval-pilot checkpoint — 8 November 2026

M13 provider-boundary PR [#147](https://github.com/ashini-x/parmar-ai/pull/147) was squash-merged into Core `main` as `4ab292ff57addef051b28e32477e2136d91add8d`. Its final-head CI passed TypeScript, 259 Vitest tests, 54 Node tests and both Worker dry-runs. The merge triggered the paired production release. The latest Cloudflare metadata check after the M14 foundation release (8 November 2026, approximately 10:45 UTC) reports 100% traffic on `parmar-ai` version `b40095a5-fbe7-4e49-ae6b-67ce5d1b85d0` (deployment `006ed2c3-c6fd-4fab-adb0-0019008883d6`) and `brvin-service` version `f98de22d-6441-4148-98a5-403c62b0f357` (deployment `a5720b14-43f5-4291-961d-aa8e6c8ac5c2`). This records deployment metadata; the latest full live health acceptance remains the 7 November run documented below.

The production provider remains `cloudflare-ai-search`; `BRVIN_CORPUS_MANIFEST_ENABLED=false` remains explicit. The BRVIN v2 private Service Binding, D1 authorization/readiness/quota checks, source filtering, post-retrieval provenance validation and consumer-owned final answer generation are unchanged. No Qdrant collection or Vertex embedding provider is connected to production.

M14's non-production implementation branch is `brvin/m14-vertex-qdrant-physics-pilot`. It adds:
- GCS corpus read/replay that verifies deterministic generation identity, every physical page, raw OCR hash, normalized text hash, chunk content hashes and complete page coverage.
- A sequential replay runner that sends existing durable page chunks to the pilot provider without PDF upload or another Vision OCR operation.
- A Vertex `gemini-embedding-001` REST adapter with separate retrieval-document and retrieval-query task types, explicit output dimensions and truncation/dimension checks.
- A Qdrant dense+sparse collection adapter, IDF sparse configuration, symbol/case-preserving lexical hashing, deterministic point IDs, RRF query fusion, source/project filters and post-query payload checks.
- A fixed Physics evaluation matrix with explicit known-evidence versus pending-OCR-ground-truth labels.

The existing Physics pilot is source `01238b3a-9902-4a42-90b4-574048ee4f00`, project `448249b4-fed9-45f5-9137-6014f242ddbe`, title `Force and Laws of Motion - Class IX pilot handout`, SHA-256 `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`, 3 physical pages, READY at 3/3. Its original Vision operation is `projects/project-90db7be4-619f-4ed7-89b/operations/342f72f46451ffd2`. Production activity history confirms that after retrieval QA passed, the existing retention workflow deleted all three temporary Vision JSON objects while preserving the original PDF and indexed AI Search page text. The original operation therefore cannot be replayed from GCS. PR #157 adds a staging-only, one-time recovery path: verify the retained PDF's exact generation, size and SHA-256; reserve a unique recovery record; submit one new Vision OCR request into the M14 destination bucket; verify all three output files; then persist immutable manifests. Do not upload the PDF again.

M14 remains **in progress**. The repository branch contains mocked tests, not live provider proof. A non-production Qdrant cluster/API key and non-production Vertex project/service-account/location/dimension/quota verification are outstanding. No M14 pilot secrets are set in production Wrangler configuration, no public endpoint was introduced, and no user-facing provider routing has changed. Do not mark M14 accepted until live indexing/replay, mixed-content and exact-symbol retrieval, physical page provenance, grant-isolation, deterministic re-index, latency, throughput and cost tests have all passed.


## 16. M14 source backfill checkpoint — 8 November 2026

M14 pilot foundation PR [#148](https://github.com/ashini-x/parmar-ai/pull/148) is merged as `8d665b48f08cc7197ca306cb0b00417d2321fc72`. Its final CI passed TypeScript, 50 Vitest files / 277 tests, 8 Node files / 54 tests and both Worker dry-runs. The staging-only existing-Vision backfill PR [#149](https://github.com/ashini-x/parmar-ai/pull/149) is also merged as `8b2ca76c3cbc7378334169bf4dc0093ab57e4f53`. Its final CI passed TypeScript, 51 Vitest files / 282 tests, 8 Node files / 54 tests and both Worker dry-runs.

The manifest backfill implementation is in `src/brvin/m14-vision-backfill.ts`. It verifies exact source ID, source SHA-256, operation ID, completed import state, GCP project, output prefix and the complete `output-N-to-N.json` set before reading pages. For this Physics source, the original Vision JSON was already deleted after the production source reached READY. The staging Worker therefore uses the new recovery record to select the replacement Vision operation and its M14-only output bucket/prefix, then reads recovered raw Vision page text and writes immutable manifests to that same separate M14 bucket.

The backfill can execute only when `ENVIRONMENT=staging` and `BRVIN_M14_PILOT_ENABLED=true`. `BRVIN_M14_CORPUS_BUCKET` must be valid and distinct from `FATMAN_GCS_BUCKET`; the M14 corpus reader reads only from this separate bucket. Production Wrangler files remain unchanged and do not enable the M14 flag.

PRs [#155](https://github.com/ashini-x/parmar-ai/pull/155), [#156](https://github.com/ashini-x/parmar-ai/pull/156) and [#157](https://github.com/ashini-x/parmar-ai/pull/157) delivered the browser operator, authenticated read-only OCR diagnostics and one-time retained-PDF OCR recovery. PR [#159](https://github.com/ashini-x/parmar-ai/pull/159) added an independent read-back check using `readBrvinCorpusGeneration`; the user has run it successfully against real GCS. The verified generation is `57129957231e548064e5594d8fb9f501`, recovered Vision operation `projects/project-90db7be4-619f-4ed7-89b/operations/5f6743870ee1aeff`, source SHA-256 `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`, 3 physical pages and 7 chunks (2/2/3). The check recomputed source generation identity, raw OCR hashes, normalized-text hashes, deterministic chunks and formula metadata; it returned `verified: true`.


## 17. M14 staging operator deployment — 8 November 2026

PR [#152](https://github.com/ashini-x/parmar-ai/pull/152) is merged and the dedicated Worker is deployed:

- Worker: `parmar-ai-m14-staging`
- URL: `https://parmar-ai-m14-staging.thenewtongs.workers.dev`
- Version at the initial staging operator deployment: `74ab2c8a-b2e4-443d-ba57-d7ef68e98d53`; latest version after PR #160: `23f3b9a4-add3-4cc0-93c9-f581cedda95d`, 100% traffic
- Environment: `staging`; explicit pilot flag `BRVIN_M14_PILOT_ENABLED=true`
- D1: `parmar-ai-m14-staging`, ID `a8ca999e-4107-4f2f-800e-a1abce3a4cac`, APAC primary, read replicas disabled
- D1 contains the single fixed Physics source row in `m14_source_registry` and its separate exactly-once `m14_vision_recovery` record table.

The Worker binds no production AI Search, BRVIN service, Queue or Durable Object. Its browser operator is served at `GET /admin/m14`; authenticated actions include read-only diagnostics/status, one-time Vision recovery, manifest backfill, corpus read-back verification, Qdrant indexing and known-evidence query evaluation. The recovery route verifies the retained PDF's pinned GCS generation, size and SHA-256 before a single OCR submission to `brvin/m14-staging/vision-output/<sourceId>/attempt-001/` in the separate M14 bucket. The D1 recovery record prevents a duplicate submission. Corpus read-back and Qdrant actions are source-pinned to the Physics pilot and staging-only.

User setup is documented in `docs/BRVIN_M14_STAGING_SETUP.md`: create the separate private GCS bucket in the source bucket's location, create a dedicated service account with bucket-scoped permissions, and add GCP credentials plus a separate admin bearer token as Cloudflare Worker secrets. Do not send credentials to ChatGPT or add them to Git.

Production remains on Cloudflare AI Search, with `BRVIN_CORPUS_MANIFEST_ENABLED=false` and no M14 configuration in either production Wrangler file.


## 18. M14 corpus verification and Vertex/Qdrant operator — 8 November 2026

PR [#159](https://github.com/ashini-x/parmar-ai/pull/159) added the authenticated, read-only GCS corpus verification route. The user ran it successfully. It returned `verified: true` for generation `57129957231e548064e5594d8fb9f501`: source SHA-256 `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`, recovered Vision operation `projects/project-90db7be4-619f-4ed7-89b/operations/5f6743870ee1aeff`, 3 physical pages and 7 chunks (2/2/3). The corpus reader independently recomputed generation identity, raw OCR and normalized-search hashes, deterministic chunk identities and formula metadata from the M14 bucket.

PR [#160](https://github.com/ashini-x/parmar-ai/pull/160) added staging-only authenticated routes for Qdrant indexing and three known-evidence retrieval checks, plus presence-only health configuration checks. The staging Worker is at version `23f3b9a4-add3-4cc0-93c9-f581cedda95d`, 100% traffic. The operator expects Vertex `gemini-embedding-001` in `asia-south1` with 768 dimensions, and the Qdrant collection `brvin_m14_physics_pilot_v1`. Its new endpoints are `POST /admin/m14/qdrant/index` and `POST /admin/m14/qdrant/evaluate`; both are protected by `BRVIN_M14_ADMIN_TOKEN`, require the fixed Physics source ID and execute only on the dedicated staging Worker. The index route checks the immutable corpus before embedding/upserting seven deterministic points. The evaluation route runs the three fixed prior-evidence cases (Newton's second law page 2, 4 kg worked example page 3, bus-braking pages 3/1). It does not claim final M14 acceptance; formula/symbol-sensitive, mixed theory+math, friction, numerical and no-answer cases still require OCR-ground-truth review and live retrieval evaluation.

The Qdrant cluster and API key have not yet been provisioned or configured in Cloudflare. The next operator action is documented in `docs/BRVIN_M14_STAGING_SETUP.md`. No Vertex embedding request or Qdrant upsert/query has been executed. Production remains on `cloudflare-ai-search` with `BRVIN_CORPUS_MANIFEST_ENABLED=false`; the M14 variables and secrets exist only on the staging Worker.


## 19. M15 two-source Core v2 staging operator — 13 November 2026

Core PR [#237](https://github.com/ashini-x/parmar-ai/pull/237) is merged as `a5e6f227761ca6e80e35a781654d1d18ecc7755c`; follow-up PR [#238](https://github.com/ashini-x/parmar-ai/pull/238) is merged as `58364cb214edce4857f961f3168e9f76acb01fff` and fixes the physical-page metadata type for AI Search. It adds `src/brvin/m15-v2-multisource.ts`, protected Prepare/Evaluate routes and browser operator at `GET /admin/m15/benchmark/multi-source`, focused tests, and CI scope rules. The prepare action reuses the existing immutable M14 source `01238b3a-9902-4a42-90b4-574048ee4f00` (three pages, seven chunks, SHA-pinned generation `57129957231e548064e5594d8fb9f501`), indexes into only the M15 staging Qdrant collection and dedicated M15 AI Search instance, and grants it to the existing isolated M15 project in D1 only after both provider indexes are verified.

The evaluation runs five fixed mixed/concept/formula/no-match cases against Cloudflare AI Search and Vertex/Qdrant through the actual Core `retrieveBrvinForApplicationV2` resolver. It checks that exactly two D1-authorized READY sources are present, both providers complete each query and search both sources, source/page provenance is valid, evidence from both sources is returned, and exactly ten staging quota reservations are consumed. Expected physical-page coverage and no-match candidate counts are diagnostics; this small suite is not independent human qrels, final-answer evaluation, a load test, or production acceptance.

The initial post-merge M14 staging workflow [#43299637193](https://github.com/ashini-x/parmar-ai/actions/runs/43299637193) deployed Worker `0ee8d49d-7fd2-4961-963a-ffa033ec357b`. PR #238 corrected the page metadata type. Latest M14 staging workflow [#43311490119](https://github.com/ashini-x/parmar-ai/actions/runs/43311490119) passed typecheck, focused staging tests, versioned provider configuration verification and Wrangler dry-run, then deployed Worker `8d732f8b-b14c-4e47-aeae-ce39d8db9f9f` via deployment `41a5ac03-af07-4212-bfb2-2199f4bb69f9` at 100%. Release validation [#43311489792](https://github.com/ashini-x/parmar-ai/actions/runs/43311489792) passed full tests/build and production-scope classification; production deploy/verification were skipped. The authenticated multi-source operator action has not yet been run.

Read-only D1 verification on 13 November confirms the existing project `890f6317-69f4-4391-aae6-556155ed0d12` is active and has only its original eight-page M15 source READY (8/8). November usage is one query reservation from the passed authorization receipt. `m15_v2_multisource_sources` and `m15_v2_multisource_runs` do not yet exist; they are initialized lazily by the authenticated Prepare/Evaluate actions. This is expected. No second source has been registered or indexed yet.

Operator sequence and pinned manifest details are in [BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md](BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md). Enter `BRVIN_M14_ADMIN_TOKEN` only into the password field on that staging page; never send it to ChatGPT or GitHub. Do not upload the PDF or rerun Vision OCR. Production Core and BRVIN Teachers are unchanged; no Qdrant/Vertex bindings are present in the Teachers Worker.

## 1.4 Offline relevance-gate feasibility — 14 November 2026

The test-only ablation over the committed 109-candidate owner-waived AI assessment is recorded in `docs/BRVIN_M15_RELEVANCE_GATE_ABLATION.md`. It is not a shipped gate or an as-built runtime feature.

| Exploratory strategy | Held-out positive queries preserved | Held-out out-of-corpus queries cleared | Failure |
|---|---:|---:|---|
| Fixed RRF cutoff `>= 0.38` | 12/12 | 3/4 | N04 noise remains |
| Fixed RRF cutoff `>= 0.42` | 11/12 | 4/4 | P02 false abstention |
| Leave-one-query-out lexical coverage | 11/12 | 4/4 | P06 false abstention |

The no-gate baseline retains at least one grade-2+ candidate on 12/12 positive queries but returns candidates on all four out-of-corpus controls. The RRF-based cutoff retains H01's source correction, but the lexical proxy suppresses that grade-3 passage. The 109 candidates are owner-waived AI labels; independent reviewer/adjudicated human fields remain blank. The results are single-source/single-subject feasibility evidence, not calibration. No gate, cutoff or reranker was selected; no production/staging retrieval behavior changed. The next evidence requirement is broader multi-document/query-family qrels with source-group held-out evaluation before a real multi-feature or model-based gate can be chosen.
