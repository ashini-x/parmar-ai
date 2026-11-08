# BRVIN 2 — Current State and Continuation Plan

**Status date:** 8 November 2026  
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

The BRVIN Teachers management metadata migration is present in production. Its Production application/environment is registered and active, both private bindings use the generated environment identity, and BRVIN Admin accepted the one-time retrieval connection proof on 6 November 2026. The application D1 contains one real teacher and one active Physics project mapping. Core contains the matching project, one teacher-notes collection and one 3-page PDF source. Production D1 confirms the source is `ready`, with `page_count=3` and `indexed_pages=3`; the deployed Teachers page map shows all three pages indexed. The pilot's three page items were re-indexed under the 256-token / 10%-overlap setting (3, 4 and 4 chunks respectively). On 8 November 2026, the operator confirmed that the protected BRVIN Teachers v2 consumer returned two relevant Newton second-law passages from physical PDF page 2, with displayed relevance scores 0.993 and 0.960. The operator then revoked the Production application's access to Physics and observed **Not Authorised** on a subsequent consumer retrieval. After restoring the Physics access grant, the same consumer successfully answered again. Useful retrieval, physical-page provenance, grant-revocation denial and restoration have all been verified; M11 is complete.

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

## 7. New-chat continuation instruction

Start a new BRVIN chat with this instruction:

> Continue BRVIN 2 in `ashini-x/parmar-ai`. Read `docs/BRVIN_2_MASTER_PLAN.md` first, then `docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md`, `docs/BRVIN_SYSTEM_REFERENCE.md`, `docs/BRVIN_2_RPC_V2_CONTRACT.md`, `docs/BRVIN_2_ARCHITECTURE_DECISIONS.md` and the relevant runbook. These are the canonical current documents; do not resurrect deleted Project Factory or M3 test-client plans. M6–M10 are complete. BRVIN Teachers is registered as an active Production application/environment; both private bindings and the one-time retrieval proof are in place. The real Physics project/collection/source are READY at 3/3 indexed pages. Its shared AI Search items have been re-indexed under 256-token chunks with 10% overlap (page chunk counts 3/4/4), and direct engine smoke queries rank the expected physical pages first. The BRVIN Teachers v2 semantic retrieval, physical-page provenance, grant-revocation denial and post-regrant retrieval-restoration tests have all passed; M11 is complete. Core retrieval uses hybrid RRF, configurable cross-encoder reranking, bounded excerpts and page-key validation; BRVIN does not own the consumer's generation model. Inspect current GitHub and production state before acting; preserve existing product/data boundaries and update both repositories' canonical docs with each material change.

When a future change alters code, D1, bindings, access rules, ingestion, retrieval or production behavior, update the relevant current reference in the same PR. Keep this file concise and current; do not append a second historical milestone ledger.

BRVIN Teachers is a separately planned consumer repository (`ashini-x/brvin-teachers`), not a BRVIN subsystem. Its architecture lives in [BRVIN_TEACHERS_ARCHITECTURE.md](BRVIN_TEACHERS_ARCHITECTURE.md). Parmar AI remains standalone unless a future migration is separately approved and accepted.
