# BRVIN 2 — Current State and Continuation Plan

**Status date:** 9 November 2026  
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
2. [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md) — approved product boundary and active M6–M11 milestone status/acceptance.
3. [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) — as-built architecture, infrastructure, D1 model, source lifecycle, trust boundaries and production snapshot.
4. [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md) — accepted architecture decisions; not a task list or status tracker.
5. [BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md](BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md) — approved M12–M17 backend modernization plan, rollback gates and same-UI compatibility rules.
6. [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md) — current private v2 RPC contract for new consumers.
7. [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md) — how ChatGPT integrates a same-account consumer Worker.
8. [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md) — day-to-day beginner-friendly administrator procedures.
9. [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md) — deeper engineering/operator procedures, API routes, troubleshooting and deployment.
10. [BRVIN_PRIVATE_RETRIEVAL_API.md](BRVIN_PRIVATE_RETRIEVAL_API.md) — legacy v1 contract only; consult it when maintaining existing v1 compatibility, not for a new integration.

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

The latest paired Core production release is **Release validation #1021** on 9 November 2026, from Core main commit [`0fa5b4c`](https://github.com/ashini-x/parmar-ai/commit/0fa5b4c3f252e5fcdb27e8fd67f1ed4ddf0b7917). The release workflow [#42547930835](https://github.com/ashini-x/parmar-ai/actions/runs/42547930835) passed typecheck, Vitest, Node tests, both Worker bundle validations, the paired production deployment, smoke checks and the production acceptance record. Both Core Workers are at 100% traffic.

| Worker | Production version | Deployment |
|---|---|---|
| `brvin-service` | `5cbbd904-726d-4215-acbd-b97de7a7742f` | `e90c73bf-9a29-423e-b6fd-ffa2d0e483e9` |
| `parmar-ai` | `cb3016b7-57f5-4d12-9d0b-e652c355af49` | `bb98c4b4-b9d8-4497-a96f-07dddc4b2644` |

The release was the normal paired Core deployment triggered by merging the M14 staging-diagnostic enhancement; it was **not** a retrieval-provider cutover. Cloudflare version metadata confirms `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search` on both production Workers and `BRVIN_CORPUS_MANIFEST_ENABLED=false` on `parmar-ai`. No production Qdrant routing or production corpus write was enabled.

The isolated M14 staging Worker is now at version `f43676e0-d97b-492d-af6c-3495897e3f7b` (version 70), deployment `46afcf54-a56d-47fa-a0bf-10bdc40e9dd9`, 100% traffic. The separate Teachers consumer Worker remains at `68d6694c-6371-4cae-8a25-4af40ca15706`, 100% traffic; no Teachers deployment was required.

Additional verified production facts:
- D1: `parmar-ai-admin-prod` (the existing shared registry/analytics database).
- Shared OCR bucket: `parmar-fatman-ocr-90db7be4`.
- The administrator confirmed **Lifecycle configuration permissions: READY** and **30-day OCR lifecycle rule: INSTALLED (age 30 days)**.
- The Rain Gardens 3-page sample source remains `READY`, 3/3 indexed, with its original PDF and indexed search pages retained.
- The 6 November OCR cleanup completion event reported `objectVersionsFound=0` and `objectVersionsDeleted=0`. It confirms the dedicated OCR prefix was clear; it does not prove that this run physically deleted a positive number of objects.

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

The next planned backend workstream is documented in [BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md](BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md). It keeps both admin experiences and the existing teacher upload/indexing workflow intact while evaluating Vertex AI embeddings + Qdrant hybrid retrieval behind the existing Core v2 API. The retrieval design is unified and math-aware: theory, formulas, worked examples and numerical problems share one candidate-retrieval path, with raw OCR, optional formula/LaTeX representations and physical-page provenance preserved; it is not a collection of separate subject bots.

