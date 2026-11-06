# BRVIN 2 — Current State and Continuation Plan

**Status date:** 6 November 2026  
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
5. [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md) — current private v2 RPC contract for new consumers.
6. [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md) — how ChatGPT integrates a same-account consumer Worker.
7. [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md) — day-to-day beginner-friendly administrator procedures.
8. [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md) — deeper engineering/operator procedures, API routes, troubleshooting and deployment.
9. [BRVIN_PRIVATE_RETRIEVAL_API.md](BRVIN_PRIVATE_RETRIEVAL_API.md) — legacy v1 contract only; consult it when maintaining existing v1 compatibility, not for a new integration.

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

The latest paired production release relevant to BRVIN lifecycle operations is **Main Release Validation #778**, following PR [#101](https://github.com/ashini-x/parmar-ai/pull/101).

| Worker | Production version | Deployment |
|---|---|---|
| `brvin-service` | `72760779-3e3a-4a53-ad15-23b2a621a444` | `2d812a4f-569f-484b-983d-dfaedd8c016f` |
| `parmar-ai` | `a6febaa0-7b2e-4387-878b-d4a63d16fb8f` | `f1072878-ee8e-4bec-9872-965816358f03` |

The 6 November paired production release [#42171109140](https://github.com/ashini-x/parmar-ai/actions/runs/42171109140) passed typecheck, unit tests, Node tests, both Worker dry-runs, paired deployment and live root/health/private BRVIN/Fatman smoke and acceptance. It includes the deployed BRVIN Teachers management entrypoint. The frozen retrieval v2 methods and public/private route boundaries were not changed.

Additional verified production facts:
- D1: `parmar-ai-admin-prod` (the existing shared registry/analytics database).
- Shared OCR bucket: `parmar-fatman-ocr-90db7be4`.
- The administrator confirmed **Lifecycle configuration permissions: READY** and **30-day OCR lifecycle rule: INSTALLED (age 30 days)**.
- The Rain Gardens 3-page sample source remains `READY`, 3/3 indexed, with its original PDF and indexed search pages retained.
- The 6 November OCR cleanup completion event reported `objectVersionsFound=0` and `objectVersionsDeleted=0`. It confirms the dedicated OCR prefix was clear; it does not prove that this run physically deleted a positive number of objects.

The exact production inventory and trust boundaries are maintained in [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md).

The BRVIN Teachers management metadata migration is now present in the production D1 registry: project/collection/source ownership and reference columns, per-parent sequence storage and the source-import `dedupe_scope` column were verified read-only after release. The app-specific registration has not yet been created; no teacher/project/collection/source rows were seeded.

## 5. Milestone status

M6–M10 are complete. M11 is **in progress**, with the Operations, retention-safety and administrator-walkthrough portions accepted. BRVIN Teachers now has a deployed Operator Console and classroom/collection/source UI, and its private management entrypoint is deployed in `parmar-ai`. The app's Service Binding points to `parmar-ai`/`BrvinTeachersManagementApi`, but the production `brvin-teachers` application/environment is not yet registered in BRVIN Admin; the consumer binding intentionally remains fail-closed until the generated environment UUID replaces its placeholder. The remaining M11 acceptance is still a genuine teacher-focused consumer retrieval/revocation test:

1. Register a distinct independent application and its production environment in BRVIN.
2. Connect the consumer Worker through the generated ChatGPT handoff and same-account private Service Binding.
3. Use a real teacher's approved knowledge project and source material.
4. Verify that the deployed application retrieves useful, correctly scoped evidence.
5. Revoke the application's project grant in BRVIN.
6. Verify that subsequent retrieval is denied.

Do not create a synthetic production teacher, project, app or grant as a substitute. Do not mark M11 complete until retrieval and post-revocation denial have both been demonstrated with the real consumer.

The Operations walkthrough on 6 November 2026 recorded 33 project searches this month, zero active-environment connection failures, 404 failed activity events in the last seven days, zero OCR cleanup failures and no attention required. Source inspection confirmed that 404 is a seven-day count of activity events whose status is `failed`; it is not an HTTP 404 code or the number of currently recoverable jobs. Live pipelines showed no active processing/deletion jobs. The visible older failures repeated the pre-remediation `storage.buckets.get` permission denial. The latest OCR-only retention request/completion preserved the original PDF and indexed pages.

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
- The **BRVIN Teachers** multi-channel, multi-tenant application platform is a separate downstream consumer workstream, documented in [BRVIN_TEACHERS_ARCHITECTURE.md](BRVIN_TEACHERS_ARCHITECTURE.md) and implemented in `ashini-x/brvin-teachers`. Its Operator Console, tenant D1, classroom/collection/source UI and private management binding are deployed. The management entrypoint is in `parmar-ai`; it reuses Core-owned storage/OCR/indexing and is separate from the frozen retrieval v2 Worker contract. The app is not yet registered as an active BRVIN application/environment, its binding still uses the deliberate placeholder, and there are no production teacher/project/source records. It has not yet completed real student retrieval or post-revocation denial, so it does not close M11. Do not refactor or transfer the existing Parmar AI product into the consumer repository.

## 7. New-chat continuation instruction

Start a new BRVIN chat with this instruction:

> Continue BRVIN 2 in `ashini-x/parmar-ai`. Read `docs/BRVIN_2_MASTER_PLAN.md` first, then `docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md`, `docs/BRVIN_SYSTEM_REFERENCE.md`, `docs/BRVIN_2_RPC_V2_CONTRACT.md`, `docs/BRVIN_2_ARCHITECTURE_DECISIONS.md` and the relevant runbook. These are the canonical current documents; do not resurrect deleted Project Factory or M3 test-client plans. M6–M10 are complete. The BRVIN Teachers management entrypoint is deployed and retrieval v2 remains frozen. Next, register `brvin-teachers` and its production Worker environment in BRVIN Admin, put the generated environment UUID into the consumer's deployment-controlled Service Binding config, then verify useful retrieval from a real teacher's approved knowledge and denial after grant revocation. M11 remains open until both retrieval and post-revocation denial pass. Inspect current GitHub and production state before acting; preserve existing product/data boundaries and update the canonical documents with every release.

When a future change alters code, D1, bindings, access rules, ingestion, retrieval or production behavior, update the relevant current reference in the same PR. Keep this file concise and current; do not append a second historical milestone ledger.

BRVIN Teachers is a separately planned consumer repository (`ashini-x/brvin-teachers`), not a BRVIN subsystem. Its architecture lives in [BRVIN_TEACHERS_ARCHITECTURE.md](BRVIN_TEACHERS_ARCHITECTURE.md). Parmar AI remains standalone unless a future migration is separately approved and accepted.
