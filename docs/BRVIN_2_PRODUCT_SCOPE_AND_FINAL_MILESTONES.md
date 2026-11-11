# BRVIN 2 — Product Scope and Active Milestone Acceptance

**Status date:** 11 November 2026  
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
| M15 | AI Search vs Qdrant shadow benchmark including formula fidelity, mixed-query quality, provenance, security, recovery, latency, cost, load and rollback. | **IN PROGRESS — updated 12 November 2026.** The second eight-page Physics source is uploaded, OCR-complete and indexed in both isolated staging providers. The 17-query/34-generation OCR-only answer run and separate five-query/ten-generation original-PDF-assisted formula audit are complete. The original receipt calibrates to 16/17 for each provider; the PDF-assisted audit passes 5/5 for each provider on answer, source-grounding, citation and math-symbol checks, with zero provenance violations. This demonstrates bounded notation recovery with the source page attached, not repair of stored OCR/index text. Qdrant's formula-audit retrieval was faster (mean/median 913/895 ms vs 3,848/3,599 ms), but generation mean was higher due to a 50,041 ms P11 outlier. Remaining: independent passage qrels and claim grounding, broader multi-document formula validation, no-grant/wrong-project and revocation checks, retry/recovery, repeatable latency/cost, controlled load and rollback. Production remains on Cloudflare AI Search; no cutover. | [Core #144](https://github.com/ashini-x/parmar-ai/issues/144) |
| M16 | Coordinated Core Admin and Teachers UI/consumer compatibility; preserve current workflows and v2 response contract. | PLANNED  | [Core #145](https://github.com/ashini-x/parmar-ai/issues/145) · [Teachers #18](https://github.com/ashini-x/brvin-teachers/issues/18) |
| M17 | Controlled canary/production cutover, monitoring, rollback, 14-day soak and only then explicit legacy retirement review. | PLANNED  | [Core #146](https://github.com/ashini-x/parmar-ai/issues/146) |

**No production provider cutover has been performed.** Post-merge Cloudflare read-back confirms production `parmar-ai` Worker v710 (`059c2495-1347-4fa0-89d3-2749f55b582a`, deployment `ac0dedbc-b6d9-4686-bbe7-99fd3f739556`) and private `brvin-service` v134 (`6f00da7e-c663-4d24-a509-0b5be5cc5215`, deployment `bc672e9d-5335-4372-9be2-74ce0147d74f`) are both at 100%, with `ENVIRONMENT=production`, `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search` and `BRVIN_CORPUS_MANIFEST_ENABLED=false`. The isolated M14 staging Worker v78 (`842231fb-78ce-4791-a0b9-6b59e86eeb33`, deployment `817c9ad9-1722-4ffa-bc82-76d8878d01ca`) is at 100% with Vertex `gemini-embedding-001` in `asia-south1` (768 dimensions) and the dedicated Qdrant pilot collection/credentials. M14 workflow #76 and paired Core Release validation #1071 passed; the production run completed deployment, smoke checks and live release acceptance. Teachers remains on Worker v12 (`68d6694c-6371-4cae-8a25-4af40ca15706`) with only private Core service bindings; no consumer deployment or direct provider access has been added. M14's isolated staging pilot is complete at the scoped milestone boundary. M15 now owns independent human labels/expanded-corpus quality, current-provider shadow comparison, performance/cost, security/isolation, revocation, recovery and load gates. No production provider cutover has occurred; the v2 API, D1 authorization and existing admin experiences remain unchanged. The private v2 API, D1 authorization and existing admin experiences remain unchanged.

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