**Current state (9 November 2026): M13 remains merged and production continues on Cloudflare AI Search.** Core main is `0fa5b4c3f252e5fcdb27e8fd67f1ed4ddf0b7917`. The M14 foundation, corpus recovery, staging operator, Vertex/Qdrant pilot, query diagnostics and full candidate-evidence enhancement are merged, including [PR #182](https://github.com/ashini-x/parmar-ai/pull/182) and [PR #186](https://github.com/ashini-x/parmar-ai/pull/186). The latest paired production release is #1021; both production Workers remain on `cloudflare-ai-search` and corpus-manifest writes remain disabled. No production Qdrant routing or corpus write is enabled.

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

Core PR #188 and M14 workflow #56 have repaired and deployed the versioned staging settings. No re-OCR, re-index or repeat of the ten-positive suite is needed. Remaining M14/M15 gates are human chunk qrels, formula/symbol fidelity, tied-rank investigation, no-grant/wrong-project isolation, revocation with vectors retained, deterministic retry/recovery, HNSW-aware performance/load and cost. Production remains on Cloudflare AI Search; preserve the legacy rollback path and the required 14-day production soak.

The existing Physics source is `Force and Laws of Motion - Class IX pilot handout`, source `01238b3a-9902-4a42-90b4-574048ee4f00`, project `448249b4-fed9-45f5-9137-6014f242ddbe`, 3 pages, READY at 3/3, source SHA-256 `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`. Its original Vision operation is `projects/project-90db7be4-619f-4ed7-89b/operations/342f72f46451ffd2`. The saved activity history records `source.vision_ocr_deleted`: exactly three temporary OCR objects were deleted after successful retrieval QA while the original PDF and indexed AI Search page text were retained. The M14 staging recovery from the retained PDF is now complete; the recovered operation `projects/project-90db7be4-619f-4ed7-89b/operations/5f6743870ee1aeff` and immutable corpus generation are independently verified. Do not replay the deleted original Vision output or re-upload/re-OCR this PDF for a query-only failure. The only known-evidence cases are Newton-law page 2, the 4 kg worked example page 3, and bus-braking pages 3/1; exact formula/symbol, friction and remaining evaluation labels stay pending OCR-ground-truth inspection.

D1 remains the authoritative project/source grant, readiness and quota boundary; GCS remains the private source and derived-artifact store; Vision OCR and Workflows remain unchanged. Production AI Search must remain the only user-facing retrieval provider until the later canary and rollback gates are explicitly accepted.

The same five-stage upload flow, page-index map, retry/recovery semantics and READY gating are compatibility requirements in Core Admin and BRVIN Teachers. Only limited provider-specific wording/advanced diagnostics may change; do not redesign either admin UI.

## 8. New-chat continuation instruction

Start a new BRVIN chat with this instruction:

> Continue BRVIN 2 in `ashini-x/parmar-ai`. Read `docs/BRVIN_2_MASTER_PLAN.md` first, then `docs/BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md`, `docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md`, `docs/BRVIN_SYSTEM_REFERENCE.md`, the v2 RPC contract and the relevant runbook. Core main is at `0fa5b4c3f252e5fcdb27e8fd67f1ed4ddf0b7917`; full candidate evidence PR #186 is merged. The staging-only full-text diagnostic is deployed in M14 staging Worker version `f43676e0-d97b-492d-af6c-3495897e3f7b` (version 70). M14's immutable Physics corpus remains 3 pages/7 chunks (2/2/3), SHA `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`, Vertex `gemini-embedding-001`, 768 dimensions, collection `brvin_m14_physics_pilot_v1`. Both ten-positive receipts covered all 11 expected page references; latest page-label precision@5 is 0.40 and first-expected-page MRR is 0.7833333. The authenticated M14 negative/repeatability diagnostic has been reviewed: both expected-no-match prompts returned five candidates; the lowercase-symbol expression was absent from all candidate texts, and the Planck query returned unrelated Physics chunks. The friction query retained one top-five set but produced three orderings; the directly relevant page-3 chunk ranked 1/1/3. Human chunk qrels remain open. The current Teachers repository has no deployed Gemini answer/abstention route; its retrieval page returns evidence only, so answer testing awaits a real consumer generation runtime or separately approved harness. Latest M14 staging Worker is `822cd50a-8483-486a-81f6-969ad2dfe9c3` (version 71) at 100%, with five Vertex/Qdrant vars verified and provider credentials in secret bindings. Core production remains on AI Search: `parmar-ai` `6350d704-5c4f-493b-bf11-9b3f8dd88a56` (version 696), `brvin-service` `cbb94155-58bc-41c1-b585-40718c505580` (version 127), and `BRVIN_CORPUS_MANIFEST_ENABLED=false`. Do not re-OCR or re-index the seven points. M14 remains in progress; the next staging-only diagnostic enhancement adds one dense-only and one sparse-only rank trace for the friction query, using the same authorized filter, to explain the observed RRF ordering ties without changing hybrid ranking. Preserve D1 authorization, private v2 contract, existing Core/Teachers UI, and never expose Qdrant/Vertex credentials to the consumer.

When a future change alters code, D1, bindings, access rules, ingestion, retrieval or production behavior, update the relevant current reference in the same PR. Keep this file concise and current; do not append a second historical milestone ledger.

BRVIN Teachers is a separately planned consumer repository (`ashini-x/brvin-teachers`), not a BRVIN subsystem. Its architecture lives in [BRVIN_TEACHERS_ARCHITECTURE.md](BRVIN_TEACHERS_ARCHITECTURE.md). Parmar AI remains standalone unless a future migration is separately approved and accepted.
