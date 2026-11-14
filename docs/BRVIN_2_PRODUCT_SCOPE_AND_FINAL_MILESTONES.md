# BRVIN 2 — Product Scope and Active Milestone Acceptance

**Status date:** 14 November 2026  
**Status authority:** [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md)  
**As-built authority:** [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md)

This document defines the active BRVIN product boundary and the final milestone ledger. It is not a chronological implementation diary. Older milestone drafts are not active requirements.

## 1. Approved product

BRVIN is a shared, application-aware knowledge platform for teacher-specific digital brains. It manages teacher knowledge sources and securely serves them to independently built applications.

BRVIN owns ingestion, OCR, indexing, projects, collections, source grants, trusted application/environment identity, app-project grants, private retrieval, quotas, audit events and connection verification.

The connected application owns end-user authentication, teacher/user-to-project mapping, model generation, prompts, conversation/session state and the final user experience. ChatGPT remains the user's engineer for application code, repository work, testing and deployment through separately authorized GitHub and Cloudflare connections.

## 2. In scope

- Protected administrator workspace for teacher knowledge and application connections.
- PDF upload, private storage, OCR, indexing, retrieval QA, readiness and retention.
- Shared D1 registry, shared AI Search namespace and central ingestion pipeline.
- Multiple applications and deployment environments with trusted identities.
- Explicit application-to-project grants, revocation and source-level authorization.
- Private same-account Cloudflare Service Binding RPC.
- Versioned v2 retrieval and one-time live connection verification, with v1 compatibility retained for current Fatman usage.
- Project-level usage/quota and specialist activity visibility.
- Administrator procedures and safe recovery.

## 3. Explicitly out of scope

- BRVIN autonomous coding agent, software Project Factory or automatic app/repository generation.
- BRVIN-owned app CI/CD, broad provider administrator credential vault or automatic provider-token rotation.
- A new D1 database, AI Search instance or ingestion/OCR pipeline per teacher or app.
- Public access to the private `brvin-service` Worker.
- Cross-account or non-Cloudflare retrieval gateway in the current delivery.
- BRVIN-owned model response generation or end-user authentication.
- A per-environment project grant model unless a later product decision justifies it.

## 4. Active final milestone ledger

M0–M5 are earlier implementation stages and are not open tasks in the current delivery. The active final sequence is M6–M11.

| Milestone | Scope | Current status | Evidence / acceptance |
|---|---|---|---|
| M6 | Teacher-focused admin workspace | **COMPLETE** | Knowledge projects, source visibility, administration and project-oriented workspace shipped. |
| M7 | Application/environment registry | **COMPLETE** | Applications, deployment environments and repository/runtime metadata registered in the shared D1 registry. |
| M8 | ChatGPT integration handoff | **COMPLETE** | Versioned, dated, non-secret repository/environment-specific integration handoff shipped. |
| M9 | Live connection verification | **COMPLETE** | Private challenge/proof flow accepted in production; Parmar AI Production is connected with one ready authorized source. |
| M10 | Teacher knowledge grants and isolation | **COMPLETE** | Grant/revoke controls, source-access shortcuts and two-application/project-isolation tests deployed and accepted. |
| M11 | Operations, usage and administrator handover plus real consumer acceptance | **COMPLETE** | Operations, lifecycle rule verification, authenticated admin walkthrough, useful consumer retrieval with PDF-page provenance, post-revocation denial and successful retrieval restoration after re-grant are verified. |

## 5. M11 acceptance detail

**M11 status: COMPLETE — 8 November 2026.**

### Completed and verified

