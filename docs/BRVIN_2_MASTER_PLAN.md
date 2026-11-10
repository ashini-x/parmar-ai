# BRVIN 2 — Current State and Continuation Plan

**Status date:** 10 November 2026  
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

**Current state (10 November 2026): M13 remains merged; M14 is an isolated Vertex AI + Qdrant staging pilot at staging Worker v75; production remains on Cloudflare AI Search.** Core PR [#194](https://github.com/ashini-x/parmar-ai/pull/194) merged as `ab3974bc7b0125498a6d0c2453018b3e75e61fca`, and PR [#196](https://github.com/ashini-x/parmar-ai/pull/196) merged as `e60710490ec0ac5068aaa43ddf882ad02df7721a`. Core applies intent-weighted RRF in the M14 Qdrant path: semantic questions use 70% dense / 30% sparse; formula/symbol prompts (including worded cues like “equation”, “formula”, “uppercase”, and “multiplied by”) use 30% dense / 70% sparse. Stable component and final tie ordering remain enabled. PR #196 adds source-grounded, assistant-adjudicated chunk qrels v0.1 for seven points and twelve query cases in `docs/BRVIN_M14_CHUNK_QRELS.md`. M14 staging Worker version 75 (`52468073-ee79-487a-9c02-19ef08c404ee`, deployment `9f2f0264-154b-4ca5-aed6-2e20e1aadf25`) is serving 100% with the expanded positive chunk-evidence receipt. Both production Core Workers remain at 100% and their active settings still select `cloudflare-ai-search`; `BRVIN_CORPUS_MANIFEST_ENABLED=false`. Teachers remains unchanged on its existing version-12 deployment. No user-facing Qdrant cutover has occurred.

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
