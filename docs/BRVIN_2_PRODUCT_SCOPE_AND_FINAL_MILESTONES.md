# BRVIN 2 — Product Scope and Active Milestone Acceptance

**Status date:** 6 November 2026  
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
| M11 | Operations, usage and administrator handover plus real consumer acceptance | **IN PROGRESS** | Operations, lifecycle rule verification and authenticated admin walkthrough are complete. The real teacher-focused app retrieval/revocation acceptance remains. |

## 5. M11 acceptance detail

### Completed and verified

- Operations summary displays monthly project searches, active-environment connection failures, failed activity events and OCR cleanup failures.
- Live pipelines reports active processing/deletion jobs and recoverable work.
- Specialist activity supports failure/warning, retention, connection, ingestion and governance filters.
- Protected read-only GCS diagnostic distinguishes object access, lifecycle-management permissions and the actual lifecycle rule.
- Five-minute retention supervisor checks/installs the exact 30-day OCR-only lifecycle rule while preserving unrelated rules and protecting source-PDF paths.
- Administrator confirmed **Lifecycle configuration permissions: READY** and **30-day OCR lifecycle rule: INSTALLED (age 30 days)**.
- OCR-only cleanup event history was reviewed. The latest visible completion stated that the original PDF and indexed search pages remain available. The event detail reported zero object versions found and zero deleted; do not claim a positive physical-deletion count.
- Authenticated Operations walkthrough completed on 6 November 2026. It reviewed Operational summary, Live pipelines, Failures and warnings, and Storage and OCR retention.
- Summary observed 33 project searches this month, zero active-environment connection failures, 404 failed events in the last seven days, zero OCR cleanup failures and no attention required. The dashboard code defines failed events as the count of seven-day activity rows with status `failed`; it is not an HTTP status or current recoverable-job count.
- Live pipelines reported no active processing or deletion jobs. The visible older failures repeated the 5 November `storage.buckets.get` permission denial. No retry or delete action was taken during the walkthrough.
- BRVIN Teachers' central Operator Console, teacher directory/profile D1 and classroom/collection/source UI are deployed in `ashini-x/brvin-teachers` (release [#42171352464](https://github.com/ashini-x/brvin-teachers/actions/runs/42171352464)).
- The separate `BrvinTeachersManagementApi` WorkerEntrypoint and additive ownership/reference metadata migration are deployed in `parmar-ai` (paired Core release [#42171109140](https://github.com/ashini-x/parmar-ai/actions/runs/42171109140)). The consumer's `BRVIN_MANAGEMENT` binding targets the named entrypoint. This management API is distinct from and does not change frozen retrieval v2.
- Production D1 confirms the metadata columns, source deduplication-scope column and reference-sequence table exist. The registry still contains no `brvin-teachers` application/environment row; the consumer config deliberately retains a placeholder and fails closed. The app D1 contains zero teacher records and zero Core-project mappings. No sample teacher/project/source/grant was created.

### Remaining acceptance — real teacher-focused consumer

This is the only remaining M11 gate:

1. Register the `brvin-teachers` application and its active production environment in BRVIN Admin, with Worker name `brvin-teachers` and its deployed Worker URL. Copy the generated environment UUID into the consumer's deployment-controlled `BRVIN_MANAGEMENT` binding config in place of `BRVIN_TEACHERS_ENVIRONMENT_ID_REQUIRED`, then deploy and verify management health.
2. Configure the separate private `BRVIN_SERVICE` binding to `brvin-service` / `BrvinRetrievalApi` with the same deployment-controlled environment UUID, and verify v2 connection identity.
3. Create the actual teacher and approved BRVIN project/collection/source via the Operator Console; use the real teacher's approved source material.
4. Demonstrate useful retrieval with source/page provenance and the correct project boundary.
5. Revoke the application-project grant in BRVIN Admin.
6. Demonstrate that retrieval is denied after revocation.

The user must provide/identify the real teacher's approved material and consumer use case as part of the acceptance workflow. The BRVIN Teachers consumer (`ashini-x/brvin-teachers`) and its Operator Console/classroom/source flows are deployed, and its Core management entrypoint is deployed. The consumer still needs its BRVIN application/environment registration and separate retrieval v2 binding before useful student retrieval can be tested. Repository creation, successful deployment or an operator-console health check is not acceptance. Do not fabricate a production teacher, project, source or grant. Preserve existing Parmar AI, Fatman and AskMoina state. M11 must remain IN PROGRESS until useful retrieval and denied-after-revocation results are recorded.

## 6. Deferred future work

A separately authenticated gateway for consumers outside the same Cloudflare account or outside Cloudflare may be considered later. It is deferred and not a requirement for M11 or the current release.

## 7. Delivery discipline

A milestone is complete only when the feature is implemented, automated checks pass, the production deployment/acceptance is verified where required, and the relevant current documents are updated. A documentation-only status update does not substitute for functional acceptance.

Use [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md) for continuation instructions, [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) for current implementation facts, and [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md) for administrator steps.
