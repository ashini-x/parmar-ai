# BRVIN 2 — Product Scope and Active Milestone Acceptance

**Status date:** 9 November 2026  
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
| M14 | Non-production Vertex AI + Qdrant unified math-aware hybrid Physics pilot; live index and known-evidence retrieval evaluation on the verified corpus. | **IN PROGRESS** — positive suite baseline: 10/10 queries cover 11/11 expected pages; page-label precision@5 0.40 and first-expected-page MRR 0.7833 are page proxies, not human chunk qrels. Version-72 component ranks explained the friction tie (direct page-3 example dense 1 / sparse 5; broad page-1 intro 5 / 1; page-2 context 2 / 2). This change set replaces equal-weight Qdrant fusion in the M14 staging query path with Core-side intent-weighted RRF (semantic 70/30 dense/sparse; symbolic 30/70; k=2) and stable ordering. The seven-candidate regression fixture reproduces the observed friction ranks and scores. Live updated staging receipts, formula/paraphrase quality, human chunk qrels, added two-call latency/cost, security/isolation, deterministic retry and HNSW-aware performance/load remain open. Teachers has no deployed Gemini answer route, so answer-abstention testing remains blocked pending a real consumer generation path or separately approved harness. | [Core #143](https://github.com/ashini-x/parmar-ai/issues/143) |
| M15 | AI Search vs Qdrant shadow benchmark including math/symbol fidelity, mixed-query quality, provenance, security, load, latency, cost and rollback. | PLANNED  | [Core #144](https://github.com/ashini-x/parmar-ai/issues/144) |
| M16 | Coordinated Core Admin and Teachers UI/consumer compatibility; preserve current workflows and v2 response contract. | PLANNED  | [Core #145](https://github.com/ashini-x/parmar-ai/issues/145) · [Teachers #18](https://github.com/ashini-x/brvin-teachers/issues/18) |
| M17 | Controlled canary/production cutover, monitoring, rollback, 14-day soak and only then explicit legacy retirement review. | PLANNED  | [Core #146](https://github.com/ashini-x/parmar-ai/issues/146) |

**No production provider cutover has been performed.** Core production remains pinned to `cloudflare-ai-search` and `BRVIN_CORPUS_MANIFEST_ENABLED=false`. Paired Core Release validation #1040 [passed](https://github.com/ashini-x/parmar-ai/actions/runs/42811222451) after PR #191; production `parmar-ai` version `29a993ad-c175-40fe-89d0-58cda2241429` (version 698) and `brvin-service` version `6ab2530e-c45f-4684-b0b2-1e20246adc32` (version 128) are both at 100% and still select AI Search. The last verified M14 staging deployment is version 72 `ec3614bf-0077-4c93-82e5-f685ea38456f` at 100%, with Vertex `gemini-embedding-001` (`asia-south1`, 768 dimensions), collection `brvin_m14_physics_pilot_v1`, HTTPS Qdrant endpoint, and the Qdrant API key/admin/GCP credentials as secrets. The new Core-side intent-weighted RRF implementation is in the current staging change set and has not yet been validated or deployed at this documentation checkpoint. Its unit fixture replays all seven observed component candidates: semantic natural-language queries weight dense/sparse 70/30, symbolic/formula queries 30/70; this is an initial staging ranking policy, not a confidence estimate. The immutable Physics corpus remains verified at 3 pages/7 chunks (2/2/3). The original ten-positive receipts cover all 11/11 expected pages; latest page-label precision@5 is 0.40 and first-expected-page MRR 0.7833333. Human chunk qrels, formula fidelity, live updated positive/negative receipts, extra query latency/cost, security/isolation, deterministic retry and HNSW-aware performance/load remain open. Teachers still has no deployed Gemini answer route, so answer/abstention acceptance requires a real consumer generation path or separately approved harness. M15 shadow benchmark, M16 consumer acceptance and M17 cutover remain pending. The v2 API, D1 authorization and existing admin experiences remain unchanged.