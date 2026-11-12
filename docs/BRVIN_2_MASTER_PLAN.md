# BRVIN 2 — Current State and Continuation Plan

**Status date:** 13 November 2026  
**Repository:** `ashini-x/parmar-ai`  
**Production workspace:** [BRVIN Admin](https://parmar-ai.thenewtongs.workers.dev/admin/brvin)

> **This is the single entry point for continuing BRVIN work in a new chat.** It replaces the previous append-only planning ledger. Use this file for current state and next actions; use the linked documents for detailed product acceptance, implementation facts, contracts and operating procedures. Do not treat old milestone drafts or superseded proposals as active work.

## 1. Product definition

BRVIN is a shared, application-aware knowledge platform for managing teacher-specific digital brains and securely connecting independent applications to them.

BRVIN owns the shared knowledge system: PDF ingestion, private source storage, OCR, indexing, collections, readiness, teacher knowledge projects, application/environment identities, project grants, private retrieval, quotas, audit activity and connection verification.

The connected application owns its end-user authentication, teacher-to-project mapping, model, prompts, conversation state, final answer and user experience. ChatGPT remains the software engineer that builds and deploys those consumer applications through the user's separately authorized GitHub and Cloudflare connections.

BRVIN is **not** an autonomous coding agent, repository factory, provider credential vault or BRVIN-owned application CI/CD platform.

## 2. Current canonical documents

Use the documents below in this order. They are the active reference set for BRVIN.

1. **This file — current state and continuation:** current production position, remaining work and new-chat handoff.
2. [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md) — approved product boundary and active M6–M17 milestone status/acceptance.
3. [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) — as-built architecture, infrastructure, D1 model, source lifecycle, trust boundaries and production snapshot.
4. [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md) — accepted architecture decisions; not a task list or status tracker.
5. [BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md](BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md) — approved M12–M17 backend modernization plan, rollback gates and same-UI compatibility rules.
6. [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md) — current private v2 RPC contract for new consumers.
7. [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md) — how ChatGPT integrates a same-account consumer Worker.
8. [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md) — day-to-day beginner-friendly administrator procedures.
9. [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md) — deeper engineering/operator procedures, API routes, troubleshooting and deployment.
10. [BRVIN_PRIVATE_RETRIEVAL_API.md](BRVIN_PRIVATE_RETRIEVAL_API.md) — legacy v1 contract only; consult it when maintaining existing v1 compatibility, not for a new integration.
11. [BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md](BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md) and [BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md](BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md) — live M15 v2 authorization and multi-source staging actions.

The [documentation index](README.md) lists these references. The old autonomous Project Factory proposal and earlier M3 connector/test-client design were removed from the active docs tree because they describe superseded or retired work. Git history preserves the prior text; it is not an implementation instruction.

## 3. Production architecture and shipped capabilities

The current system has two Cloudflare Workers:

- `parmar-ai` is the protected control/admin and ingestion plane. It owns the BRVIN admin UI, upload gateway, GCS/OCR workflow, D1 registry, access grants, usage accounting and operational activity.
- `brvin-service` is the private retrieval plane. It has no public route and `workers_dev: false`. Same-account consumer Workers call it through the `BRVIN_SERVICE` Service Binding and `BrvinRetrievalApi` entrypoint.

The existing shared D1 database and Cloudflare AI Search namespace are reused. Projects do not receive separate databases, indexes or ingestion pipelines.

The completed product baseline includes:
- Teacher knowledge projects, collections and source readiness.
- Resumable PDF upload, private GCS storage, Google Vision OCR, Cloudflare Workflow indexing/QA/recovery and retention cleanup.
- Trusted application and deployment-environment registry.
- Explicit application-to-project grants, with grant revocation and fail-closed retrieval authorization.
- Private v2 retrieval using deployment-controlled `applicationEnvironmentId`, while preserving legacy v1 compatibility for existing Fatman calls.
- Non-secret, repository-specific ChatGPT integration handoff.
- Live connection challenge/proof verification.
- Per-project usage/quota reporting and administrative activity.
- Operations summary, live pipeline view, specialist activity filters and read-only storage/lifecycle diagnostics.
- A separate private `BrvinTeachersManagementApi` WorkerEntrypoint on `parmar-ai`, deployed independently from the retrieval-only `brvin-service` contract. It supports tenant-owned project/collection lifecycle, same-tenant collection sharing, source registration, and secure upload/recovery through the existing Core ingestion pipeline.

## 4. Verified production snapshot

**Latest live read-back: 12 November 2026, 12:39 UTC.** Core `parmar-ai`, private `brvin-service`, isolated `parmar-ai-m14-staging`, and downstream `brvin-teachers` are each at 100% of their current deployments. The 12 November paired Core release after PR #234 shipped the query-only v2 adapter code while production still selects Cloudflare AI Search; this was not a provider cutover.

| Worker | Environment | Version at 100% | Deployment |
|---|---|---|---|
| `parmar-ai` | production | `9d289364-a65d-4fa4-9df7-84f9418eeac2` | `fae0c117-5330-428d-b0cb-0ccb4798acc7` |
| `brvin-service` | production | `fd1fb0c0-98f9-46a8-bf63-6b0f86167359` | `f1c1e8d7-953b-4c75-838c-45c9884f1380` |

Cloudflare settings read-back confirms:

- Both Core production Workers still have `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`.
- `parmar-ai` still has `BRVIN_CORPUS_MANIFEST_ENABLED=false`.
- The Core production `BRVIN_SERVICE` Service Binding still targets private `brvin-service` / `BrvinRetrievalApi`.
- No production Qdrant/Vertex retrieval binding or provider selector is configured.
- The provider selected for production remains Cloudflare AI Search. No cutover, corpus-manifest production write or Qdrant point migration has occurred.

**Why the production Worker versions changed:** Core PR #234 merged as `b6c8698b31298c690949dc76531a217583605e35` and added the query-only Qdrant/Vertex adapter through the existing provider port plus the protected staging Core v2 authorization route. Release validation [#43214641677](https://github.com/ashini-x/parmar-ai/actions/runs/43214641677) passed and deliberately deployed both Core Workers with normal rollback capture and post-deploy health/Fatman acceptance. The production selector remains `cloudflare-ai-search`; production has no Qdrant/Vertex retrieval bindings and `BRVIN_CORPUS_MANIFEST_ENABLED=false`. This was a code release behind the unchanged selector, not a provider cutover. PR #235 added staging receipt persistence/tests and documentation only; Release validation [#43219853527](https://github.com/ashini-x/parmar-ai/actions/runs/43219853527) passed with production deployment and verification skipped.

| Isolated / consumer Worker | Environment | Version at 100% | Deployment |
|---|---|---|---|
| `parmar-ai-m14-staging` | staging | `ffbaa06f-e2ca-46e4-8e82-7516c6738555` | `f4878038-ca99-477a-93f2-2de0c7b1f219` |
| `brvin-teachers` | production | `68d6694c-6371-4cae-8a25-4af40ca15706` | `31ff2a01-b0f4-4be8-92d3-63e2d91adddf` |

Teachers remains a private v2 consumer. Its production Worker has only the Core `BRVIN_MANAGEMENT` (`BrvinTeachersManagementApi`) and `BRVIN_SERVICE` (`BrvinRetrievalApi`) Service Bindings; it has no Qdrant/Vertex provider credentials, SDKs or direct provider access. No Teachers runtime or Worker deployment changed during this M15 continuation.

Additional production facts remain unchanged: shared D1 `parmar-ai-admin-prod`, private source/GCS and OCR workflow ownership in Core, and the completed M11 teacher Physics source/retrieval/revocation/re-grant acceptance. The current provider-migration acceptance state and evidence are in `BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md`.

## 5. Milestone status

M6–M11 are **COMPLETE**. The BRVIN Teachers Production application/environment is registered and active, both private bindings are deployed, the one-time private retrieval proof was accepted, and the real teacher/Physics project/collection/source are present. The Physics PDF is `READY` at 3/3 indexed pages with page chunk counts 3/4/4 under the 256-token / 10%-overlap retrieval configuration.

The protected BRVIN Teachers v2 consumer semantic-retrieval test passed on 8 November 2026. It returned two relevant Newton second-law excerpts from `Force and Laws of Motion - Class IX pilot handout`, both citing physical PDF page 2; displayed relevance scores were 0.993 and 0.960.

The final authorization test also passed on 8 November 2026. The operator revoked BRVIN Teachers Production's access to the Physics knowledge, then confirmed that a consumer retrieval returned **Not Authorised**. After restoring the Physics access grant, the consumer successfully answered again. This verifies fail-closed grant revocation and recovery after re-grant through the real consumer path. The operator's confirmation is the evidence for the denial/restoration outcome; no separate screenshot or HTTP status has been supplied for those final actions.

The earlier connection-proof snapshot recorded zero ready sources because it predated project/source creation. That historical proof snapshot is not the source-readiness or retrieval acceptance evidence. No synthetic production teacher, project, app or grant was used. Existing Parmar AI, Fatman and AskMoina state was preserved.

The Operations walkthrough on 6 November 2026 recorded 33 project searches that month, zero active-environment connection failures, 404 failed activity events in the last seven days, zero OCR cleanup failures and no attention required. Source inspection confirmed that 404 is a seven-day count of activity events whose status is `failed`; it is not an HTTP 404 code or the number of currently recoverable jobs. Live pipelines showed no active processing/deletion jobs. The visible older failures repeated the pre-remediation `storage.buckets.get` permission denial. The latest OCR-only retention request/completion preserved the original PDF and indexed pages.

## 6. Scope guardrails

- Keep retrieval private; do not add a public route to `brvin-service`.
- Use v2 for new consumers. Keep v1 only for compatibility until existing consumers are migrated deliberately.
- Do not create one D1 database, AI Search namespace or OCR pipeline per teacher or app.
- Do not bypass project grants, source grants, connection verification, quotas or readiness checks.
- Do not expose BRVIN D1, GCS, AI Search or provider master credentials to a consumer/browser.
- Do not build a BRVIN-owned coding agent, Project Factory, automatic repository creator, provider-token vault or BRVIN-owned CI/CD.
- Do not revive the retired `brvin-test-client` reference scaffold.
- Cross-account/non-Cloudflare gateway work is deferred. It is not required to finish M11.
- Preserve existing Parmar AI, Fatman and AskMoina data, identities, integrations and production behavior. Do not remove historical provider configuration or legacy UI without a separate dependency audit and approved change.
- Keep Parmar AI as its existing standalone SSC application for now. Do not transfer its code, production data, bot identity or `/admin` into BRVIN Teachers as part of the initial build. Any future migration is a separate decision requiring feature parity, data-continuity, security, operational and rollback acceptance.
- The **BRVIN Teachers** multi-channel, multi-tenant application platform is a separate downstream consumer workstream, documented in [BRVIN_TEACHERS_ARCHITECTURE.md](BRVIN_TEACHERS_ARCHITECTURE.md) and implemented in `ashini-x/brvin-teachers`. Its Operator Console, tenant D1, classroom/collection/source UI, active Production registry identity, both private bindings and accepted one-time retrieval proof are deployed. The real pilot has a Physics project, collection and a 3-page source that is `READY` at 3/3 indexed pages. Useful semantic consumer retrieval, post-revocation **Not Authorised** denial and successful retrieval after restoring the Physics access grant have all passed; M11 is complete. Do not refactor or transfer the existing Parmar AI product into the consumer repository.

## 7. Planned retrieval-provider modernization (M12–M17)

The next planned backend workstream is documented in [BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md](BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md). It keeps both admin experiences and the existing teacher upload/indexing workflow intact while modernizing Vertex AI embeddings + Qdrant hybrid retrieval behind the existing Core v2 API. The retrieval design is unified and math-aware: theory, formulas, worked examples and numerical problems share one candidate-retrieval path, with raw OCR, optional formula/LaTeX representations and physical-page provenance preserved; it is not a collection of separate subject bots.

**Current retrieval-modernization state (13 November 2026):** M13 is merged and M14 is complete only as a scoped non-production Vertex/Qdrant Physics pilot. M15 remains **IN PROGRESS**. The eight-page M15 source remains READY in isolated staging. The paired 17-query retrieval, 34-generation OCR-only consumer evaluation, five-query/ten-generation original-PDF-assisted notation audit and owner-waived AI assessment of all 109 candidates are complete; the AI assessment is not independent human qrels and the original reviewer fields remain blank. The live Core v2 Qdrant/Vertex authorization/revocation action ran on 12 November; persisted receipt `e305a581-3d3c-469c-b2b5-093598783df4` passed **8/8 checks**: authorized retrieval returned three passages on pages 4/5/8; wrong-project and revoked-grant requests were denied before quota; 14 Qdrant points remained while revoked; exactly one authorized quota unit was consumed; and the staging grant was restored. See [the authorization runbook](BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md). Core PR [#237](https://github.com/ashini-x/parmar-ai/pull/237) is merged. Typecheck, full Core test/build, focused M15 staging tests, provider configuration verification and Wrangler staging dry-run passed. The initial post-merge staging workflow [#43299637193](https://github.com/ashini-x/parmar-ai/actions/runs/43299637193) deployed Worker `0ee8d49d-7fd2-4961-963a-ffa033ec357b`. Core PR [#238](https://github.com/ashini-x/parmar-ai/pull/238) then corrected `pdf_page` upload metadata to be numeric, matching the separate M15 AI Search custom-metadata schema, and added a regression test. PR #238 typecheck/full tests, focused M14 staging validation and dry-run all passed; post-merge staging workflow [#43311490119](https://github.com/ashini-x/parmar-ai/actions/runs/43311490119) deployed Worker `8d732f8b-b14c-4e47-aeae-ce39d8db9f9f` at 100%. Release validation [#43311489792](https://github.com/ashini-x/parmar-ai/actions/runs/43311489792) passed and skipped production deployment/verification. The remaining immediate action is the protected two-source preparation/evaluation at `/admin/m15/benchmark/multi-source`: it reuses the immutable three-page M14 corpus, indexes only into the dedicated M15 staging providers, and compares five fixed cases through the real Core v2 resolver. No PDF upload, Vision OCR, Gemini generation, v2 contract or Teachers change is involved. Follow [the multi-source runbook](BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md); the paired evaluation reserves ten staging query units. This is not independent passage qrels, claim-to-passage adjudication, answer correctness, a load test or production acceptance. Remaining M15 gates include broader mixed-content/formula grounding, retry/recovery/throttling, HNSW-aware controlled load, repeatable latency/throughput/cost and rollback rehearsal. Production remains on Cloudflare AI Search; the frozen v2 contract, D1 authority, both admin experiences and Teachers private-consumer boundary remain unchanged. **No production provider cutover is authorized.**

### M15 read-only AI Search baseline — 11 November 2026

The current production AI Search source was queried read-only through the existing shared instance `fatman-2026-8b183803`, filtered to the exact Physics source folder `brvin/books/01238b3a-9902-4a42-90b4-574048ee4f00/pages/`. The three source items were already `completed`; their internal AI Search chunk counts are 3/4/4 (11 total). Their source ID, three physical pages and original SHA-256 match the immutable M14 Physics source. No item uploads/deletes, index creation, OCR, selector or production Worker changes were performed.

The fixed 12-case suite (10 positives, 2 no-match) produced 14 AI Search candidates in total. On the ten positive queries, **8/11 expected physical-page targets** appeared in the top five (72.7% page-target coverage); the expected-page-label precision proxy was 11/14 (78.6%), and mean reciprocal first-expected-page rank was 0.6833. These are physical-page-label proxies only—not chunk-level relevance judgments.

Focused observations:
- Natural-language exact-formula query returned one page-2 general passage (score 0.8805) that did not contain the formula; the separate equivalent-notation query did return the formula chunk at rank 1.
- The uppercase-`F` symbol query returned no candidates despite the source containing `Fnet = m × a`.
- The four-kilogram numerical-setup query returned no candidates; the related worked-example query did return page 3 at rank 1.
- Friction returned page 2 at rank 1 and the direct page-3 worked example at rank 2.
- Bus-braking returned two page-3 candidates, including the answer-key text, but did not return its expected page-1 explanation.
- Both reviewed no-match prompts returned zero candidates. This is retrieval behavior only, not a Gemini abstention test.

The Qdrant v78 pilot receipt covered 11/11 expected physical-page targets. Its chunk-qrels v0.1 metrics were nDCG@5 0.8853, MRR@5 0.9000, grade-2+ recall 1.0000 and precision 0.4000 against source-grounded model-adjudicated labels. **Do not compare the Qdrant chunk-qrels metrics directly with AI Search:** AI Search and Qdrant use different chunk boundaries (11 AI Search chunks vs 7 Qdrant chunks). The same PDF/source is used, but this first checkpoint is an end-to-end source-level comparison, not a chunk-equivalent experiment.

The connector-side request round trips were 1.203–5.065 seconds; they include API/control-plane/client overhead and are **not** Worker-side retrieval latency or evidence against the M15 p50/p95 goals. M15 still needs Worker-timed paired shadow measurements, human passage qrels, broader corpus, query-cost and embedding/storage accounting, D1 authorization/revocation tests, throttling/recovery and concurrency/load tests. Production `parmar-ai` v710 and private `brvin-service` v134 remain at 100% with `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search` and `BRVIN_CORPUS_MANIFEST_ENABLED=false`; no production Qdrant/Vertex binding or provider cutover is enabled. Teachers remains on Worker v12 with only private Core management/retrieval bindings and its own D1; no consumer provider access or deployment was added.

The immutable M14 Physics corpus remains verified in private GCS: generation `57129957231e548064e5594d8fb9f501`, recovered Vision operation `projects/project-90db7be4-619f-4ed7-89b/operations/5f6743870ee1aeff`, 3 physical pages and 7 chunks (2/2/3). The dedicated staging Worker has Vertex `gemini-embedding-001` configured in `asia-south1` with 768 dimensions, plus the isolated Qdrant collection `brvin_m14_physics_pilot_v1`; staging secret presence was verified without exposing any secret values.

The operator's Qdrant indexing action returned success. The index path embeds all seven chunks, waits for Qdrant upsert completion, reads back every deterministic point and verifies exact project/source/page/generation/chunk provenance before reporting success. The subsequent three-query known-evidence evaluation returned HTTP 400. The previous adapter displayed only the HTTP status because it did not parse Qdrant's nested `status.error` field. PR #169 fixes that response parsing and adds a regression test; M14 staging workflow [#30](https://github.com/ashini-x/parmar-ai/actions/runs/42535365154) passed and deployed staging Worker version `f6850b66-6299-426f-b533-df52f9e35e66` at 100% traffic.

**Live retrieval checkpoint (9 November 2026):** after Core PR #171 created and verified the `project_id` and `source_id` payload indexes, the staging operator completed all three prior-evidence Vertex/Qdrant hybrid queries. The response returned `ok: true`, `queryCount: 3`, model `gemini-embedding-001`, 768 dimensions and five Qdrant results per query. All four expected physical-page references were present in top five (100% expected-page coverage): Newton's second law expected [2], retrieved [2,2,1,1,3], expected coverage [2], top score 0.8333334; 4 kg worked example expected [3], retrieved [3,3,2,2,1], coverage [3], top score 1; bus braking expected [3,1], retrieved [3,3,1,2,2], coverage [3,1], top score 1. Expected-page ranks were 1 for Newton page 2, 1 for the 4 kg page 3, and 1/3 for bus-braking pages 3/1.

The original Library PDF `Class_IX_Force_and_Laws_of_Motion_Teacher_Pilot.pdf` was independently inspected on all three physical pages; its SHA-256 exactly matches the immutable corpus source hash `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`. Page 2's canonical equation is `Fnet = m × a`; the 4 kg/20 N/8 N friction example, 12 N net force and 3 m/s² result are on page 3; bus braking is described on page 1 and answered on page 3. Friction/net-force support is on page 3.

**Interpretation:** this was a successful live three-query hybrid smoke test with complete expected-page coverage in top five, not a full relevance/precision/answer-correctness acceptance. The original route's `ok: true` denoted successful execution; it did not enforce a page-coverage threshold or score false positives, formula fidelity or abstention.

Core PR [#174](https://github.com/ashini-x/parmar-ai/pull/174) is merged as `cb9451b`. The first ten-positive-case staging evaluation returned `queryCount=10`, `expectedPageCount=11`, `coveredExpectedPageCount=11`, `expectedPageCoverageRate=1.0`, and `allExpectedPagesCovered=true`. The second receipt, from the updated ranking-metrics Worker, again passed all ten cases and covered 11/11 expected pages. It reports 50 returned results, 20 expected-page-labeled results, strict expected-page-label precision@5 of `0.40`, and mean reciprocal first-expected-page rank of `0.7833333`.

The second run's first expected-page ranks were concept 1, exact formula 2, paraphrase 3, equivalent notation 1, uppercase symbol 2, 4 kg example 1, numerical setup 1, theory+formula 1, friction/net-force 2, and bus braking 1. Compared with the prior receipt (MRR `0.8333333`), only the friction query's expected page 3 moved from rank 1 to rank 2; its result list still contains page 3 once (`[2,3,1,1,2]`, versus prior `[3,2,1,1,2]`). Thus the MRR difference of 0.05 is explained by one position change, while aggregate expected-page precision remains 0.40. The page-label precision proxy is not a human chunk-level relevance judgment: non-target pages may provide useful context. The reviewed negative cases—lowercase `f = ma` and out-of-corpus Planck constant—are now exposed through a separate non-gating retrieval diagnostic; neither this diagnostic nor Qdrant RRF scores prove answer abstention.

Core PR [#177](https://github.com/ashini-x/parmar-ai/pull/177) added page-ranking fields, and PR [#182](https://github.com/ashini-x/parmar-ai/pull/182) added the authenticated, staging-only negative/repeatability action. Its user-run result returned five candidates for each expected-no-match query; the supplied previews did not show the requested exact expression/value. The friction query returned one stable top-five point set across three calls but two orderings because the top two tied at `0.6666667`; the page-3 expected chunk ranked 2/1/1. This is a diagnostic sample, not a pass/fail threshold or answer-abstention test. PR [#186](https://github.com/ashini-x/parmar-ai/pull/186), merged as `0fa5b4c`, now returns complete source chunk text once per unique candidate in the authenticated staging-only `candidateEvidence` payload, mapped to each query/repeat/rank. M14 staging workflow [#49](https://github.com/ashini-x/parmar-ai/actions/runs/42547930766) passed validation and deployed Worker version `f43676e0-d97b-492d-af6c-3495897e3f7b` (version 70) at 100%. Paired Core Release validation #1021 [passed](https://github.com/ashini-x/parmar-ai/actions/runs/42547930835): production `parmar-ai` version `cb3016b7-57f5-4d12-9d0b-e652c355af49` and `brvin-service` version `5cbbd904-726d-4215-acbd-b97de7a7742f` are both at 100%; live provider settings remain `cloudflare-ai-search`, with `BRVIN_CORPUS_MANIFEST_ENABLED=false`. Teachers remains at `68d6694c-6371-4cae-8a25-4af40ca15706` at 100%.

**M14 staging configuration repair (10 November 2026):** Core PR [#188](https://github.com/ashini-x/parmar-ai/pull/188) is merged. M14 staging workflow [#56](https://github.com/ashini-x/parmar-ai/actions/runs/42804774619) passed typecheck, staging-worker tests, the versioned provider-settings guard and Wrangler dry-run, then deployed staging Worker version 71 (`822cd50a-8483-486a-81f6-969ad2dfe9c3`, deployment `0f621a6a-ed13-4b71-9d62-075d7fec8ba7`) at 100%. Cloudflare read-back confirms the five non-secret Vertex/Qdrant settings are present on the active version and `BRVIN_M14_QDRANT_API_KEY`, `BRVIN_M14_ADMIN_TOKEN` and the GCP private key remain secret bindings; the Qdrant API key is not a plain-text var. Paired Core Release validation [#1031](https://github.com/ashini-x/parmar-ai/actions/runs/42804774993) passed and deployed `parmar-ai` version `6350d704-5c4f-493b-bf11-9b3f8dd88a56` (version 696) and `brvin-service` version `cbb94155-58bc-41c1-b585-40718c505580` (version 127), both at 100%. Both production providers still explicitly select `cloudflare-ai-search`; Core Admin still has `BRVIN_CORPUS_MANIFEST_ENABLED=false`. This was a normal paired Core release, not a Qdrant cutover. The authenticated full-text candidateEvidence diagnostic has now been run against isolated M14 staging Worker version 71 and reviewed on 10 November 2026. It returned five candidates for each expected-no-match query. No candidate full text contains exact lowercase f = ma; the closest formula material is uppercase F/Fnet, while the source's canonical equation is Fnet = m × a. The out-of-corpus Planck-constant query returned five unrelated Physics chunks even though its top RRF score was 1.0; RRF is a rank-fusion value, not confidence. These retrieval results do not test answer abstention.

The friction query returned one stable top-five point set but three distinct orderings across three repeats. The directly relevant page-3 worked-example point (be24fe40-ee0d-5324-8f77-3baab3322c69) ranked 1, 1 and 3; top candidates tied at RRF 0.6666667. Treat this as observed tie-order variation in a small diagnostic sample, not candidate-set drift or formal rank-stability acceptance.

The full text permits provisional evidence interpretation, but human chunk-level relevance judgments against the immutable Physics PDF are still required before qrels or chunk precision/recall can be accepted. Do not convert page labels or RRF scores into relevance labels.

**Consumer answer-path correction:** the current Teachers repository does not have a deployed student/channel/model Gemini answer-generation route. Its protected retrieval-test page calls the private v2 retrieval adapter and displays passages; it does not generate a final answer. The earlier instruction to exercise an “existing consumer-owned Gemini answer path” is not executable today. Answer/abstention testing must wait until the actual consumer generation runtime exists or a separately approved operator-only harness is built. Do not change the private v2 contract or give Teachers direct Qdrant/Vertex access.

Core PR #188 repaired and pinned the isolated staging settings. PRs #194 and #196 implemented intent-weighted RRF and worded formula/symbol intent; PR #199 added chunk evidence to the protected positive receipt; PR #201 added dense/sparse formula and symbol component-rank diagnostics. M14 staging Worker version 76 is deployed at 100%. The v75 ten-query positive receipt scored against assistant-adjudicated seven-chunk qrels: macro nDCG@5 0.8556, MRR@5 0.8500, grade-2+ recall@5 1.0000 (20/20) and precision@5 0.4000 (20/50). The v76 component trace explains the two first-rank misses: for natural-language exact-equation discovery, dense ranks both direct page-2 formula chunks first while sparse puts the page-1 overview first; for uppercase F, both legs rank direct page-2 evidence 2/3 but disagree on top distractors (attribution grade 0 vs worked example grade 1). Do not globally retune from this seven-chunk sample; explore a narrow formula-discovery intent distinction and exact-case symbol evidence signal, with regressions across all positives/negatives. Qrels remain assistant-adjudicated rather than independent human gold labels. No re-OCR or re-index is needed. Remaining gates: negative/repeatability if retrieval code changes, two-component-query latency/cost, no-grant/wrong-project isolation, revocation with vectors retained, deterministic retry/recovery, HNSW-aware performance/load, and a consumer answer/abstention harness only once Teachers has an actual generation route. Production remains on Cloudflare AI Search; preserve rollback path and required 14-day soak.

The existing Physics source is `Force and Laws of Motion - Class IX pilot handout`, source `01238b3a-9902-4a42-90b4-574048ee4f00`, project `448249b4-fed9-45f5-9137-6014f242ddbe`, 3 pages, READY at 3/3, source SHA-256 `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`. Its original Vision operation is `projects/project-90db7be4-619f-4ed7-89b/operations/342f72f46451ffd2`. The saved activity history records `source.vision_ocr_deleted`: exactly three temporary OCR objects were deleted after successful retrieval QA while the original PDF and indexed AI Search page text were retained. The M14 staging recovery from the retained PDF is now complete; the recovered operation `projects/project-90db7be4-619f-4ed7-89b/operations/5f6743870ee1aeff` and immutable corpus generation are independently verified. Do not replay the deleted original Vision output or re-upload/re-OCR this PDF for a query-only failure. The original three-page PDF was checked against all seven stored chunks for qrels v0.1, including the canonical page-2 formula `Fnet = m × a`, page-3 4 kg worked example and bus-braking answer key. The ten positive cases now have a live v75 chunk-level ranking receipt; the assistant-adjudicated relevance labels remain provisional rather than independent human gold judgments.

D1 remains the authoritative project/source grant, readiness and quota boundary; GCS remains the private source and derived-artifact store; Vision OCR and Workflows remain unchanged. Production AI Search must remain the only user-facing retrieval provider until the later canary and rollback gates are explicitly accepted.

The same five-stage upload flow, page-index map, retry/recovery semantics and READY gating are compatibility requirements in Core Admin and BRVIN Teachers. Only limited provider-specific wording/advanced diagnostics may change; do not redesign either admin UI.

## 8. New-chat continuation instruction

Start a new BRVIN chat with this instruction:

> Continue BRVIN 2 in `ashini-x/parmar-ai`. Read this file first, then `docs/BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md`, `docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md`, `docs/BRVIN_SYSTEM_REFERENCE.md`, the frozen v2 RPC contract, `docs/BRVIN_M14_STAGING_SETUP.md` and `docs/BRVIN_M14_CHUNK_QRELS.md`. Core PRs #194, #196, #199 and #201 are merged; M14 staging Worker version 76 is deployed at 100%. Its Qdrant query path uses Core-side contribution-weighted RRF (`k=2`): semantic intent uses dense/sparse weights 70/30, while symbolic/formula intent uses 30/70. Worded formula cues such as “equation”, “formula”, “expression”, “uppercase”, “lowercase”, “notation” and “multiplied by” now route as symbolic intent; conceptual, paraphrase, worked-example, friction, bus-braking and Planck no-match prompts remain semantic unless they contain a formula cue. The seven-point fixture replays the friction ranks, yielding page-3 worked-example score 0.4000, page-2 context 0.3333, and page-1 overview 0.2667. Source-grounded assistant-adjudicated qrels v0.1 cover seven stored chunks × ten positive and two no-match cases; the predicted friction nDCG@5/MRR improvement is in-sample, not independent validation. M14 staging Worker v75 is `52468073-ee79-487a-9c02-19ef08c404ee`, deployment `9f2f0264-154b-4ca5-aed6-2e20e1aadf25`. PR #199 added the chunk-evidence receipt; its M14 staging and full Core release validations passed, with paired production smoke tests succeeding. Production Core still explicitly selects `cloudflare-ai-search`; manifest writes remain disabled. Teachers remains on version 12 and has no deployed Gemini answer/abstention route. The v75 positive suite has been scored against qrels (nDCG@5 0.8556, MRR@5 0.8500, grade-2+ recall@5 100%, Precision@5 0.40). The v76 component traces show dense is stronger for the natural-language exact-equation prompt, while both components put direct page-2 evidence at ranks 2/3 for uppercase F but disagree on top distractors. Keep global weights provisional; test a narrow formula-discovery intent distinction and exact-case symbol evidence signal. Remaining work: two-component-query latency/cost overhead, authorization/isolation, revocation, retry/recovery, HNSW/load gates, plus answer-abstention only after an actual consumer answer path exists. The bearer-protected diagnostic token remains a Worker secret and must not be retrieved or exposed; the operator UI requires the token to execute the live receipt. Do not re-upload or re-OCR the fixed corpus. Preserve D1 authorization, private v2 contract, existing admin UIs and secret isolation; never expose Qdrant/Vertex credentials to Teachers.

When a future change alters code, D1, bindings, access rules, ingestion, retrieval or production behavior, update the relevant current reference in the same PR. Keep this file concise and current; do not append a second historical milestone ledger.

BRVIN Teachers is a separately planned consumer repository (`ashini-x/brvin-teachers`), not a BRVIN subsystem. Its architecture lives in [BRVIN_TEACHERS_ARCHITECTURE.md](BRVIN_TEACHERS_ARCHITECTURE.md). Parmar AI remains standalone unless a future migration is separately approved and accepted.


### Fresh M14 live receipts — 10 November 2026

The authenticated v74 ten-positive-query run returned `ok: true`, completed 10/10 cases and covered all 11/11 expected physical pages in the top five. It returned 50 candidates, 20 from expected pages, a physical-page-label precision proxy@5 of 0.4000, and mean reciprocal first-expected-page rank of **0.8333333**. First expected-page ranks: concept 1, exact formula 2, paraphrase 3, equivalent notation 1, uppercase symbol 2, 4 kg worked example 1, numerical setup 1, theory+formula 1, friction 1 and bus braking 1 (its second expected page ranked 3). The previous equal-weight page-level baseline MRR was 0.7833333, so the fresh page-level result is +0.05 with the same expected-page coverage and page-label precision proxy.

This positive receipt only returned page labels/ranks, not point IDs/chunk IDs/text. It cannot be scored against the seven-chunk qrels and does not prove formula-chunk fidelity or actual relevance of non-target-page chunks. The exact-formula, paraphrase and uppercase-symbol expected pages ranked 2, 3 and 2, respectively; their exact retrieved chunks are not visible in this v74 receipt. The 0.40 page-label precision is not chunk-level human precision.

The separate authenticated v74 negative/repeatability receipt returned a stable ordered top five for all three friction repeats. Against the assistant-adjudicated qrels, the friction rank sequence was P3-worked, P2-laws, P1-overview, P1-inertia, P2-tail (grades 3,2,1,1,1), giving nDCG@5 1.0, MRR@5 1.0 and grade-2+ recall@5 2/2 for this one repeated query. Both expected-no-match prompts returned five grade-0 candidates; the diagnostic is retrieval-only, not an answer-abstention test.

Core PR [#199](https://github.com/ashini-x/parmar-ai/pull/199) adds ranked Qdrant point/chunk identities, per-query intent weights and deduplicated stored chunk text to the protected positive evaluation receipt. After its validation passes, merge and deployment, rerun the same ten-query staging action and score each top-five chunk list against `docs/BRVIN_M14_CHUNK_QRELS.md`. That is the outstanding next retrieval-quality check; do not re-index or re-OCR the corpus. Keep the fusion weights provisional until full chunk-qrels scoring is reviewed. Two-component-query latency/cost, authorization isolation, revocation, retry/recovery, HNSW/resource tuning and representative load tests remain open. Production remains on Cloudflare AI Search.


### M14 v76 component-rank diagnostic reviewed — 10 November 2026

The authenticated v76 diagnostic confirms: (1) for `What equation expresses Newton's second law of motion?`, dense ranks the two direct page-2 grade-3 chunks first/second, while sparse ranks the grade-0 page-1 overview first and delays the formula-tail grade-3 chunk to rank 6; (2) for the uppercase-F prompt, both dense and sparse rank the direct page-2 grade-3 chunks second/third but choose different rank-1 distractors (page-3 attribution grade 0 in dense, page-3 worked example grade 1 in sparse); (3) lowercase f=ma and Planck no-match cases still return five grade-0 candidates, with no answer abstention tested; (4) friction's top-five order is identical across all three repeats, with the expected page-3 worked example ranked first.

No code or weights were changed from this trace. Do not raise global dense/sparse weights on this tiny pilot. The next candidate change is a narrow classification for natural-language equation discovery and/or a deterministic case-sensitive symbol-evidence promotion, with regression tests against the current v76 baseline and full qrels/negative replay. Production remains on AI Search. No re-index, OCR, or re-upload is needed.


## M14 v78 authenticated receipt review — 11 November 2026

The v78 authenticated positive and negative/repeatability receipts are now reviewed. The fixed staging corpus remains project `448249b4-fed9-45f5-9137-6014f242ddbe`, source `01238b3a-9902-4a42-90b4-574048ee4f00`, collection `brvin_m14_physics_pilot_v1`, Vertex `gemini-embedding-001` at 768 dimensions. All seven returned point IDs matched the immutable chunk-qrels inventory. The source was not re-uploaded, re-OCRed or re-indexed for these query-only runs.

The ten-query live top-five lists score against qrels v0.1 at macro nDCG@5 **0.8853**, MRR@5 **0.9000**, grade-2+ recall@5 **1.0000 (20/20)** and grade-2+ precision@5 **0.4000 (20/50)**. Against v75, nDCG improves from 0.8556 to 0.8853 and MRR from 0.8500 to 0.9000, with recall and precision unchanged. The improvement is isolated to natural-language equation discovery: the exact-formula top five now has qrels grades `3,3,0,1,0` and ranks both direct page-2 formula chunks first/second (v75 grades were `0,3,3,0,1`). The other nine per-query qrels scores are unchanged. The qrels remain source-grounded model adjudication, not independent human gold labels.

The receipt also reports 11/11 expected physical pages covered, physical-page precision proxy@5 0.4000 and mean reciprocal first-expected-page rank 0.8833333. Keep those page-level measures separate from chunk-level qrels metrics. The exact-formula check records the expected 70/30 dense/sparse weights, but its candidate entries omit the `queryIntent` label; the ranking is evidenced while the intent label is not exposed consistently in that receipt.

The two expected-no-match prompts each returned five candidates, all grade 0 under qrels: lowercase `f = ma` top RRF 0.425 and Planck constant top RRF 0.5. This is a useful negative retrieval diagnostic, not a retrieval abstention pass/fail; RRF is not confidence and the action does not invoke Gemini. The friction query returned the identical ordered top five in all three repeats, with P3-worked rank 1 and the same score/order each time. M16 consumer answer/abstention remains blocked until a real Teachers generation route or separately approved secure harness exists.

M14 remains **IN PROGRESS**. Next gates are independent human qrels and broader multi-document evaluation; latency and Qdrant two-component-call cost; no-grant/wrong-project isolation; revocation with vectors retained; deterministic retry/recovery; and HNSW-aware concurrency/load. Production remains on AI Search; the private v2 API, D1 authorization boundary, and both admin experiences remain unchanged.


## M15 continuation — active shadow benchmark

M14 is closed as the **isolated pilot milestone**, not as approval for production. M15 now owns the unresolved cross-provider acceptance: same-source comparison at passage level, independent human qrels, formula/symbol fidelity, no-grant/wrong-project isolation, revocation while vectors remain, retry/recovery, Worker-side p50/p95/p99, per-1,000 query cost, embedding/index/storage cost, HNSW tuning and representative concurrency/load. The current AI Search baseline above is read-only and did not change the shared index. The protected, source-filtered staging shadow runner is now implemented and deployed (Core PR #209, staging Worker v79). The next step is to execute its authenticated 12-query receipt from the Core Admin staging operator; this does not modify consumer answers or either production route.

Do not add provider SDKs, credentials or direct retrieval to Teachers. Keep the frozen v2 contract, D1 authorization boundary, upload/index UI and current production selector unchanged. M16 remains the later consumer/admin parity step; M17 remains the only controlled production canary/14-day-soak step.


## M15 staging shadow runner — deployed 11 November 2026

Core PR #209 is merged as `136687511673ddcb17ff26aaf4589c3872265466`. The protected M15 read-only paired shadow runner is deployed to isolated staging Worker **v79**, version `a3da7cc7-3556-4e12-a57f-51f2898edb5f`, deployment `8fb4c6cc-0b0a-4d7a-8387-b8550f299807`, serving 100%.

The existing operator page exposes `POST /admin/m15/shadow/evaluate` via the **Run AI Search vs Qdrant shadow benchmark** button. The route requires the staging operator bearer token and exact Physics source confirmation. It runs the fixed 12-case suite (10 positives, 2 no-match) using:
- A search-only AI Search binding to `fatman-2026-8b183803`, with every request constrained to the exact Physics source folder.
- The existing Vertex/Qdrant hybrid query path with exact project/source filters and `ensureCollection: false`, which skips collection/index preparation. Hybrid retrieval still performs its intended dense and sparse `points/query` calls.
- Per-provider Worker-side elapsed time, top-five physical page/passage previews, candidate scores/component ranks, source/page provenance violations and expected-page summary statistics.

Regression coverage includes route auth/source-confirmation/missing-binding gates and a direct Qdrant unit test proving read-only shadow mode makes exactly two dense/sparse `points/query` calls and no collection GET/PUT or payload-index creation.

CI after merge: M14 staging workflow #86 passed, Release validation #1084 passed (typecheck, test, node tests and both Worker dry-run bundles). The production-scope job classified the commit as staging/docs-only (`deploy=false`); production deploy/acceptance jobs were skipped.

Cloudflare read-back confirms staging `ENVIRONMENT=staging`, the AI Search instance binding, the existing Vertex model/location/dimensions and Qdrant collection. Production remains `parmar-ai` v710 and `brvin-service` v134, each at 100%, with `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`; corpus-manifest writes remain disabled and no Qdrant/Vertex production bindings were introduced.

**Execution receipt still pending:** the public staging endpoint could not be invoked by the current tool session (the external request path is denied), and the staging admin token is intentionally not read or copied into chat. Run the new button from the operator page after entering the token locally, then review the 12-query JSON receipt. Do not re-index, re-upload or rerun OCR. The button call is read-only; no AI Search or Qdrant data is mutated.

This is the first M15 execution surface, not M15 acceptance. Passage-level human qrels, broader corpus, grant/no-grant and revoke-with-vectors-retained tests, throttling/recovery, HNSW-aware load, Worker p50/p95/p99 and cost accounting remain open.

## M15 first paired shadow receipt — 11 November 2026

The operator returned `ok=true` for all 12 cases from the pinned 3-page Physics source (10 positive, 2 expected-no-match), with 12/12 successful queries and zero provider failures. Both providers reported zero source/page provenance violations. The receipt's side-effect counters were all zero: no AI Search item uploads/deletes, no Qdrant point upserts/deletes, no source/OCR changes, no provider-selector changes and no consumer-answer changes.

### Page-level results (not passage-qrels scores)

| Metric | Cloudflare AI Search | Vertex + Qdrant |
|---|---:|---:|
| Expected page targets covered | 8/11 (72.7%) | 11/11 (100%) |
| Mean reciprocal first expected-page rank | 0.6833 | 0.8833 |
| Returned candidates across 12 queries | 14 | 60 |
| Expected-page-labelled candidates | 11 | 20 |
| Old returned-candidate page-label ratio | 11/14 (78.6%) | 20/60 (33.3%) |
| No-match queries with any candidate | 0/2 | 2/2 |
| False-positive candidates across no-match queries | 0 | 10 |
| Observed Worker-side p50 | 965 ms | 656 ms |
| Observed Worker-side p95 / p99 | 4,487 / 4,487 ms | 1,316 / 1,316 ms |

The original receipt's `pageLabelPrecisionAt5` field used expected-page-labelled candidates divided by *actual candidates returned*. Since AI Search returned 14 total candidates while Qdrant returned 60, this was not a fixed-denominator P@5 comparison. The original values are preserved above as **returned-candidate page-label ratios** for historical traceability.

The corrected scorecard is merged in Core PR #211 and deployed in staging Worker v80. It now reports fixed-cutoff metrics on every future run. Recomputing this receipt with the fixed denominators gives:
- **All-suite page-label P@5:** AI Search 11/60 = 18.3%; Qdrant 20/60 = 33.3%.
- **Positive-only page-label P@5:** AI Search 11/50 = 22.0%; Qdrant 20/50 = 40.0%.
- **No-match false-positive query rate:** AI Search 0/2 = 0%; Qdrant 2/2 = 100%.

These are physical-page label proxies, not independently judged passage relevance. Qdrant retrieved the expected page targets more reliably and earlier, including the uppercase-symbol target (page 2 at rank 2), numerical setup (page 3 at rank 1), friction worked example (page 3 at rank 1), and both expected bus-braking pages (page 3 rank 1, page 1 rank 3). AI Search returned no candidates for uppercase-symbol and numerical-setup positives, and only the page-3 portion of the bus-braking target. Both providers found the expected page 2 for the formula/concept and mixed theory+formula questions, but the receipt does not establish exact passage-level formula correctness.

The most important counter-signal is Qdrant's no-match behavior: it returned five candidates for each negative query, whereas AI Search returned zero. The reported Qdrant scores (0.425 and 0.5) are RRF fusion scores, **not calibrated confidence probabilities**; do not invent a cutoff from these two examples. This is retrieval-only evidence and does not test Gemini answer abstention.

The 12 sequential timing samples are staging observations, not production SLOs, load tests, p99 capacity evidence or cost measurements. Qdrant's observed p50/p95 are lower in this small sample, but broader controlled tests remain required. AI Search has 11 auto-chunks (3/4/4 per source page); Qdrant has 7 custom chunks. No nDCG/MRR cross-provider passage comparison is valid until independent passage qrels or normalized source-span mapping exists.

### Current deployment and next M15 actions

The scorecard correction is Core PR #211 (merge `44986b2504ece84ca66bbf2a3ad55c118cac4085`) and staging Worker **v80** (version `da7d1874-e762-496b-8eca-17d72f358883`, deployment `d66de3af-53f1-4070-8200-e78ee8ec81e7`) at 100%. Focused staging workflow #88 and full Release validation #1089 passed. The production-scope classifier returned `deploy=false`; production deploy/verification jobs were skipped. Production `parmar-ai` remains v710 and `brvin-service` remains v134; both remain at 100% on `cloudflare-ai-search`.

Next: obtain independent human passage relevance judgments for both chunk schemes (or normalize source spans), expand the corpus beyond this single 3-page source, then run wrong-project/no-grant isolation and revoke-with-vectors-retained checks. Follow with retry/recovery, HNSW-aware controlled load, Worker p50/p95/p99 under representative concurrency, and embedding/index/storage/query cost. Do not change the production provider selector or claim M15 acceptance from this receipt.



## 11 November 2026 — M15 second-source staging operator ready

Core PR #213 merged the second-source M15 staging upload/OCR/corpus/index/paired-query pipeline. PR #214 corrected the production-scope allowlist, and PR #215 fixed monotonic stage progression, partial AI Search indexing resume and the one-use-token UI behavior. The isolated M14 staging Worker is now v82 at 100% (`5784e06d-33a8-4feb-b75b-09c9a5565d47`; deployment `184ad701-884e-4a96-b101-2c8ccab7de74`). The new operator is `/admin/m15/benchmark`; source details and beginner operating instructions are in [BRVIN_M15_SECOND_SOURCE_BENCHMARK.md](BRVIN_M15_SECOND_SOURCE_BENCHMARK.md).

The source is the eight-page generated Physics benchmark (SHA-256 `cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92`). It is uploaded, OCR-complete, corpus-verified and indexed in both dedicated staging providers. The operator reports that the 17-query paired retrieval-only benchmark completed: both providers covered 12/12 positive expected-page targets, Qdrant returned candidates for all four out-of-corpus queries, H01 retrieved its corrective page, and zero provenance violations or indexing/production side effects were observed. This closes the retrieval-only subtest, not the consumer-answer acceptance gate. See [BRVIN_M15_SECOND_SOURCE_BENCHMARK.md](BRVIN_M15_SECOND_SOURCE_BENCHMARK.md) for the reported retrieval result and [BRVIN_M15_CONSUMER_ANSWER_EVALUATION.md](BRVIN_M15_CONSUMER_ANSWER_EVALUATION.md) for the separate Gemini answer/abstention harness. Do not mark M15 complete until answer grounding/abstention, passage relevance, security/revocation, recovery, performance/cost and load gates are reviewed.

## M15 consumer answer and abstention evaluation — 11 November 2026

The retrieval-only second-source paired benchmark is reported complete, but it did not invoke Gemini and cannot establish answer correctness. The repository now has a separate branch `feat/m15-consumer-answer-evaluation-2026-11-11` with an isolated staging evaluator that feeds each provider's source-provenanced M15 excerpts into the existing consumer-owned `generateGeminiAnswer` implementation.

The evaluator keeps the BRVIN v2 RPC retrieval-only and unchanged; it does not add Gemini to the Core Worker or modify provider selection. It exposes authenticated, read-only staging answer routes and reports both providers per query for P01–P12, N01–N04 and H01. A calibrated first-pass rubric checks expected facts, units, directions, symbols, page citations and abstention; full evidence/answers and exact failure cases are downloadable. In the original OCR-only run, H01 exposes a real OCR-to-answer symbol defect: the PDF prints `F_s = −k × x` while the indexed OCR and generated answer render `F_s = -k xx`. The later five-query PDF-assisted audit passes H01 by attaching only the relevant original page and correctly rejecting the positive-sign near-miss; that does not rewrite or repair OCR/index text.

**Code status:** evaluator, calibrated regression tests and the targeted original-PDF visual notation audit are merged in Core PR [#223](https://github.com/ashini-x/parmar-ai/pull/223), merge commit `3c4e7b815bb4f5c21318b083712b2d138b882475`. Final M14 staging validation [#43076308815](https://github.com/ashini-x/parmar-ai/actions/runs/43076308815) passed the focused M14/M15 tests, pinned provider configuration and Wrangler dry-run; Core Release validation [#43076309218](https://github.com/ashini-x/parmar-ai/actions/runs/43076309218) passed TypeScript, the full Vitest suite, Node tests and both Worker bundle dry-runs.
**Deployment status (11 November 2026):** push-triggered M14 workflow [#43076503307](https://github.com/ashini-x/parmar-ai/actions/runs/43076503307) deployed the isolated staging Worker only. Cloudflare read-back confirms `parmar-ai-m14-staging` deployment `9eaac13a-38a9-4823-9d16-c31ff97c9eab`, version `ed239c04-3d71-4194-88c0-d08c8948929c`, created 18:19:13 UTC at 100%. Paired Release validation [#43076503215](https://github.com/ashini-x/parmar-ai/actions/runs/43076503215) passed full validation; production-scope reported staging/docs-only and production deploy/verification jobs were skipped.
**Original consumer answer execution:** the original 34 Gemini generations (17 query pairs × 2 providers) remain complete and immutable. The initial counters were AI Search 9/17 and Qdrant 13/17; offline calibrated re-grade of the same answers is 16/17 for each. P07, P09 and P11 were rubric false negatives. Both providers abstained on N01–N04; Qdrant resisted irrelevant in-corpus evidence in 4/4 cases, while AI Search's 4/4 were no-evidence abstentions. The OCR-only receipt contains notation defects: AI Search P01/P12, Qdrant P08 and both providers on H01. The original PDF/OCR/index remain unchanged.
**New original-PDF formula audit — completed 11 November 2026:** the authenticated five-query audit (P01, P08, P11, P12, H01) completed all five pairs / ten Gemini generations. Core verified the fingerprint-pinned eight-page source SHA and attached only the permitted one-page extraction for each query. Both providers passed 5/5 answer correctness, source-grounding, citation and math-symbol fidelity checks, with zero provenance violations; both correctly render the canonical notation and correct H01's positive-sign near-miss. Retrieval mean/median was 3,848/3,599 ms for AI Search and 913.2/895 ms for Qdrant. Generation mean/median was 8,435.6/7,442 ms for AI Search and 14,278/5,749 ms for Qdrant, with a Qdrant P11 generation outlier of 50,041 ms. This is a small staging comparison, not an end-to-end performance decision. The original PDF, raw/stored OCR, normalized text, manifests, D1, AI Search items, Qdrant points and BRVIN v2 contract were not mutated. The operator route remains `https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/benchmark/answers`; its bearer token is not to be shared.
**Next action:** the targeted PDF-assisted formula audit is complete, so do not rerun it just to reproduce the same result. Decide and validate the intended production symbol-fidelity strategy beyond these five queries (including additional source documents/formula types), then complete independent claim-to-passage grounding and passage qrels, no-grant/wrong-project and revocation-with-vectors-retained checks, retry/recovery, repeated p50/p95/p99 latency and cost measurement, representative load and rollback rehearsal. If all acceptance gates support it, progress to a controlled Qdrant canary with immediate rollback, not a full untested cutover. Keep the original source/OCR/index unchanged unless a separately reviewed migration plan explicitly authorizes new derived artifacts.

The migration remains **IN PROGRESS**, and production remains on Cloudflare AI Search. The five-query PDF-assisted notation check passed, but the normal OCR-only representation still contains formula defects and the five-query pass is not proof of broad formula fidelity. The existing citation/page-presence proxies do not prove independent claim-level entailment. Full details: [BRVIN_M15_CONSUMER_ANSWER_EVALUATION.md](BRVIN_M15_CONSUMER_ANSWER_EVALUATION.md).

Production `parmar-ai` and private `brvin-service` were not deployed by this merge; the Release workflow explicitly skipped production. BRVIN Teachers received no code or deployment changes.

## 12 November 2026 — M15 first incomplete task and reviewer handoff

**Current first incomplete M15 task:** independent passage-level relevance labels and claim-to-passage grounding for the paired eight-page Physics source. The paired retrieval and answer runs, offline rubric calibration, and five-query original-PDF-assisted notation audit are already recorded above; they must not be rerun just to reproduce existing results.

The 109-excerpt review pack is now published as `docs/BRVIN_M15_PASSAGE_QRELS_REVIEW_PACK.md` with its source-fingerprinted machine-readable fixture at `test/fixtures/brvin-m15-passage-qrels-review-pack.json`. The fixture deliberately contains no prefilled grades. Two reviewers must annotate separate copies independently, retain rationales/source spans, then adjudicate disagreements. Model/assistant grades must never be described as independent human qrels.

Once this human review is complete, continue M15 #144 with the remaining wrong-project/no-grant and revoke-with-vectors-retained checks, retry/recovery and throttling, HNSW-aware concurrency/latency/throughput, embedding/index/storage/query cost, and rollback rehearsal. Keep working through these gates without changing the frozen v2 contract or Teachers provider boundary. Production remains on Cloudflare AI Search; no cutover is authorized.

## 12 November 2026 — coordinated M15 continuation receipt

- Core PR [#228](https://github.com/ashini-x/parmar-ai/pull/228) merged the source-fingerprinted 109-passage human review pack, blank reviewer fixture, Core `AGENTS.md` and synchronized Core continuation/milestone documentation. Release validation passed; production deployment and live-production verification were skipped.
- Teachers PR [#46](https://github.com/ashini-x/brvin-teachers/pull/46) merged README, repository-guide and provider-compatibility synchronization. No consumer code, contract, UI, binding or deployment changed.
- Core PR [#229](https://github.com/ashini-x/parmar-ai/pull/229) merged unit regression tests for revoked D1 application-project grants failing before quota/search and for Qdrant re-applying the current source allowlist to both dense/sparse calls on every query. An empty allowlist exits before embedding/network calls. These are unit guardrails only, not live end-to-end Qdrant revocation acceptance.
- Core PR [#230](https://github.com/ashini-x/parmar-ai/pull/230) merged the production-scope allowlist correction for `test/brvin-v2-service.test.ts`. Its Release validation passed and production deployment/verification jobs were skipped.
- Core PR [#231](https://github.com/ashini-x/parmar-ai/pull/231) merged the M14 staging push-path correction. M14/M15 tests continue to run during PR validation; test-only merges no longer trigger an M14 staging upload. Its Release and staging validation passed; production and staging deploy steps were skipped on the PR event.

The first uncompleted M15 operator action is the protected live Core v2 Qdrant authorization/revocation proof on isolated staging. Passage relevance was advanced using the owner's explicit AI-assessment waiver; the 109 AI-assessed labels remain separate from blank human-review fields and must not be called independent human qrels. The v2 staging route is deployed by PR #234 and receipt persistence is merged in PR #235. Run it once using the local-only `BRVIN_M14_ADMIN_TOKEN` entry in the [M14 staging operator](https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m14), then read the staging D1 receipt using [the runbook](BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md). Do not paste the token or result secrets into chat. The route lazily creates `m15_v2_authorization_runs`; no table before its first execution is expected. After a green receipt, proceed to M15's broader mixed-content, retry/recovery, HNSW/load, latency/cost and rollback gates. Production remains `cloudflare-ai-search`; no cutover is authorized.


## 12 November 2026 — owner-waived M15 passage assessment

The project owner explicitly authorized an AI-assisted passage assessment instead of independent human review for the M15 staging gate. Core PR #233 adds a separate machine-readable assessment of all 109 saved candidates and a test that verifies label completeness, grade range, retained blank human-review fields and reproducible metrics. See [BRVIN_M15_OWNER_WAIVED_AI_PASSAGE_ASSESSMENT.md](BRVIN_M15_OWNER_WAIVED_AI_PASSAGE_ASSESSMENT.md). This is owner-waived AI qrels, not independent human qrels.

For the 12 positive queries, both providers achieved a grade-2+ top-five hit on 12/12 and mean MRR 1.0. AI Search returned 22 candidates, 19 grade-2+ (86.4% precision among returned candidates; fixed-depth P@5 31.7%), with mean nDCG@5 0.9977. Qdrant returned 60 candidates, 22 grade-2+ (36.7% on both returned-candidate precision and fixed-depth P@5), with mean nDCG@5 0.9905. The denominator difference is important: AI Search often returns fewer than five candidates. For N01–N04, AI Search returned zero candidates; Qdrant returned 20 (15 grade 0, five grade 1, none grade 2+). Both ranked source-grounded H01 sign-correction evidence first.

This does not make Qdrant a quality winner. It confirms both find a strong top passage on this small fixed suite, while Qdrant carries substantially more lower-ranked/negative-control noise. Its separate sequential staging timing remains faster (p50 784 ms / p95 1,097 ms vs 2,524 / 10,477 ms for AI Search) but is not load or production evidence. Continue staging work; production remains on Cloudflare AI Search and M15's live security, recovery, broader-corpus, cost/load and rollback gates remain open.


## 12 November 2026 — M15 Core v2 staging execution readiness

Core PR #234 merged the query-only Qdrant/Vertex adapter through the existing provider port and added a protected staging action invoking the real `retrieveBrvinForApplicationV2` function. The M15 staging Worker is deployed at 100%; its isolated D1 still requires the one-time operator action to seed its fixed test application/environment/project grant and execute authorized, ungranted and revoked queries. Core PR #235 (`99708ceab9ca83c415bb10cdf2c74ded012c9997`) merged the receipt persistence and staging test. The `m15_v2_authorization_runs` table is created lazily when the protected action calls `ensureFixture`; before the first run, a read-only D1 query returning `no such table` is expected, not a deployment error. See [M15 v2 authorization staging runbook](BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md).

This is not production acceptance: the adapter is query-only and production remains Cloudflare AI Search. The live authorization/revocation subgate has since passed under receipt `e305a581-3d3c-469c-b2b5-093598783df4`; M15 still requires multi-source retrieval validation, broader mixed-content quality, recovery, representative load, repeatable latency/cost and rollback.


## 13 November 2026 — M15 Core v2 authorization passed; multi-source gate opened

The live authorization receipt recorded in the runbook passed all eight checks. The authorized read returned three passages from pages 4, 5 and 8; the unknown-project and revoked-grant requests were denied before quota; the 14 Qdrant points remained during revocation; the quota counter moved from 0 to 1 only for the authorized retrieval; and the temporary grant was restored.

Core PR [#237](https://github.com/ashini-x/parmar-ai/pull/237) is merged and its staging operator is deployed. The post-merge M14 staging workflow [#43299637193](https://github.com/ashini-x/parmar-ai/actions/runs/43299637193) deployed Worker `0ee8d49d-7fd2-4961-963a-ffa033ec357b` at 100%; Core Release validation [#43299637172](https://github.com/ashini-x/parmar-ai/actions/runs/43299637172) passed and skipped production deployment/verification. The operator reuses the already verified M14 three-page/seven-chunk corpus as the second source in the existing eight-page M15 project, indexes only into the dedicated M15 staging Qdrant collection and separate AI Search instance, then exposes both sources through the real Core v2 resolver. The protected preparation/evaluation action has not yet been run. The paired evaluation runs five fixed cases against both providers and consumes ten staging project-query units.

The code and provider evaluation remain Core-owned. BRVIN Teachers continues using the unchanged private v2 binding; no Qdrant/Vertex SDK, secret, embedding, direct provider route, UI change or consumer deployment is part of this gate. Production remains on Cloudflare AI Search. See [the multi-source staging runbook](BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md).