- Operations summary displays monthly project searches, active-environment connection failures, failed activity events and OCR cleanup failures.
- Live pipelines reports active processing/deletion jobs and recoverable work.
- Specialist activity supports failure/warning, retention, connection, ingestion and governance filters.
- Protected read-only GCS diagnostic distinguishes object access, lifecycle-management permissions and the actual lifecycle rule.
- Five-minute retention supervisor checks/installs the exact 30-day OCR-only lifecycle rule while preserving unrelated rules and protecting source-PDF paths.
- Administrator confirmed **Lifecycle configuration permissions: READY** and **30-day OCR lifecycle rule: INSTALLED (age 30 days)**.
- OCR-only cleanup event history was reviewed. The latest visible completion stated that the original PDF and indexed search pages remain available. The event detail reported zero object versions found and zero deleted; no positive physical-deletion count is claimed.
- Authenticated Operations walkthrough completed on 6 November 2026. It reviewed Operational summary, Live pipelines, Failures and warnings, and Storage and OCR retention.
- BRVIN Teachers' Operator Console, tenant D1, classroom/collection/source UI and private bindings are deployed. The real teacher, Physics project, collection and 3-page PDF source are registered; the source is `READY` at 3/3 indexed pages.
- The Physics source's three page items were re-indexed from stored OCR under 256-token chunks with 10% overlap, with verified chunk counts 3/4/4 and no PDF re-upload or repeat Vision OCR operation.
- **Semantic retrieval passed:** the protected BRVIN Teachers v2 diagnostic returned two relevant Newton second-law passages, both citing physical PDF page 2 (displayed relevance scores 0.993 and 0.960).
- **Revocation denial passed:** after the Production app's access to Physics was revoked, a subsequent real consumer request displayed **Not Authorised**.
- **Restoration passed:** after the Physics access grant was restored, the same consumer successfully answered again. The user/operator confirmed both outcomes on 8 November 2026.
- The earlier one-time connection-proof snapshot recorded zero ready sources because it predated project/source creation; it is retained as historical connection evidence and does not supersede the later source-readiness and consumer tests.

The real-consumer M11 acceptance is complete. This documentation update does not change Core D1, grants, quota, Worker code, bindings or production deployment.

## 6. Deferred future work

A separately authenticated gateway for consumers outside the same Cloudflare account or outside Cloudflare may be considered later. It is deferred and not part of the completed M11 acceptance.

## 7. Delivery discipline

A milestone is complete only when the feature is implemented, automated checks pass, the production deployment/acceptance is verified where required, and the relevant current documents are updated. A documentation-only status update does not substitute for functional acceptance.

Use [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md) for continuation instructions, [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) for current implementation facts, and [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md) for administrator steps.


## 6. Planned retrieval-provider modernization (M12–M17)

M6–M11 remain complete and unchanged. The next planned sequence is defined in [BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md](BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md), which is the detailed acceptance and implementation authority for this workstream.

