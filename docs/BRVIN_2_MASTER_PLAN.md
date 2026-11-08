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

The latest verified paired Core production deployment is **Release validation #897** on 7 November 2026, from source revision [`2274fd6`](https://github.com/ashini-x/parmar-ai/commit/2274fd694af88f1b88a34fa1e0e9bfc092c36c9d). Its live production acceptance artifact [#13595831479](https://github.com/ashini-x/parmar-ai/actions/runs/42426578685) recorded both Workers healthy at 100% traffic.

| Worker | Production version | Deployment |
|---|---|---|
| `brvin-service` | `ce17b0bf-cfe2-47c4-b4c3-c85dddda9460` | `560c5686-658f-4594-823d-b4080e6d61f5` |
| `parmar-ai` | `9c0f07cd-5b68-4a55-9883-50b407183cee` | `12b352b0-7040-4939-92c8-73a863c34f2c` |

Run [#42426578685](https://github.com/ashini-x/parmar-ai/actions/runs/42426578685) passed typecheck, Vitest, Node tests, both Worker dry-runs, paired production deployment, root/health/private BRVIN/Fatman smoke checks and the release acceptance manifest. The artifact records root, Worker health, BRVIN Service Binding and Fatman retrieval as passed, with one authorised source. The 8 November changes on `main` after this deployment are documentation-only and did not trigger another production deployment; the code revision above remains the latest verified production revision.

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

## 7. Planned retrieval-provider modernization (M12–M17)

The next planned backend workstream is documented in [BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md](BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md). It keeps both admin experiences and the existing teacher upload/indexing workflow intact while evaluating Vertex AI embeddings + Qdrant hybrid retrieval behind the existing Core v2 API. The retrieval design is unified and math-aware: theory, formulas, worked examples and numerical problems share one candidate-retrieval path, with raw OCR, optional formula/LaTeX representations and physical-page provenance preserved; it is not a collection of separate subject bots.

**Current state (8 November 2026): M13 PR [#147](https://github.com/ashini-x/parmar-ai/pull/147) was squash-merged to `main` as `4ab292ff57addef051b28e32477e2136d91add8d`.** Its final-head CI passed TypeScript, 45 Vitest files / 259 tests, 8 Node files / 54 tests and both Worker dry-runs. The merge triggered the normal paired `main` release. Cloudflare deployment metadata now shows 100% traffic on `parmar-ai` version `44edc5d7-ba06-4623-80fa-47dbef8f998f` and private `brvin-service` version `ab1b92da-71b9-4fef-be09-94f313389a85`. The deployment is not a provider cutover: production remains pinned to `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search` and `BRVIN_CORPUS_MANIFEST_ENABLED=false`.

**M14 foundation PR [#148](https://github.com/ashini-x/parmar-ai/pull/148) is merged** as `8d665b48f08cc7197ca306cb0b00417d2321fc72`; its final CI passed TypeScript, 277 Vitest tests, 54 Node tests and both Worker dry-runs. It adds the hash/provenance-verifying GCS corpus reader and OCR-free replay runner, a Vertex `gemini-embedding-001` REST adapter, an isolated Qdrant dense + case/symbol-sensitive sparse adapter with documented RRF, and a fixed Physics evaluation suite. A staging-only stored-Vision backfill is now in progress on `brvin/m14-physics-vision-backfill`. It verifies the completed original Vision operation and exact page output set, then writes manifests to a separate M14 GCS bucket; it cannot execute outside `ENVIRONMENT=staging` with `BRVIN_M14_PILOT_ENABLED=true`. No M14 Qdrant collection or live Vertex embedding verification has been provisioned, so M14 is not accepted.

The existing Physics source is confirmed in D1 as `Force and Laws of Motion - Class IX pilot handout`, source `01238b3a-9902-4a42-90b4-574048ee4f00`, project `448249b4-fed9-45f5-9137-6014f242ddbe`, 3 pages, READY at 3/3, source SHA-256 `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`, and saved Vision operation `projects/project-90db7be4-619f-4ed7-89b/operations/342f72f46451ffd2`. This is the pilot input: do not upload the PDF again or start another Vision OCR operation. The M13 manifest writer was default-off in production, so no derived manifests for this source are assumed to exist; M14 must backfill the already-saved Vision output into a separate, non-production derived-corpus bucket before embedding. The PDF must not be re-uploaded or OCR rerun. Only the Newton-law page-2, 4 kg worked-example page-3, and bus-braking page-3/page-1 references have prior retrieval evidence; exact formula/symbol, friction and remaining evaluation labels stay pending OCR-ground-truth inspection.

D1 remains the authoritative project/source grant, readiness and quota boundary; GCS remains the private source and derived-artifact store; Vision OCR and Workflows remain unchanged. Production AI Search must remain the only user-facing retrieval provider until the later canary and rollback gates are explicitly accepted.

The same five-stage upload flow, page-index map, retry/recovery semantics and READY gating are compatibility requirements in Core Admin and BRVIN Teachers. Only limited provider-specific wording/advanced diagnostics may change; do not redesign either admin UI.

## 8. New-chat continuation instruction

Start a new BRVIN chat with this instruction:

> Continue BRVIN 2 in `ashini-x/parmar-ai`. Read `docs/BRVIN_2_MASTER_PLAN.md` first, then `docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md`, `docs/BRVIN_SYSTEM_REFERENCE.md`, `docs/BRVIN_2_RPC_V2_CONTRACT.md`, `docs/BRVIN_2_ARCHITECTURE_DECISIONS.md` and the relevant runbook. These are the canonical current documents; also read `docs/BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md` before retrieval/indexing work. M12 documentation is complete; M13 PR #147 is merged to `main` (merge SHA `4ab292ff57addef051b28e32477e2136d91add8d`) and production still uses Cloudflare AI Search with corpus writes disabled. M14 is in progress on `brvin/m14-vertex-qdrant-physics-pilot`: verified corpus replay reader, Vertex embedding adapter, Qdrant dense+sparse RRF adapter and Physics query suite are under test. No Qdrant resource or live Vertex pilot has been provisioned. Do not claim M14 complete until the existing stored Vision output is replayed, the live provider is verified, and the complete mixed-content/source-page/security acceptance passes. Preserve the single unified math-aware retrieval path—not separate theory/numerical bots—with raw OCR and formula/source uncertainty preserved. Do not resurrect deleted Project Factory or M3 test-client plans. M6–M10 are complete. BRVIN Teachers is registered as an active Production application/environment; both private bindings and the one-time retrieval proof are in place. The real Physics project/collection/source are READY at 3/3 indexed pages. Its shared AI Search items have been re-indexed under 256-token chunks with 10% overlap (page chunk counts 3/4/4), and direct engine smoke queries rank the expected physical pages first. The BRVIN Teachers v2 semantic retrieval, physical-page provenance, grant-revocation denial and post-regrant retrieval-restoration tests have all passed; M11 is complete. Core retrieval uses hybrid RRF, configurable cross-encoder reranking, bounded excerpts and page-key validation; BRVIN does not own the consumer's generation model. Inspect current GitHub and production state before acting; preserve existing product/data boundaries and update both repositories' canonical docs with each material change.

When a future change alters code, D1, bindings, access rules, ingestion, retrieval or production behavior, update the relevant current reference in the same PR. Keep this file concise and current; do not append a second historical milestone ledger.

BRVIN Teachers is a separately planned consumer repository (`ashini-x/brvin-teachers`), not a BRVIN subsystem. Its architecture lives in [BRVIN_TEACHERS_ARCHITECTURE.md](BRVIN_TEACHERS_ARCHITECTURE.md). Parmar AI remains standalone unless a future migration is separately approved and accepted.
