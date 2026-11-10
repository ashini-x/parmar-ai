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
| M15 | AI Search vs Qdrant shadow benchmark including math/symbol fidelity, mixed-query quality, provenance, security, load, latency, cost and rollback. | **IN PROGRESS — 11 November 2026.** Initial read-only AI Search baseline recorded (8/11 expected page targets; page-label precision proxy 11/14; page-level MRR 0.6833). Core PR #209 is merged; authenticated read-only 12-case paired shadow runner is live on staging Worker v79 (version a3da7cc7-3556-4e12-a57f-51f2898edb5f, deployment 8fb4c6cc-0b0a-4d7a-8387-b8550f299807, 100%). The runner uses source-filtered AI Search search() and Qdrant query-only mode; no writes, OCR, selector or answer path changes. Next: run the 12-query operator receipt, judge passage relevance independently, broaden corpus, then security/revocation, latency/cost, retry/recovery and load gates. Production remains AI Search; scope guard prevented production deployment. | [Core #144](https://github.com/ashini-x/parmar-ai/issues/144) |
| M16 | Coordinated Core Admin and Teachers UI/consumer compatibility; preserve current workflows and v2 response contract. | PLANNED  | [Core #145](https://github.com/ashini-x/parmar-ai/issues/145) · [Teachers #18](https://github.com/ashini-x/brvin-teachers/issues/18) |
| M17 | Controlled canary/production cutover, monitoring, rollback, 14-day soak and only then explicit legacy retirement review. | PLANNED  | [Core #146](https://github.com/ashini-x/parmar-ai/issues/146) |

**No production provider cutover has been performed.** Post-merge Cloudflare read-back confirms production `parmar-ai` Worker v710 (`059c2495-1347-4fa0-89d3-2749f55b582a`, deployment `ac0dedbc-b6d9-4686-bbe7-99fd3f739556`) and private `brvin-service` v134 (`6f00da7e-c663-4d24-a509-0b5be5cc5215`, deployment `bc672e9d-5335-4372-9be2-74ce0147d74f`) are both at 100%, with `ENVIRONMENT=production`, `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search` and `BRVIN_CORPUS_MANIFEST_ENABLED=false`. The isolated M14 staging Worker v78 (`842231fb-78ce-4791-a0b9-6b59e86eeb33`, deployment `817c9ad9-1722-4ffa-bc82-76d8878d01ca`) is at 100% with Vertex `gemini-embedding-001` in `asia-south1` (768 dimensions) and the dedicated Qdrant pilot collection/credentials. M14 workflow #76 and paired Core Release validation #1071 passed; the production run completed deployment, smoke checks and live release acceptance. Teachers remains on Worker v12 (`68d6694c-6371-4cae-8a25-4af40ca15706`) with only private Core service bindings; no consumer deployment or direct provider access has been added. M14's isolated staging pilot is complete at the scoped milestone boundary. M15 now owns independent human labels/expanded-corpus quality, current-provider shadow comparison, performance/cost, security/isolation, revocation, recovery and load gates. No production provider cutover has occurred; the v2 API, D1 authorization and existing admin experiences remain unchanged. The private v2 API, D1 authorization and existing admin experiences remain unchanged.

## 11 November 2026 — M15 shadow runner implementation checkpoint

Core PR #209 is merged; staging Worker v79 is deployed at 100% with the direct AI Search instance binding and existing isolated Vertex/Qdrant settings. M14 staging workflow #86 and Release validation #1084 passed. The production-scope classifier returned `deploy=false`; the two production deployment/acceptance jobs were skipped. The M15 operator's 12-query receipt remains pending. See the migration plan for the exact route, query-only safeguards and remaining M15 gates.

## 11 November 2026 — M15 paired shadow receipt completed

The first authenticated 12-case read-only run completed with 12/12 queries successful for both providers, zero provenance violations and zero writes/side effects. Qdrant covered all 11 expected physical-page targets (MRR 0.8833), compared with AI Search's 8/11 (MRR 0.6833). Qdrant also returned candidates for both no-match cases (2/2; 10 candidates), while AI Search returned zero for both. The initial `pageLabelPrecisionAt5` field used a variable returned-candidate denominator; Core PR #211 corrects future receipts and adds fixed-cutoff P@5 plus explicit no-match false-positive rates. Recomputed fixed all-suite page-label P@5 is 18.3% AI Search and 33.3% Qdrant; positive-only P@5 is 22.0% and 40.0%, respectively. These remain page-label proxies, not human passage qrels. The corrected scorecard is deployed on staging Worker v80; production remains on AI Search. See the migration plan for full per-query interpretation and the next gates.



## 11 November 2026 — M15 second-source staging operator ready

Core PR #213 has added the isolated second-source upload/OCR/corpus/index/paired-query operator; PRs #214 and #215 fixed the production-scope allowlist and staging workflow progression/resume behavior. Staging Worker v82 is deployed at 100%. The new operator is `/admin/m15/benchmark`; the exact source fingerprint and step-by-step runbook are recorded in [BRVIN_M15_SECOND_SOURCE_BENCHMARK.md](BRVIN_M15_SECOND_SOURCE_BENCHMARK.md).

The eight-page synthetic source is not uploaded and its second paired receipt is pending. Continue M15 with independently judged passage relevance, reviewed negative/near-miss evidence, wrong-project/no-grant and revocation tests, retry/recovery, measured cost/latency and controlled load. Production provider cutover remains blocked. Current production continues to select `cloudflare-ai-search` with corpus manifests disabled; the first merge caused an unnecessary normal production redeploy because the allowlist was incomplete, but production release acceptance passed. The classifier is now corrected and later staging-only work has skipped production deployment.