| Milestone | Scope | Status | Tracking |
|---|---|---|
| M12 | Architecture, trust boundaries, same-UI contract and migration gates documented in both repositories. | **COMPLETE — documentation only**  | [Core #141](https://github.com/ashini-x/parmar-ai/issues/141) |
| M13 | Core provider abstraction, deterministic chunking, immutable raw-OCR/source-page manifests and deterministic corpus replay reader. | **MERGED** — provider boundary and replay reader are implemented; the fixed Physics corpus was independently read back and replayed into the isolated M14 staging index with deterministic point/provenance checks; no production provider switch and corpus writes remain default-off. | [Core #142](https://github.com/ashini-x/parmar-ai/issues/142) |
| M14 | Non-production Vertex AI + Qdrant unified math-aware Physics pilot; live index and source-grounded positive/negative/repeatability evaluation. | **COMPLETE — scoped pilot milestone, 11 November 2026.** Staging Worker v78, immutable 3-page/7-chunk source, ten-positive v78 qrels scoring (nDCG@5 0.8853; MRR@5 0.9000; grade-2+ recall 1.0000; precision 0.4000), reviewed negative cases and stable friction repeats are recorded. This is not production acceptance; independent human qrels, broader corpus, cross-provider benchmarking, security, revocation, latency/cost, recovery and load gates are transferred to M15. Production stays on AI Search. | [Core #143](https://github.com/ashini-x/parmar-ai/issues/143) |
| M15 | AI Search vs Qdrant shadow benchmark including formula fidelity, mixed-query quality, provenance, security, recovery, latency, cost, load and rollback. | **IN PROGRESS — 14 November 2026.** The protected five-case paired Core v2 evaluation after PR #247 passed under receipt [`fa1b8076-9375-480b-bb4b-e22d1c13d9bb`](https://github.com/ashini-x/parmar-ai/blob/main/docs/BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md): Qdrant 7/7 distinct expected page locations and 8/8 query-specific positives (including MS03 M15 pages 2/3); AI Search 7/7 distinct and 7/8 query-specific; zero provenance violations; all seven structural/authorization/quota checks passed. Qdrant still returns three unrelated MN01 candidates; AI Search returns none. Initial offline feasibility analysis of the 109-candidate owner-waived AI pool rejects simple gates: RRF >=0.38 preserves 12/12 positives but clears 3/4 negatives; RRF >=0.42 clears 4/4 but loses P02; leave-one-query-out lexical coverage clears 4/4 negatives but loses P06 (11/12 positives). The fixed RRF cutoffs retain H01's source correction, but the lexical proxy also suppresses it. No gate/cutoff/reranker is selected. Next: broaden independently labelled multi-document/query-family evidence, then source-group held-out multi-feature ablation and only then benchmark a named reranker with measured cost/latency. Broader grounding, recovery/throttling, HNSW/load, repeatable latency/cost, quota redesign and rollback remain open. Production remains Cloudflare AI Search. | [Core #144](https://github.com/ashini-x/parmar-ai) |
| M16 | Coordinated Core Admin and Teachers UI/consumer compatibility; preserve current workflows and v2 response contract. | PLANNED  | [Core #145](https://github.com/ashini-x/parmar-ai/issues/145) · [Teachers #18](https://github.com/ashini-x/brvin-teachers/issues/18) |
| M17 | Controlled canary/production cutover, monitoring, rollback, 14-day soak and only then explicit legacy retirement review. | PLANNED  | [Core #146](https://github.com/ashini-x/parmar-ai/issues/146) |



## Scale and semantic-cache objective — approved 14 November 2026

The cross-cutting capacity target for the existing M15–M17 modernization is **1,000 daily active aspirants, each using up to 10 questions/day: 10,000 questions/day or 300,000 per 30-day month**. Load acceptance must include realistic bursts, not only daily-average throughput. This is a planning target, not evidence that current production has been load-tested or can already serve that demand.

The provider target remains Vertex AI embeddings plus Qdrant Cloud dense/BM25 hybrid retrieval and Core-side RRF. Qdrant Standard avoids a fixed included monthly query allowance like Cloudflare AI Search, but throughput remains resource-bounded; Qdrant Free is for staging/prototypes, not a production availability commitment. Cloudflare AI Search remains the live provider and rollback path until M17's canary and required 14-day soak pass.

Semantic caching is approved as an efficiency requirement, with strict separation of ownership: Core may cache authorized retrieval evidence/results; final-answer cache belongs to the consumer's application layer because the consumer owns Gemini generation. D1 identity, grants, source readiness and usage checks must precede cache reuse. Cache keys/invalidation must account for tenant/project/source scope, corpus generation and model/prompt versions. Numeric calculations with changed operands, units or assumptions, time-sensitive/personalized/context-dependent questions and ambiguous/no-match questions must bypass semantic answer reuse unless separately proven safe.

The last verified Core system reference records an 800-query/month project-level allowance with a code maximum of 800. This is not the same as the student-facing 10/day allowance. Core must redesign the project-wide ceiling and test headroom for at least the 300,000/month target plus measured bursts while preserving authorization, usage accounting, fair-share and abuse protection. This decision adds acceptance requirements to M15–M17; it does not create a new numbered milestone or mark any implementation complete. See [BRVIN_SCALE_AND_SEMANTIC_CACHE_PLAN.md](BRVIN_SCALE_AND_SEMANTIC_CACHE_PLAN.md).

**No production provider cutover has been performed.** The 12 November Cloudflare read-back confirms production `parmar-ai` version `9d289364-a65d-4fa4-9df7-84f9418eeac2` (deployment `fae0c117-5330-428d-b0cb-0ccb4798acc7`) and private `brvin-service` version `fd1fb0c0-98f9-46a8-bf63-6b0f86167359` (deployment `f1c1e8d7-953b-4c75-838c-45c9884f1380`) are both at 100%. Both still select `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`; `parmar-ai` has `BRVIN_CORPUS_MANIFEST_ENABLED=false`. These version IDs were created by an unintended test-only paired redeploy after Core PR #229; that PR changed only tests/documentation, and this was not a provider cutover or a runtime source change.

The isolated M14 staging Worker `parmar-ai-m14-staging` is at version `e58546a5-c9e2-4bef-8d27-da8c606995a7`, deployment `2cbed610-fae7-4212-87ac-0cb5c2a9ff48`, at 100%. BRVIN Teachers remains at production Worker version `68d6694c-6371-4cae-8a25-4af40ca15706`, deployment `31ff2a01-b0f4-4be8-92d3-63e2d91adddf`, at 100%, with only private Core management/retrieval Service Bindings and no provider access.

Core PR #230 fixed the production-scope allowlist for `test/brvin-v2-service.test.ts`; PR #231 fixed the M14 staging push trigger so test-only merges no longer upload staging Workers. Their PR validation passed and their deployment steps were skipped. Both fixes preserve full PR validation while limiting Worker uploads to relevant runtime/config changes. The frozen v2 API, D1 authorization authority and both existing admin experiences remain unchanged.

## 11 November 2026 — M15 shadow runner implementation checkpoint

Core PR #209 is merged; staging Worker v79 is deployed at 100% with the direct AI Search instance binding and existing isolated Vertex/Qdrant settings. M14 staging workflow #86 and Release validation #1084 passed. The production-scope classifier returned `deploy=false`; the two production deployment/acceptance jobs were skipped. The M15 operator's 12-query receipt remains pending. See the migration plan for the exact route, query-only safeguards and remaining M15 gates.

## 11 November 2026 — M15 paired shadow receipt completed

The first authenticated 12-case read-only run completed with 12/12 queries successful for both providers, zero provenance violations and zero writes/side effects. Qdrant covered all 11 expected physical-page targets (MRR 0.8833), compared with AI Search's 8/11 (MRR 0.6833). Qdrant also returned candidates for both no-match cases (2/2; 10 candidates), while AI Search returned zero for both. The initial `pageLabelPrecisionAt5` field used a variable returned-candidate denominator; Core PR #211 corrects future receipts and adds fixed-cutoff P@5 plus explicit no-match false-positive rates. Recomputed fixed all-suite page-label P@5 is 18.3% AI Search and 33.3% Qdrant; positive-only P@5 is 22.0% and 40.0%, respectively. These remain page-label proxies, not human passage qrels. The corrected scorecard is deployed on staging Worker v80; production remains on AI Search. See the migration plan for full per-query interpretation and the next gates.



## 11 November 2026 — M15 second-source staging pipeline and receipts

Core PR #213 added the isolated second-source upload/OCR/corpus/index/paired-query operator; PRs #214 and #215 fixed the production-scope allowlist and staging workflow progression/resume behavior. The exact source is `BRVIN_M15_Physics_Benchmark_Source_v1.pdf` (eight physical pages; SHA-256 `cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92`). It is uploaded, OCR-complete, corpus-verified and indexed in both isolated staging providers. The authenticated 17-query retrieval-only receipt and the separate 17-pair/34-generation consumer answer evaluation are complete; detailed results and caveats are in the migration plan and [BRVIN_M15_CONSUMER_ANSWER_EVALUATION.md](BRVIN_M15_CONSUMER_ANSWER_EVALUATION.md).

The original OCR-only evaluation is immutable. Its calibrated offline score is 16/17 for each provider; formula review found OCR-path defects in AI Search P01/P12, Qdrant P08 and both H01 answers. The later original-PDF-assisted five-query audit passed 5/5 for each provider with the exact original source hash and one page attached per query, without modifying source/OCR/index artifacts. This is bounded visual-evidence success, not OCR/index repair. The production-scope classifier is now corrected and later staging-only work has skipped production deployment. Production remains on `cloudflare-ai-search` with corpus manifests disabled; provider cutover remains blocked.


## 12 November 2026 — M15 original-PDF formula audit completed

The separate authenticated PDF-assisted audit completed all five query pairs (P01, P08, P11, P12 and H01; ten Gemini generations) against the exact pinned eight-page source. Both Cloudflare AI Search and Qdrant + Vertex passed 5/5 answer, source-grounding, citation and mathematical-symbol checks; there were zero provenance violations. Every query attached only its permitted one-page original-PDF extraction. H01's positive-sign request was correctly treated as a near-miss: both systems retrieved page 8 and explained that the source equation is `F_s = −k × x`; it was not an abstention test because page 8 explicitly contains the positive-sign expression as a rejected example.

Qdrant retrieval averaged 913.2 ms (median 895 ms) versus AI Search 3,848 ms (median 3,599 ms) in this small formula-only sample. Qdrant generation averaged 14,278 ms (median 5,749 ms), versus AI Search 8,435.6 ms (median 7,442 ms); Qdrant P11 took 50,041 ms. Do not infer a production end-to-end latency winner from five queries. The PDF-assisted pass does not fix the pre-existing OCR/index formula defects. M15 remains open for independent qrels/claim grounding, broader formula validation, authorization/revocation, recovery, repeatability, cost, load and rollback. Production remains on Cloudflare AI Search.

## 12 November 2026 — M15 reviewer handoff

M15 remains **IN PROGRESS**. The next incomplete quality gate is independent passage relevance and claim-to-passage grounding for the source-fingerprinted second Physics corpus. A 109-excerpt review pack and blank machine-readable reviewer fixture are available in [BRVIN_M15_PASSAGE_QRELS_REVIEW_PACK.md](BRVIN_M15_PASSAGE_QRELS_REVIEW_PACK.md) and [brvin-m15-passage-qrels-review-pack.json](../test/fixtures/brvin-m15-passage-qrels-review-pack.json). The fixture has no prefilled grades: two reviewers must label independent copies before adjudication. AI-generated grades are not human qrels.

After that gate, the remaining M15 security/revocation, recovery, HNSW/load, repeatable latency/cost and rollback requirements still apply. The five-query original-PDF-assisted formula audit is a bounded staging pass and does not repair raw OCR or indexed formula text. Production remains on Cloudflare AI Search; M16 and M17 remain gated by their own issue acceptance.



## 12 November 2026 — M15 and coordinated repository checkpoint

Core PR #228 merged the 109-passage independent review pack, Core `AGENTS.md` and current-state documentation. Teachers PR #46 merged the synchronized README/repository guide/provider compatibility state. Core PR #229 merged unit tests for revoked app-project grants and fresh per-request Qdrant source allowlists; these are test-level guardrails only. PR #230 corrected the release-scope test allowlist, and PR #231 corrected M14 staging test-only push triggers. None of these changes integrates Qdrant into the deployed private v2 retrieval path or changes Teachers runtime.

The first incomplete M15 task remains independent human passage relevance and claim-to-passage grounding. Two reviewers must independently annotate separate copies of the source-fingerprinted review pack, retain rationales and disagreements, and adjudicate without replacing human labels with model output. M15's live security/revocation, recovery, controlled performance/cost/load and rollback gates remain open. M16 and M17 remain gated by their own issues and acceptance.


## 12 November 2026 — owner-waived M15 passage assessment

The owner approved AI-assisted passage relevance assessment instead of two independent human reviewers for the current isolated staging decision. All 109 candidates from the 17-query paired receipt are graded in [the machine-readable assessment](../test/fixtures/brvin-m15-owner-waived-ai-passage-assessment.json), summarized in [the assessment report](BRVIN_M15_OWNER_WAIVED_AI_PASSAGE_ASSESSMENT.md). Original human-review fields remain blank; this is not represented as human qrels.

Both providers returned grade-2+ evidence at rank 1 for all 12 positive queries. AI Search has better returned-candidate precision (86.4% vs 36.7%); Qdrant returns 5 candidates per query and more lower-ranked noise. Qdrant returned 20 out-of-corpus candidates across N01–N04, none grade 2+; AI Search returned zero. H01 sign-correction evidence ranked first for both. The small sequential timing advantage for Qdrant remains a staging observation only. M15 continues with live authorization/revocation, independent-model claim grounding under owner waiver, multi-document formula fidelity, recovery, cost/load and rollback. Production remains on AI Search.


## 13 November 2026 — M15 authorization passed; two-source Core v2 gate in progress

The isolated Core v2 authorization/revocation receipt `e305a581-3d3c-469c-b2b5-093598783df4` passed all eight checks. It returned three authorized passages from physical pages 4, 5 and 8; denied wrong-project and revoked-grant requests before quota; confirmed that 14 Qdrant points remained while the grant was revoked; reserved exactly one authorized query unit; and restored the staging grant.

Core PRs [#237](https://github.com/ashini-x/parmar-ai/pull/237) and [#238](https://github.com/ashini-x/parmar-ai/pull/238) are merged. PR #238 fixes the numeric page metadata type used during second-source AI Search indexing. The post-merge M15 staging workflow [#43311490119](https://github.com/ashini-x/parmar-ai/actions/runs/43311490119) deployed Worker `8d732f8b-b14c-4e47-aeae-ce39d8db9f9f` at 100%; Core Release validation [#43311489792](https://github.com/ashini-x/parmar-ai/actions/runs/43311489792) passed and skipped production deployment/verification. The protected two-source prepare/evaluate actions are deployed but have not yet been run. They reuse the immutable M14 source and compare five cases through the real Core v2 resolver. This is a source-discovery/provenance subgate, not human passage qrels, answer evaluation, load testing or production acceptance. See [the multi-source runbook](BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md).


## 13 November 2026 — M15 component-rank diagnostic and score-floor follow-up

The protected read-only diagnostic ran against the pinned two-source M15 staging project. It performed five Vertex query embeddings and ten Qdrant component searches; quota remained 11→11 with zero reservations. No Qdrant points, AI Search items, source/OCR state or production D1/provider settings changed.

Both dense and sparse components returned all expected MS01–MS04 source/page targets within the top 15. The MS03 M15 page-2 passage appeared at rank 4 in both components. Its semantic RRF contribution is mathematically 0.2, but IEEE-754 produces 0.19999999999999998 and the strict Core 0.2 score-floor comparison suppresses it. Core PR [#247](https://github.com/ashini-x/parmar-ai/pull/247) adds a tiny floating-point comparison tolerance and tests that materially sub-threshold scores still fail.

MN01 continues to produce unrelated candidates in both components. No confidence cutoff, RRF weight adjustment or reranker is selected from this five-query diagnostic. The PR #247 Release validation/staging workflow passed and the fix is deployed behind AI Search; the paired MS03 Core v2 retrieval still needs a new protected staging receipt from staging operator v101. M15 remains open for calibrated no-match behavior, broader formula/mixed-content and claim grounding, recovery/throttling, representative HNSW-aware load, repeatable latency/cost and rollback. Production continues to select AI Search; M16/M17 remain gated separately.


## 13 November 2026 — M15 score-floor fix merged; production remains AI Search

Core PR [#247](https://github.com/ashini-x/parmar-ai/pull/247) merged as `cab5df42ef1ae16c6c21a52f6e77f3d9a3a74811`. The new score-floor tolerance and regression tests are now in main. Post-merge Core Release validation [#43337071402](https://github.com/ashini-x/parmar-ai/actions/runs/43337071402) passed TypeScript, the full Vitest suite, Node tests and both production Worker bundle builds; its production deployment and smoke-test job completed successfully. The isolated M14/M15 staging workflow [#43337071263](https://github.com/ashini-x/parmar-ai/actions/runs/43337071263) passed the focused M15 tests, Vertex/Qdrant configuration verification and Wrangler dry-run, then deployed only the isolated staging Worker.

**Latest Cloudflare read-back after the release:** `parmar-ai` is v742 (`e393117f-f52f-4c2a-b8d0-6082284c370c`, deployment `eb837798-4dc3-435d-a3c2-d510a90871c2`); private `brvin-service` is v140 (`fca42d59-305d-4452-9b64-f99a436ab1ec`, deployment `a5e4d0b6-da56-42bb-8069-69ed8daeab5c`); isolated `parmar-ai-m14-staging` is v101 (`20ecca22-fc6d-40c3-8da7-14c5940350f2`, deployment `47e4c51b-e12a-48d4-874f-f08d4e2179d6)); each is at 100%. `brvin-teachers` remains v12 (`68d6694c-6371-4cae-8a25-4af40ca15706`, deployment `31ff2a01-b0f4-4be8-92d3-63e2d91adddf`), also at 100%.

This production release deployed the Core code but **did not migrate the provider**. Cloudflare settings read-back confirms `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search` on both production Core Workers, `BRVIN_CORPUS_MANIFEST_ENABLED=false` on `parmar-ai`, and `BRVIN_MIN_SCORE=0.2` on `brvin-service`. The private retrieval Worker has only its D1 and AI Search namespace bindings for retrieval; no Qdrant URL/API key, embedding model or Vertex service credential is configured there. The Core Admin Worker's existing GCP credentials are retained for its existing Google integrations and are not Qdrant retrieval access. The dedicated Qdrant/Vertex bindings and secrets remain isolated to `parmar-ai-m14-staging`. Teachers remains unchanged with only `BRVIN_MANAGEMENT`, `BRVIN_SERVICE` and its own D1; it has no provider SDKs/credentials/direct provider route.

The merged code resolves only the MS03 exact-boundary floating-point defect. The protected paired Core v2 evaluation has **not yet been rerun after this fix**, so MS03 recovery must not be claimed until a new staging receipt confirms it. MN01's unrelated component candidates remain unresolved. M15 remains **IN PROGRESS** for the paired MS03 verification, calibrated no-match behavior, broader formula/mixed-content and claim grounding, recovery/throttling, HNSW-aware representative load, repeatable latency/throughput/cost and rollback. M16 UI/consumer parity and M17 canary/14-day soak remain future gates. Production continues on AI Search.

## 14 November 2026 — live M15 deployment and receipt reconciliation

Cloudflare read-back shows Core production `parmar-ai` v779 and `brvin-service` v156, isolated staging `parmar-ai-m14-staging` v102, and Teachers production v12, all at 100%. Both production Core selectors remain `cloudflare-ai-search`; no production Qdrant/Vertex retrieval binding or corpus-manifest writes are enabled. Teachers remains on the unchanged private v2 consumer boundary with no direct provider access.

Staging D1 contains only the original paired receipt `18728f63-e13d-4e73-880f-a2b980844d04` from 12 November 22:52:36 UTC. That pre-PR-247 run passed structural/provenance/quota checks but missed M15 page 2 for MS03 on Qdrant and returned three unrelated MN01 no-match candidates. Usage remains 11. No post-fix receipt exists. The score-floor fix is deployed and focused CI is green, but it is not yet live-verified through the paired Core v2 path.

The next Core-owned action is the protected five-case paired evaluation on the isolated M15 operator, with the existing staging token entered only in the local password field. No re-Prepare, PDF upload or Vision OCR rerun is needed. Keep M15 in progress; M16 and M17 remain gated.

## 14 November 2026 — post-PR-247 paired Core v2 evaluation passed

The protected five-case/two-provider evaluation passed under receipt `fa1b8076-9375-480b-bb4b-e22d1c13d9bb`. Qdrant now retrieves all seven distinct expected source/page locations and all eight query-specific positive target instances; MS03 includes the expected M15 pages 2 and 3. AI Search retrieves all seven distinct locations but misses the repeated M14 handout page 3 target in MS02 (7/8 query-specific instances). Both providers have zero provenance violations and all seven structural/authorization/quota checks pass. Staging D1 usage moved 11→21, exactly ten reservations.

Qdrant still returns three irrelevant candidates for MN01 (M14 page 1, M15 page 8 and page 6); AI Search returns none. Do not choose a generic RRF cutoff: the newly recovered positive MS03 page-2 candidate survives at approximately 0.2. The five sequential latency samples are not a production capacity/SLO result.

**Next M15 task:** calibrated no-match/relevance gating ablation. Compare no gate, a feature-based evidence-sufficiency gate and a calibrated reranker/relevance gate against the existing graded positives, four out-of-corpus negatives, exact-symbol near-miss and the two-source suite. Report positive recall, false abstention, negative false acceptance, formula/symbol slices, latency and cost. Keep owner-waived AI labels distinct from independent human qrels. Do not change the provider selector or consumer boundary.

## 14 November 2026 — initial relevance-gate feasibility check; no runtime policy selected

The first offline ablation is documented in [BRVIN_M15_RELEVANCE_GATE_ABLATION.md](BRVIN_M15_RELEVANCE_GATE_ABLATION.md) and reproduced in the Core owner-waived assessment fixture test. It compares no gate, fixed RRF score cutoffs and a simple lexical query-term coverage proxy. Under leave-one-query-out calibration, the score gate preserves 11/12 positive queries and clears 3/4 out-of-corpus queries; the lexical proxy preserves 11/12 and clears 4/4. P02 and P06 are false abstentions, respectively. Neither method is acceptable as a runtime policy, and the current owner-waived single-source labels are not independent human qrels. The next step is broader multi-document/query-family evidence and independently reviewed passage spans, followed by a multi-feature ablation on source/query-family held-out splits. No production or staging retrieval behavior changed.
