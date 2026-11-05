# BRVIN 2 — Multi-application Knowledge Platform and Admin Connection Manager

**Document type:** Canonical BRVIN 2 architecture, implementation plan and chat-continuity tracker  
**Project:** BRVIN — Teacher Digital-Brain Knowledge Platform  
**Owning repository:** `ashini-x/parmar-ai`  
**Product scope:** [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md)  
**As-built reference:** [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md)  
**Planning baseline:** `main`  
**Status at 5 November 2026:** M0–M3 are complete; M4's reference scaffold was retired and is not a product requirement; M5's core application/project administration is deployed. The first remaining product milestone is M6 — Admin workspace aligned to teacher knowledge operations. The full final plan is M6–M11 in the product-scope document.

> **Scope correction:** The user's confirmed goal is a multi-application, teacher-specific knowledge platform. ChatGPT remains the user's software engineer through its separately authorized GitHub and Cloudflare connections. The previously proposed autonomous BRVIN coding brain, repository factory, broad provider-admin credential vault and BRVIN-owned CI/CD are superseded and are not active BRVIN 2 requirements. See [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md).

> **New-chat rule:** Read this file first, then the product-scope/final-milestones document, system reference, architecture decisions and RPC v2 contract. Inspect the latest GitHub/production evidence and resume at the first incomplete milestone. Do not ask the user to repeat the product goal.

---

## 1. Project vision

BRVIN is a shared, application-aware knowledge platform for creating, managing and securely serving teacher-specific digital brains.

A teacher's digital brain may contain PDFs, shortcuts, formulas, personal teaching methods, notes and other approved learning material. BRVIN centralizes upload, storage, OCR, indexing, collections, readiness, project permissions, retrieval, quotas and audit. Independent applications—such as Telegram bots, websites, APIs or assistants—connect once to BRVIN and retrieve only the knowledge projects explicitly granted to them.

The administrator's primary jobs are:
1. Create and maintain a knowledge project for each teacher or use case.
2. Upload and organize the teacher's material.
3. Register an application and its repository/runtime reference.
4. complete its one-time server-side BRVIN integration using ChatGPT and the user's connected engineering tools;
5. Verify the deployed application-to-BRVIN connection.
6. Assign or revoke knowledge-project access in the admin panel.

**ChatGPT remains the developer.** It plans, writes, tests, commits, merges and deploys the independent application through the user's own connected GitHub and Cloudflare tools. BRVIN does not need a separate LLM brain or autonomous software Project Factory.

The central BRVIN ingestion and retrieval system must be reused. A new teacher knowledge project is a data/permission workspace, not a new GitHub repository, Worker, D1 database, AI Search instance or OCR pipeline. A new application is independently built and maintained outside BRVIN, then registered and connected to the shared knowledge platform.

AskMoina Voice, Parmar/Fatman and future Telegram/web applications are separate consumers. Do not force unrelated applications into one repository or make AskMoina Voice a required BRVIN test harness.

## 2. Approved target architecture

### 2.1 Core relationship

The current project-bound client model must evolve into an application-bound identity with explicit project permissions.

~~~text
                 BRVIN ADMIN WORKSPACE
                          |
              +-----------+-----------+
              |                       |
        APPLICATIONS               PROJECTS
              |                       |
     AskMoina / Parmar / etc.     Project A / Project B / ...
              |                       |
     Trusted environment        Books + collections
       identities               + source grants
              |                       |
              +------ explicit ------+
                    app-project
                    authorisation
                          |
                          v
                PRIVATE BRVIN SERVICE
                          |
               resolve trusted caller
               verify app is active
               verify requested project
               verify app-project grant
               resolve ready source grants
               filter shared AI Search
               validate all returned keys
               enforce quotas and audit
                          |
                          v
                passages + provenance
                          |
                          v
             CONSUMER APP MODEL / UX
          Gemini Live, LLM, chat, voice, etc.
~~~

### 2.2 Entity definitions

- **Application:** a software product connected to BRVIN, for example AskMoina Voice or Parmar/Fatman.
- **Application environment/client identity:** a trusted runtime identity for a deployed app environment, such as AskMoina production or preview. It is supplied by trusted deployment configuration (currently Cloudflare Service Binding `props`).
- **Project:** an independent knowledge workspace with its own sources, collections, status, usage controls and grants.
- **Application-project authorisation:** explicit D1 relationship that says an application is allowed to retrieve a particular project.
- **Book/source:** a registered PDF or protected built-in knowledge source, indexed into the shared search resource.
- **Collection:** a reusable group of books. Granting a collection is a permission decision and may expose future ready books subsequently added to it.

### 2.3 Non-negotiable design principles

1. One application can be authorised for multiple independent BRVIN projects.
2. A project can be authorised for one or more applications where explicitly approved.
3. One application can have multiple trusted runtime identities/environments (production, preview, staging, as required).
4. Creating another project does not require a new application identity, Service Binding, Wrangler change, GitHub PR or application deployment.
5. Project UUID, slug and associated records are generated automatically.
6. All books, OCR, page index and access grants remain centralised in BRVIN.
7. Keep the existing shared D1 database and Cloudflare AI Search instance/namespace. No per-project D1 or AI Search duplication.
8. Keep `brvin-service` private. Same-account Workers use Service Binding RPC.
9. The caller's application identity comes only from trusted deployment configuration, never from browser/user-supplied identity fields.
10. A project ID supplied in a retrieval call is a selector, not proof of permission. The service must verify the application-project mapping on every request.
11. A project can never access another project merely by guessing its UUID or slug.
12. Resolve ready, fully indexed sources through explicit direct-book and collection grants.
13. Apply authorised folder-prefix filters before search and validate result keys after search.
14. Fail closed. No unfiltered/global search fallback for unknown identity, unauthorised project, missing grants or service errors.
15. The consumer app retains its own model, prompt, user auth, conversation/memory store, final answer generation and delivery.
16. BRVIN provides evidence: bounded passages, book/title/source IDs, PDF pages, optional printed page/section, score and optional exact-page image evidence.
17. Preserve Fatman's current project, ingestion, data, citations and monthly usage counter through a safe migration.
18. Use a reusable connector/adapter so a supported app integrates once.
19. First prove the architecture with AskMoina Voice.
20. Automate first-time integration through a reviewed GitHub change and normal deployment path. Do not silently commit to production or deploy unreviewed code.
21. Make the recurring project/knowledge workflow non-technical and dashboard-driven.
22. Implement cross-account public gateway only later. Do not make the internal retrieval Worker public to bypass same-account restrictions.

## 3. Current implementation baseline (as inspected 4 November 2026)

### 3.1 Existing foundation that must be preserved

Repository: `ashini-x/parmar-ai`.

- BRVIN admin and governance code: `src/brvin/admin.ts`.
- Private retrieval: `src/brvin/retrieval.ts`, `src/brvin/service-core.ts`, `src/brvin/service-worker.ts`.
- Shared D1/schema migrations: `src/analytics/db.ts`.
- Typed environment/service interfaces: `src/config/env.ts`.
- PDF upload/GCS/Vision helpers: `src/fatman/import.ts`.
- Background ingestion/index/recovery/retention/deletion: `src/fatman/workflow.ts`.
- Main Worker/admin routing/health/schedules: `src/index.ts`.
- Main Worker config: `wrangler.jsonc`.
- Private retrieval Worker config: `wrangler.brvin.jsonc`.
- Release and paired rollback: `.github/workflows/release-validation.yml`.
- Smoke test: `scripts/production-smoke-test.mjs`.
- Tests: `test/brvin-service.test.ts`, `test/brvin.test.ts`, `test/brvin-admin-script.node.test.ts`.

### 3.2 Existing production architecture

- `parmar-ai` owns protected BRVIN admin, book registration/upload gateway and current ingestion orchestration.
- `brvin-service` is a separate private Cloudflare Worker exposing `BrvinRetrievalApi` through a Service Binding RPC entrypoint.
- Both use the existing D1 database `parmar-ai-admin-prod`.
- Retrieval Worker uses `BRVIN_SEARCH` and existing Cloudflare AI Search resource `fatman-2026-8b183803`, namespace `default`.
- The private retrieval Worker has `workers_dev: false`, no public route, and a default HTTP 404 handler.
- `parmar-ai` currently binds `BRVIN_SERVICE` with `props.clientId: "fatman"`.
- The private service does not need Google Vision, GCS, Gemini/Vertex or Telegram secrets.
- GitHub Actions validates and dry-runs both Worker configs, deploys `brvin-service` first, then `parmar-ai`, verifies production health and records paired version IDs with rollback support.

### 3.3 Existing project provisioning

The current BRVIN admin already creates a project UUID, slug, and default row in `brvin_service_clients` in one D1 batch. For example, a project called AskMoina currently receives a slug/client ID such as `askmoina`.

This is useful foundation but it binds a client directly to one project. BRVIN 2 must introduce application identity and explicit app-project authorisation so one application can use many projects without a new Service Binding for each project.

The generated client ID is not a password or API key. Its trust currently comes from Worker deployment-controlled `props`.

### 3.4 Current D1 structures to inspect before migration

Existing BRVIN-related tables include:

- `brvin_projects`
- `brvin_collections`
- `brvin_books`
- `brvin_project_books`
- `brvin_project_collections`
- `brvin_service_clients`
- `brvin_project_search_usage`
- `brvin_activity_events`
- `brvin_migrations`

Fatman's existing quota table `fatman_search_usage` must be retained and not reset.

The new schema should be finalised during Milestone 0. Candidate new entities include an application registry, application environment/client identity registry and explicit application-project grant table. Exact names, constraints, indexes and migration semantics must be documented in the ADR before implementation.

### 3.5 Existing ingestion foundation

The current PDF workflow already supports:
- upload fingerprint/metadata validation;
- private resumable Google Cloud Storage upload;
- Google Vision Document Text Detection;
- Cloudflare Workflows for background and chunked processing;
- page-level AI Search indexing;
- progress/status and activity events;
- retry/repair/recovery;
- retrieval probes/QA;
- archive, imported-PDF deletion and OCR-output-only retention cleanup.

Do not rebuild it. Some generic ingestion code still has Fatman names and lives under `src/fatman/`; renaming/moving it is not a prerequisite for BRVIN 2 unless a milestone proves it is needed and safe.

### 3.6 AskMoina current baseline

Separate repository: `ashini-x/askmoina-voice`.

The 4 November 2026 audit found:
- no BRVIN source or service binding in its repository;
- no deployed `BRVIN_SERVICE` binding;
- independent D1 databases and Gemini Live infrastructure;
- an existing server-side Gemini Live function/tool handler suitable for a BRVIN search tool.

Integration must preserve AskMoina's own user/session/auth/conversation state and let Gemini Live generate the answer. Do not bind BRVIN D1 or AI Search directly into AskMoina.

### 3.7 Current deployed consumer baseline

At the 4 November 2026 audit, the registered BRVIN consumer project was Fatman. A separate small BRVIN test PDF existed in D1 but was not assigned to Fatman. Do not confuse a registered source with an authorised project source.

Latest inspected Release Validation run before this BRVIN 2 planning work was successful, including both Worker deploys and Fatman BRVIN connectivity/source-readiness checks. This older run is not evidence that BRVIN 2 has been implemented.

### 3.8 Current docs

The detailed existing references are:

- [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md)
- [BRVIN_PRIVATE_RETRIEVAL_API.md](BRVIN_PRIVATE_RETRIEVAL_API.md)
- [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md)
- [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md)
- [REPOSITORY_MAP.md](REPOSITORY_MAP.md)

Read them alongside this master plan. The master plan covers the future implementation and progress; the System Reference describes the audited as-built baseline.

## 4. Target administrator experience

The final admin experience is defined in [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md). It must extend the existing protected `/admin/brvin` workspace, not create a parallel admin product.

The dashboard is organized around two connected responsibilities:

- **Knowledge management:** teacher/owner labels, knowledge projects, sources, collections, processing readiness, usage, grants and revocations.
- **Application management:** applications, repository/runtime references, deployment environments, generated ChatGPT integration handoff, live connection verification and knowledge-project assignments.

The primary navigation should be Overview, Knowledge Projects, Sources & Collections, Applications, Connections, Operations & Usage, and Security & Audit.

A Connect Application wizard records application metadata, repository URL/default branch, runtime/Worker reference and environment identities. It does not create the GitHub repository or build the app. It generates a precise, non-secret integration brief for ChatGPT. ChatGPT performs the code and deployment work using the user's independently authorized provider connections. BRVIN verifies the deployed app's v2 private retrieval connection and manages knowledge grants.

A repository URL saved in BRVIN is a reference, not proof of GitHub access. ChatGPT's GitHub repository selection is controlled separately by the user and OpenAI's connector. Never claim BRVIN can authorize that connection.

Do not make the broad Provider Administrator / Autonomous Project Factory wizard a primary product feature. Audit existing code and credential dependencies before removing old provider-connection UI or credentials; this product-scope decision does not authorize destructive credential cleanup.



## 5. Final implementation milestones and completion gates

The active final milestone sequence is **M6–M11**. The authoritative detailed acceptance criteria live in [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md). Historical Project Factory milestones and progress entries remain in this file as historical records only; they must not be resumed.

| Milestone | Name | Status at 5 November 2026 | Completion outcome |
|---|---|---|---|
| 0 | Architecture freeze and migration blueprint | COMPLETE | Existing identity, trust, data and migration decisions accepted. |
| 1 | Multi-application, multi-project identity | COMPLETE | Application/environment/grant registry deployed; Fatman preserved. |
| 2 | Private retrieval RPC v2 | COMPLETE | Trusted environment identity and grant-checked private retrieval deployed. |
| 3 | Reusable server-side connector | COMPLETE | Typed v2 connector available to consumer applications. |
| 4 | Reference consumer scaffold | RETIRED / NOT A PRODUCT REQUIREMENT | Historical scaffold removed; never recreate the fixed test client. |
| 5 | Core application/project administration | COMPLETE — UX expansion remains | Protected application/environment/grant lifecycle and knowledge admin deployed. |
| 6 | Admin workspace aligned to teacher knowledge operations | NOT STARTED | Project-centric admin experience, teacher/owner metadata and useful application/project detail views. |
| 7 | Application connection registry and wizard | NOT STARTED | Guided registration of app, repository/runtime references and environments. |
| 8 | ChatGPT integration handoff | NOT STARTED | Repository-specific non-secret prompt/manifest for ChatGPT to perform the one-time code integration. |
| 9 | Live connection verification and activation | NOT STARTED | Deployed consumer proves trusted v2 identity and private Service Binding; readiness is shown separately. |
| 10 | Teacher knowledge assignment and isolation acceptance | NOT STARTED | Multi-teacher/multi-app grant, revoke, isolation and sharing tests. |
| 11 | Operations, usage and administrator handover | NOT STARTED | Usage, failures, audit, operating guide and a real teacher-focused app acceptance run. |

M12, an authenticated gateway for applications outside the BRVIN Cloudflare account or outside Workers, is deferred and not required for M0–M11.

**M6 — Admin workspace aligned to teacher knowledge operations.** Reshape the existing dashboard around Knowledge Projects and Applications. Add admin-managed owner/teacher labels where useful. Show each project's sources, collections, assigned apps, readiness, usage and activity. Do not build teacher logins, billing or a second knowledge pipeline.

**M7 — Application connection registry and wizard.** Register application profile, repository reference, runtime/Worker metadata and production/staging/preview environment records. Generate environment IDs through the existing backend. A saved repository reference is not proof that ChatGPT can access it. Do not create repositories or infrastructure automatically.

**M8 — ChatGPT integration handoff.** Generate a deterministic, copyable repository-specific prompt/manifest containing the v2 binding identity, private service/entrypoint, connector methods, tests and security restrictions. ChatGPT implements source/config changes, runs CI and deploys via the user's own connections. Never include secrets.

**M9 — Live connection verification and activation.** Define and implement a safe health/verification contract. A registered application must remain pending until its deployed Worker proves its trusted environment identity and private v2 Service Binding. Connection health and ready knowledge are separate states. Design the probe/callback authentication and replay controls before implementation.

**M10 — Teacher knowledge assignment and isolation acceptance.** Provide easy grant/revoke from both application and knowledge-project views. Test teacher A/B isolation, app-wide grant semantics, multiple grants per app, deliberate project sharing, collections, readiness, suspension and revocation. A multi-teacher app must enforce its own authenticated user-to-project mapping.

**M11 — Operations, usage and administrator handover.** Finish operational visibility, quota and activity reporting, pipeline/connection recovery, revocation and a nontechnical admin manual. Use a separate teacher-focused app (for example, an SSC Mathematics Telegram bot) as the real acceptance consumer, built/deployed by ChatGPT—not by a BRVIN Project Factory.

Milestones are complete only when shipped code and the relevant automated/live evidence are recorded. A documentation proposal, mock, unit test or registered D1 row alone is not acceptance evidence.



## 6. Copy-ready prompts and chat continuity

### Current continuation prompt

```text
Continue BRVIN 2 in ashini-x/parmar-ai.

Read these documents first:
1. docs/BRVIN_2_MASTER_PLAN.md
2. docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md
3. docs/BRVIN_SYSTEM_REFERENCE.md
4. docs/BRVIN_2_ARCHITECTURE_DECISIONS.md
5. docs/BRVIN_2_RPC_V2_CONTRACT.md

The user's confirmed product goal is a teacher-specific digital-brain knowledge platform with an admin panel to register independent applications, connect their runtime to BRVIN once, and assign/revoke teacher knowledge projects. ChatGPT remains the software engineer using the user's separately authorized GitHub and Cloudflare connections. BRVIN does not build apps, create repositories, manage application CI/CD, or run an autonomous coding agent.

Inspect current main, recent commits/PRs/checks and production state. Continue from the first incomplete milestone M6–M11 in the canonical final-milestones document. Do not resume the superseded autonomous Project Factory plan. Preserve the current private retrieval, D1, OCR/indexing and Fatman compatibility contracts. Implement one milestone at a time, validate it, and update both documentation files in the same PR with evidence.
```

### Continuation prompt for a new chat branch

Use this when the current conversation reaches its context limit. The user should paste the full prompt from [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md) together with the master-plan link. The blob links must point to `main` after the documentation PR is merged.

```text
Resume BRVIN 2 exactly where the previous ChatGPT branch stopped.

Repository: https://github.com/ashini-x/parmar-ai

Read the current main-branch documents in this order:
1. https://github.com/ashini-x/parmar-ai/blob/main/docs/BRVIN_2_MASTER_PLAN.md
2. https://github.com/ashini-x/parmar-ai/blob/main/docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md
3. https://github.com/ashini-x/parmar-ai/blob/main/docs/BRVIN_SYSTEM_REFERENCE.md
4. https://github.com/ashini-x/parmar-ai/blob/main/docs/BRVIN_2_ARCHITECTURE_DECISIONS.md
5. https://github.com/ashini-x/parmar-ai/blob/main/docs/BRVIN_2_RPC_V2_CONTRACT.md

Also read the latest progress-log entries and inspect the latest GitHub commits, branches, open/merged PRs, CI runs, deployment evidence and relevant Cloudflare state. The documentation is the source of truth; do not rely on prior chat memory or ask me to explain BRVIN again.

Confirmed product goal:
BRVIN is a shared knowledge platform for teacher-specific digital brains (PDFs, shortcuts, formulas, methods and notes). It manages knowledge projects, applications, trusted environments, private retrieval and explicit app-to-project grants. ChatGPT remains my engineer: I use my separately connected GitHub and Cloudflare integrations to build, test and deploy each independent app. BRVIN supplies the knowledge connection and admin controls; it is NOT an autonomous coding brain or software Project Factory.

Resume at the first incomplete M6–M11 acceptance item. Do not restart completed milestones. Do not implement the superseded Project Factory, autonomous coding agent, repository factory, BRVIN-owned CI/CD or provider-token vault. Preserve Fatman, the shared ingestion/search resources, private brvin-service, v2 trusted environment identity and all existing security contracts. Do not recreate brvin-test-client in askmoina-voice.

For every implementation change:
- inspect relevant source and production before editing;
- implement in a feature branch and create a focused PR;
- run relevant tests, type checks and deployment/preview checks;
- merge only after required checks pass and the diff is safe;
- record files, tests, CI run, PR, merge commit, deployment IDs/versions and live verification in docs/BRVIN_2_MASTER_PLAN.md and docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md in the same PR;
- update docs/BRVIN_SYSTEM_REFERENCE.md when shipped architecture/behavior changes;
- leave an explicit next action and remaining blockers in the progress ledger.

Start by stating the exact current milestone and evidence found. Do not repeat a completed audit unless new evidence requires it.
```



## 7. Progress ledger — update after every milestone

This table is the human-readable status. The evidence fields must be filled from actual GitHub/Cloudflare/test results, not assumptions.

| Milestone | Status | PR / commit | Verification evidence | Notes |
|---|---|---|---|---|
| 0 — Architecture freeze | COMPLETE | [PR #61](https://github.com/ashini-x/parmar-ai/pull/61) merged as `5735314b3e692019c34ba3d2a0d851cbb6c43aa3` | ADR and RPC v2 contract merged to main; Release Validation #586 passed for the combined code/docs PR | Original docs-only PR #60 closed as superseded |
| 1 — Identity model | COMPLETE | [PR #61](https://github.com/ashini-x/parmar-ai/pull/61), merge commit `5735314b3e692019c34ba3d2a0d851cbb6c43aa3` | Release Validation #586 passed; production migration marker and all three seed rows verified; foreign-key check empty; both Workers active on new versions | No v1 RPC or Fatman permissions/counter reset |
| 2 — Private RPC v2 | COMPLETE | [PR #62](https://github.com/ashini-x/parmar-ai/pull/62), merge commit `3b68aaecf3c78c712e1a1c978285ad1f166d15c4` | Release Validation #596 passed; production environment-bound methods deployed; v1 Fatman path/usage unchanged | Private Service Binding only; no public retrieval route |
| 3 — Reusable connector | COMPLETE | [PR #63](https://github.com/ashini-x/parmar-ai/pull/63), merge commit `91b6a499bd782ae298b41e790157c23682f10881` | Release Validation #608 passed; Cloudflare Preview build `a4c154e3-c056-489a-9b14-8ebac9ed9c0d` succeeded | Connector vendored by AskMoina PR #370 |
| 4 — Independent BRVIN text reference Worker | COMPLETE — scaffold/contract tests delivered | [AskMoina PR #381](https://github.com/ashini-x/askmoina-voice/pull/381), merge `bf8e5a1e9fe7f451ad31430143ab52aaf801214e` | Separate `brvin-test-client` Worker, own Wrangler and TypeScript configs, tester-token gate, text UI, server-side v2 connector, authorisation/provenance tests; Release Validation and independent Wrangler dry-run passed on main | No test identity, project grant, Service Binding or deployment. Historical scaffold only; superseded as the acceptance app by the factory-generated independent PDF-chat repository. |
| 5 — Application/project administration | COMPLETE — merged, deployed and production release accepted | [PR #72](https://github.com/ashini-x/parmar-ai/pull/72), merge `5872c2d21cdef17feb21d661e50ddde820c51f40` | Main Release Validation and paired production release [#41900067751](https://github.com/ashini-x/parmar-ai/actions/runs/41900067751) passed typecheck, unit/Node tests, both Worker bundle checks, production deployment and root/BRVIN/Fatman smoke; acceptance artifact `13357333270` | `brvin-service` version `c6755ca2-5b5f-4968-8bbc-e957a767926d`; `parmar-ai` version `d239c941-f119-4ad1-9020-63e9a2353434`. No migration or production data mutation. Cloudflare preview PR build alone hit the account's 100 Durable Object Free-plan namespace limit; main production build/deploy passed |
| 6 — Delegated provider administration and credential lifecycle | IN PROGRESS — permission preflight is deployed; owner approvals and credential automation remain | [PR #82](https://github.com/ashini-x/parmar-ai/pull/82) merged `5ade1aede0a215166fb827a08f1fdaf84e303c22`; [PR #83](https://github.com/ashini-x/parmar-ai/pull/83) merged `ceef8f17927b190a5bba71bce61732c7067e34a0` | PR #83 Release Validation #673 passed (run `42020393642`). Main production Release Validation #675 passed (run `42020525691`): `brvin-service` deployment `5d1b649d-5041-4957-9c2c-09ad52f18b5d` / version `82e902c9-be00-47da-81fa-c4d879e58fcc` at 100%; `parmar-ai` deployment `fdc896dd-d0cb-437d-8bbb-cf9491f49dea` / version `c6f4fd4f-00aa-42e0-af68-dc3af1b83144` at 100%; root, health, private Service Binding and Fatman retrieval passed. | First incomplete implementation milestone. The admin panel now preflights provider permissions and displays the one-time consent steps. Current Cloudflare OAuth still stores `workers-scripts.edit offline_access`; the user must re-consent to expanded scopes. The existing Cloudflare account member is already Super Administrator. The existing BRVIN GitHub App still needs the expanded permission approval and All-repositories installation scope. Token creation, Actions/Worker secret delivery, vault lifecycle, rotation/revocation and project-level credential provisioning remain to implement. |
| 7 — Autonomous Software Project Factory | NOT STARTED | — | — | Natural-language brief → new GitHub repository → code/tests → Cloudflare resources/credentials → verified deployment |
| 8 — First generated application: Chat with Your PDFs | NOT STARTED | — | — | Factory-generated independent app; grounded answers and physical PDF page citations |
| 9 — Generalisation and multi-project acceptance | NOT STARTED | — | — | Generate a second app type; multi-app/project grants, isolation, revocation, recovery and Fatman preservation |
| 10 — Security, release and handover | NOT STARTED | — | — | Final account/provider, credential, deployment, audit and nontechnical manual |
| 11 — Cross-account gateway (optional) | DEFERRED | — | — | Separate cross-account expansion; private same-account Service Binding remains default |

### Required milestone log entry format

For each milestone, append a dated record with:

- Milestone number and final status.
- Branch name and pull request URL.
- Merged commit SHA, if merged.
- Exact paths/components changed.
- D1 migrations applied (or explicitly not applied).
- Cloudflare resources/config changes (or explicitly none).
- Tests run and pass/fail outcomes.
- Synthetic/production acceptance results.
- Deployment IDs/version IDs and release manifest, where applicable.
- Rollback target/evidence, where applicable.
- Outstanding defects, limitations and next milestone.

Do not mark a milestone complete until all its required acceptance checks pass. A documentation-only milestone must not be described as implementation. A successful Worker health check alone does not prove an end-to-end model integration.

### Milestone log — 4 November 2026 — Milestone 0

**Status:** COMPLETE. The ADR and RPC contract were merged to `main` in PR #61 on 4 November 2026.  
**Branch:** `brvin-2/m0-architecture-freeze`  
**Original review artifact:** https://github.com/ashini-x/parmar-ai/pull/60 (closed as superseded after PR #61 merged).  
**Base audited:** `main` at `a16a9273d581d9dd5acfc3c53c3cc1f2cba819fd`

**Paths changed:**
- `docs/BRVIN_2_ARCHITECTURE_DECISIONS.md` — ADR, target D1 DDL and constraints, identity trust model, Fatman migration seed, compatibility rollout/rollback, AskMoina integration, admin/wizard design and acceptance checks.
- `docs/BRVIN_2_RPC_V2_CONTRACT.md` — private v2 methods, types, request validation, authorisation order, quota and failure semantics, exact-page contract and test matrix.
- `docs/BRVIN_SYSTEM_REFERENCE.md` — links to the BRVIN 2 design while preserving its as-built boundary.
- `docs/BRVIN_INTEGRATION_GUIDE.md` — labels existing instructions as v1 and prevents premature v2 production configuration.
- `docs/BRVIN_PRIVATE_RETRIEVAL_API.md` — labels the implemented RPC as v1 and links the proposed v2 contract.
- `docs/BRVIN_2_MASTER_PLAN.md` — this ledger and continuity record.

**D1 migration:** none. Read-only inspection only. The live database has only the `fatman` project and `fatman → fatman` legacy client mapping. The only direct book grant is Fatman → the built-in 538-page Fatman book; the only collection grant is Fatman → Fatman Core. The ready three-page Rain Gardens test PDF is unassigned. Fatman's `2026-11` usage counter is 20. No tables, rows, grants, source records or usage counters were written or changed.

**Cloudflare:** no configuration, binding, secret, Worker, Workflow, D1, GCS or AI Search changes. Read-only inspection confirmed the current `parmar-ai` and `brvin-service` Workers, their shared D1 binding and shared `default` AI Search instance. `brvin-service` remains configured with `workers_dev: false`; the current caller still uses `props.clientId: "fatman"`. AskMoina production has its own D1 and no BRVIN Service Binding. The AI Search stats endpoint reported 541 completed items and 50 errors labelled `page_limit_reached: Free AI Search image processing is unavailable`; this is an existing index diagnostic, not caused by BRVIN 2. Observed active deployment version IDs at audit time: `parmar-ai` `56cdd777-7f48-4c63-869d-4d18a2de3e9b`; `brvin-service` `1a533c1c-a1e4-4994-9eaa-0dfb0fee0cf1`; AskMoina Voice `abee86c2-8a80-47f3-87f5-eb92a60cc2d8`. These are baseline observations, not deployments from this PR.

**Verification performed:** inspected current `main`, recent commits and PR state; compared the four-commit BRVIN 2 planning delta; read the BRVIN system, private API, integration and operations references; inspected D1 table/index definitions and relevant rows; inspected both BRVIN Worker code paths and Wrangler configs; inspected AskMoina Wrangler/D1/Worker binding state; inspected live Worker settings/deployment versions and AI Search instance/statistics; checked Cloudflare's current D1 `batch()` transaction/rollback documentation. PR #29 is a separate open source-only VRAIN standalone Worker proposal with placeholder D1/GCS values and no production deployment; it is not part of BRVIN 2 or the current live BRVIN service. The design was cross-checked against those facts. GitHub Actions Release Validation run #579 completed successfully on PR head `5d35017c8351af0ac286c84943b6ed86057ba9ee`: `npm run check`, `npm test`, `npm run test:node`, and both Worker Wrangler dry-runs passed; production credential preflight, deployment and live smoke/acceptance jobs were skipped for the PR. The subsequent changes to the current API reference and this ledger are documentation-only; no runtime code changed. Run #581 was queued for the latest docs-only PR head when this entry was written. No synthetic or production acceptance was claimed.

**Deployment / rollback:** no deployment was attempted, so no rollback was required. Existing paired release workflow is unchanged.

**Completion evidence:** PR #61 merged to `main` as `5735314b3e692019c34ba3d2a0d851cbb6c43aa3`. Production D1 contains `brvin_applications`, `brvin_application_environments`, and `brvin_application_project_grants`; migration marker `brvin2-application-identities-v1` is present; Parmar AI application, production environment and Fatman grant match the reserved IDs; `PRAGMA foreign_key_check` returned no rows. The live Worker deployment history shows active versions `brvin-service` `0612b809-84fa-4aab-8a55-3b37262d2409` and `parmar-ai` `ac6a70a2-c4ba-484c-809f-e0ec52fdda1d`. Legacy v1 client `fatman -> fatman`, active Fatman project, ready 538/538-page book, direct book grant, Fatman Core collection grant and `2026-11` usage count 20 remain unchanged. The M2 RPC implementation is now underway.

### Milestone log — 4 November 2026 — Milestone 1 (implementation in progress)

**Status:** IN PROGRESS. The user explicitly authorised continuing after the M0 architecture package; the architecture and migration code are kept on a stacked feature branch. M0's documentation-only PR #60 remains open and unmerged; no GitHub review submission is recorded.

**Branch:** `brvin-2/m1-identity-registry` (based on M0 branch head `6766b62503542358c5c80910d63648b627774920`). **PR:** https://github.com/ashini-x/parmar-ai/pull/61. The PR targets `main` so the repository's existing validation workflow, which is restricted to PRs targeting `main`, can run; its branch ancestry still includes M0 design commits.

**Paths changed so far:**
- `src/brvin/identity-migration.ts` — idempotent identity seed migration using stable Parmar AI/application/environment/grant IDs, conflict preflight, conditional inserts, transactional D1 seed batch, read-back checks, foreign-key check, marker-after-verification, and crash/concurrent-start recovery.
- `src/analytics/db.ts` — additive application, environment and app-project grant tables/indexes in the existing shared D1 schema; runs the BRVIN 2 seed after existing legacy compatibility initialization.
- `test/brvin2-identity-migration.test.ts` — migration tests for first seed, idempotency/revocation, interrupted marker recovery, concurrent cold starts, slug conflict, foreign-key failure and missing Fatman project.

**Safety boundary:** source branch only. No D1 migration has been applied to production. No Cloudflare resource, binding, secret, AI Search instance, Worker deployment, book/source grant, legacy service-client row or usage counter has been changed. The existing `brvin_service_clients` v1 mapping and `fatman_search_usage` remain untouched. The new v2 resolver is not implemented or enabled in M1.

**Verification:** Release Validation run #586 completed successfully on the corrected M1 head `bf8567322b84dee5954443171500af44aac08f29`: `npm run check`, `npm test`, `npm run test:node`, the private BRVIN Worker Wrangler dry-run, and the Parmar AI Worker Wrangler dry-run all passed. The production credential, deployment and live-acceptance jobs were skipped for this PR. Earlier run #584 caught three strict-typing issues in the fake-D1 test double; those were corrected before run #586. Run #585 was cancelled by the PR concurrency group and is not counted as validation.

**Next actions:** complete the M1 code/design review, verify the exact production D1 baseline immediately before rollout, then apply the additive migration only through the approved release path. PR #61 contains the M0 design files and M1 source slice; PR #60 remains open as the original docs-only review artifact. Do not deploy or apply the D1 migration until the M1 review and release gate are satisfied.

### Milestone log — 4 November 2026 — M1 production migration completed

**Status:** COMPLETE — merged and live identity registry verified.
**Pull request:** https://github.com/ashini-x/parmar-ai/pull/61
**Merge commit:** `5735314b3e692019c34ba3d2a0d851cbb6c43aa3`.
**Implementation validation:** Release Validation run #586 passed `npm run check`, `npm test`, `npm run test:node`, private BRVIN Worker Wrangler dry-run and Parmar AI Worker Wrangler dry-run. The check ran against implementation commit `bf8567322b84dee5954443171500af44aac08f29`; the final merge added documentation-only ledger changes after that validated code commit.

**Production deployment:** Both Workers received active 100% deployments after merge. `brvin-service`: `0612b809-84fa-4aab-8a55-3b37262d2409`; `parmar-ai`: `ac6a70a2-c4ba-484c-809f-e0ec52fdda1d`. The existing production release workflow includes the paired deployment, `/health`/root smoke test and release manifest acceptance.

**Production D1 evidence (read-only verification after migration):**
- New tables exist: `brvin_applications`, `brvin_application_environments`, `brvin_application_project_grants`.
- Migration marker `brvin2-application-identities-v1` exists.
- Application `00000000-0000-4000-8000-000000000101` = active `parmar-ai` / Parmar AI.
- Production environment `00000000-0000-4000-8000-000000000102` = active and correctly parented to the Parmar AI application.
- Grant `00000000-0000-4000-8000-000000000103` = active Parmar AI → existing Fatman project `fatman`.
- `PRAGMA foreign_key_check` returned no rows.
- Legacy client remains `fatman -> fatman`; the sole registered project remains active Fatman; its 538-page built-in book remains ready at 538/538; its direct book grant and Fatman Core collection grant remain unchanged.
- `fatman_search_usage` for `2026-11` remains at 20. All inspected queries were read-only (`rows_written=0`).

**Compatibility boundary:** The new registry is present, but M2 v2 resolver/RPC methods are not yet implemented. The current live Parmar AI binding continues to use v1 `props.clientId='fatman'`; no v2 caller cutover has happened.

**Outstanding:** No source, permission, quota or end-to-end retrieval behavior was changed by the migration. M2 must now implement the private v2 RPC and comprehensive negative/authorization tests without removing or changing v1.

### Milestone log — 4 November 2026 — Milestone 2 implementation in progress

**Status:** IN PROGRESS — RPC v2 implementation and tests are in PR #62; the latest health-probe changes require a fresh validation run before review/merge.
**Branch:** `brvin-2/m2-private-rpc-v2`.
**Pull request:** https://github.com/ashini-x/parmar-ai/pull/62.

**Paths currently changed for M2:**
- `src/config/env.ts` — typed v2 project selector, authorized-project metadata, success/failure envelope, error codes and service binding methods.
- `src/brvin/service-core.ts` — strict trusted environment resolution, active application check, per-project grant verification, app-scoped project discovery, project status, bounded retrieval, existing project-level quota reuse and structured content-free logs.
- `src/brvin/service-worker.ts` — additive v2 WorkerEntrypoint methods; v1 methods remain explicitly tied to `clientId`.
- `test/brvin-v2-service.test.ts` — environment/project failures, no identity fallback, opaque Fatman ID, denied grants, inactive app/environment/project, no-source behavior, bounded inputs, folder filtering and Fatman quota tests.
- `wrangler.jsonc` — adds the seeded Parmar AI production `applicationEnvironmentId` alongside the existing `clientId` in trusted Service Binding props; no preview or AskMoina binding is changed.
- `src/index.ts` — `/health` probes both v1 and v2 Fatman project status and requires their authorised-source counts to match. The v2 status probe does not consume retrieval quota.
- `scripts/production-smoke-test.mjs` — requires the production smoke check to verify both v1 and v2 readiness.

**Verification so far:** core v2 code passed Release Validation run #590 (TypeScript, unit tests, Node tests, private BRVIN Worker dry-run and Parmar AI Worker dry-run). That run preceded the later dual-health-probe, production binding-props and smoke-script edits; those edits are not yet claimed validated. Run #589 was cancelled by GitHub PR concurrency and is not counted.

**Production boundary:** none of the M2 branch changes are deployed or applied. Current production remains on M1 deployment versions until M2 is reviewed/merged. No D1 schema or source grant change is part of M2.

**Next actions:** rerun CI against the latest PR #62 head. If all checks pass, merge/deploy the private service RPC plus dual health probe through the established main-branch workflow and verify the live v1/v2 status checks, source parity, Fatman retrieval and unchanged usage policy. Do not switch end-user retrieval consumers to v2 until the next planned integration milestones.

### Milestone log — 4 November 2026 — M4 AskMoina integration started

**Status:** IN PROGRESS across the BRVIN and AskMoina repositories.

**BRVIN branch:** `brvin-2/m4-askmoina-identity` (based on M2 production main). It adds the one-time migration `brvin2-askmoina-application-identities-v1` with reserved identities:
- Application `00000000-0000-4000-8000-000000000201`, slug `askmoina-voice`.
- Production environment `00000000-0000-4000-8000-000000000202`.
- Preview environment `00000000-0000-4000-8000-000000000203` (registered but deliberately not bound in the public AskMoina Preview).
- Explicit app-project grant `00000000-0000-4000-8000-000000000204` to the existing active Fatman project `fatman` only. This is the only currently provisioned/ready BRVIN project. No other project is granted.
- The migration uses preflight conflict checks, one transactional seed batch, exact read-back checks, foreign-key validation, marker-after-verification and idempotent retry behavior. It preserves later admin revocation and does not modify the existing Parmar AI grant, legacy v1 mapping, source grants or usage counters.
- Tests cover first seed, retry/idempotency after revocation, interrupted-marker recovery, concurrent initialization, application/environment/grant conflicts, missing Fatman and foreign-key failure.

**AskMoina branch:** `brvin-2/m4-brvin-integration` based on AskMoina main. It vendors the BRVIN connector pinned to upstream BRVIN M3 branch-head commit `e092659f352442e27df53529bd4c31ba78026541`. M3 PR #63 has a successful Cloudflare preview build, but its GitHub test job remains queued; the consumer PR must record this dependency and must not merge before M3 is merged/validated.

**AskMoina changes so far:**
- Added optional `BRVIN_SERVICE` Service Binding type and trusted `BRVIN_DEFAULT_PROJECT_ID`/timeout vars. The binding is absent from the Preview configuration.
- Added `src/brvin-knowledge.ts` for authenticated evidence lookup using only the server-configured Fatman project. It validates semantic query/page input and returns cited evidence or explicit no-result/denied/quota/outage instructions; no fallback project is selected.
- Added `search_brvin_knowledge` to authenticated Gemini Live audio and Co-Pilot tool declarations only. Guest and preview sessions do not receive it. The function is handled inside the existing Worker socket path; raw tool calls are withheld from browser frames and returned as Gemini function responses.
- Existing Gemini Live remains answer generator/speaker. Existing AskMoina account auth, D1 history, Key Memories, relay/session resumption, audio/video state and user continuity are unchanged.
- Added `test/brvin-knowledge.test.ts` and pending-tool tracking coverage for BRVIN retrieval to prevent silent-turn recovery from mistaking a pending source lookup for a dead reply.
- `wrangler.jsonc` has a top-level production BRVIN binding using the registered production environment ID; the `previews` block intentionally omits BRVIN. This file is not deployed yet.

**Safety/rollout boundary:** neither branch has been merged or deployed for M4. No AskMoina production binding has been added to Cloudflare; no AskMoina or BRVIN production D1 data has yet been changed by M4. The BRVIN app/identity/grant seed only becomes live after its PR is reviewed/merged and the BRVIN release runs. AskMoina production binding/tool only becomes live after the identity is verified and its own PR/release succeeds.

**Next actions:** open and validate the BRVIN identity migration PR; open and validate the AskMoina integration PR; merge/deploy the BRVIN identity first; verify both environments and exact Fatman grant in D1; then merge/deploy AskMoina and run production tool tests for semantic question, exact physical PDF page, no result, denied/revoked grant, quota exhaustion and BRVIN outage. Keep preview unbound.
### Milestone log — 4 November 2026 — M3 completed and M4 rebased onto main

**M3 completion:** PR #63 merged as `91b6a499bd782ae298b41e790157c23682f10881`. Release Validation #608 passed `npm run check`, `npm test`, `npm run test:node`, and both Worker Wrangler dry-runs. Cloudflare preview build `a4c154e3-c056-489a-9b14-8ebac9ed9c0d` also passed. The reusable connector is now available on main at `packages/brvin-connector`.

**M4 BRVIN identity:** work has been moved from stale branch `brvin-2/m4-askmoina-identity` onto `brvin-2/m4-askmoina-identity-main`, based on main after M3 merge `91b6a499bd782ae298b41e790157c23682f10881`. The identity migration, `src/analytics/db.ts` initializer call, migration tests and updated ledger are all present on that branch. Release Validation #609 passed TypeScript, unit tests, Node tests and both Worker dry-runs on equivalent M4 implementation before rebasing; a fresh run is required for PR #65.

**PR transition:** previous PR #64 is based on pre-M3 main and will be closed as superseded. The rebased branch is submitted as PR #65 so its base is current main and the M3 connector exists before M4 migration review.

**AskMoina consumer:** PR #370 is open in `ashini-x/askmoina-voice`. Its branch vendors the M3 connector, adds the authenticated `search_brvin_knowledge` Gemini Live function, calls the server-side connector using only configured project `fatman`, and deliberately leaves preview unbound. It has not been merged or deployed. Its upstream connector pin will be advanced to the M3 merge commit in a follow-up commit.

**Production boundary:** M4 identity migration has not been applied to production D1. The AskMoina Worker production binding has not been deployed. The Fatman grant is shared with other authorised consumers and therefore shares Fatman's current monthly quota; no limit increase or alternate project grant is included.

### Milestone log — 4 November 2026 — M4 deployed and exact-page acceptance verified

**BRVIN M3 — COMPLETE.** PR #63 merged as `91b6a499bd782ae298b41e790157c23682f10881`; Release Validation #608 passed TypeScript, unit, Node and both Worker dry-runs. Cloudflare Preview build `a4c154e3-c056-489a-9b14-8ebac9ed9c0d` succeeded.

**BRVIN M4 identity — MERGED AND DEPLOYED.** PR #65 merged as `0b3c621b83a28de2f4ca5da95db349b364558a60`; fresh rebased Release Validation #611 passed all typecheck/test/Worker dry-run gates. The normal main release run #612 completed success and applied the idempotent D1 registration migration.

Production D1 `parmar-ai-admin-prod` read-back:
- AskMoina application `00000000-0000-4000-8000-000000000201`, slug `askmoina-voice`, active.
- Production environment `00000000-0000-4000-8000-000000000202`, active.
- Preview environment `00000000-0000-4000-8000-000000000203`, active, display name explicitly says not bound to BRVIN.
- AskMoina→Fatman grant `00000000-0000-4000-8000-000000000204`, active.
- Migration marker `brvin2-askmoina-application-identities-v1` present; `PRAGMA foreign_key_check` returned no rows.
- Fatman remains active. Its November 2026 query counter was 20 before live synthetic calls and 22 after two exact-page smoke requests; no grant/quota increase was made. All D1 audit queries were read-only.

**AskMoina consumer — MERGED AND DEPLOYED.** PR #370 merged as `ce725d33df452de0e9df2f4613c70ec89592251e`. Release Validation #1761 and Workers Build passed. The production Worker config binds `BRVIN_SERVICE` to `brvin-service` / `BrvinRetrievalApi`, trusted environment ID `00000000-0000-4000-8000-000000000202`, and fixed `BRVIN_DEFAULT_PROJECT_ID=fatman`. Preview Wrangler config has no Service Binding and no default project ID. The app's own D1/auth/history/memory/Gemini/audio/video/session relay/resumption remain consumer-owned.

Production exact-page synthetic on the deployed AskMoina Worker:
- Script `scripts/live-brvin-knowledge-smoke.py` requested physical PDF page 14 through the authenticated Gemini Live WebSocket.
- Synthetic output: `brvin_exact_page`, `passed=true`, `bookCitation=true`, `physicalPdfPage14Citation=true`.
- Cloudflare telemetry for BRVIN RPC shows caller application ID `00000000-0000-4000-8000-000000000201`, environment ID `00000000-0000-4000-8000-000000000202`, environment key `production`, project `fatman`, outcome `success`, sourceCount 1; AskMoina connector outcome `success` and bounded response bytes. Second run after benchmark patch also succeeded in 3691 ms.
- AskMoina production Worker deployment after the benchmark-only fix: version `57355cd5-b41b-4978-a00e-390acafadf7a`, 100% traffic, release `0.4.170`.

**Production synthetic qualification:** Initial deployment run #643 failed on the existing turn-latency benchmark, even though the provider turn was complete and had produced 101,760 audio bytes. The benchmark's timestamp was set after a retained 120 ms quiet PCM tail, so valid audio generated during the tail was misclassified. All other tests passed, including BRVIN exact page, 3 sequential web lookups, spoken answer/card, ranked list, voice memory, browser network recovery, >170-second Live continuity and conversation-history/memory APIs.

A benchmark-only fix was merged in AskMoina PR #372 as `7893ea5f79a930c2e425dc9a87997b2412435d25`: measure speech end at the last meaningful PCM frame, return that offset with the trimmed fixture, and add four deterministic regression tests. No production Worker runtime, model prompt, DB schema, binding or quota behavior changed in this fix. Release Validation and Cloudflare Preview checks passed before merge. Main release #644 has deployed the benchmark fix and is re-running the full synthetic acceptance. The exact-page BRVIN synthetic has passed again and production health/routes/PWA are green; keep M4 status provisional until run #644 completes, especially the 20-turn latency benchmark and remaining continuity/history checks.


### Milestone log — 5 November 2026 — M4 acceptance-harness follow-up (still in progress)

**Consumer runtime state:** No new AskMoina application feature or production Worker runtime change was part of this follow-up. The AskMoina–BRVIN connection, authenticated Gemini Live tool and fixed Fatman project selector remain deployed. The production Worker is version `6b6b5a56-24b3-4b74-ad0c-1a47c78df784` at 100% traffic after merge commit `0840af352a1e9ab03bfd36a39b691bb6068af55b`.

**What the latest failed run actually proved:** AskMoina production run #647 passed BRVIN exact-page retrieval (physical PDF page 14), three sequential grounded searches, spoken information card, ranked-list response, selected spoken memory, browser network recovery, >170-second Live continuity and conversation-history/memory APIs. The camera Co-Pilot and 20-turn audio benchmark checks failed because the harness waited for `interactionStatus: IDLE` even though the provider omitted that optional status field; the benchmark had received 120,000 audio bytes over 21 messages. This was a synthetic protocol-completion assertion failure, not a failed BRVIN authorization or evidence lookup.

**Corrective implementation:** AskMoina PR #379 (merge `0840af352a1e9ab03bfd36a39b691bb6068af55b`) changes only `scripts/live-brvin-camera-smoke.py`, `scripts/live-turn-latency-benchmark.py` and `scripts/test_live_turn_latency_boundary.py`. The finite audio benchmark now emits the already-supported audio-stream-end marker and both tests recognize explicit `generationComplete` or valid `turnComplete` terminal signals while retaining the real output requirements (camera fixture label, Fatman source, physical page 14, generated audio, and all 20 latency samples). Release Validation #1787 passed. No AskMoina runtime source, prompts, D1 data, BRVIN D1 rows, grants, quota, secrets or Cloudflare bindings were changed by PR #379.

**Production rollout:** Run #648 was triggered from the merged main commit. The new Worker upload was promoted to 100%; production health, protected routes, no-guest gate and PWA checks passed. The synthetic acceptance step was still running when this ledger entry was written. Do not mark M4 complete or begin M5 until the terminal result of run #648 is inspected. If it fails, record the exact failing assertion and distinguish a real application/runtime failure from another harness mismatch before changing code.

**Outstanding M4 acceptance:** Run #648 must complete successfully with BRVIN exact-page and camera Co-Pilot retrieval, grounded searches, spoken card and ranked-list output, 20-turn audio benchmark, voice memory, network recovery, long-session continuity, and history/memory isolation. The current run is the single active gate; do not launch another overlapping production synthetic run while it is executing.

## 8. Rules for future ChatGPT/Codex sessions

**Active product direction:** BRVIN is the teacher digital-brain knowledge platform and application connection manager. ChatGPT remains the user's application engineer through its separately authorized GitHub and Cloudflare integrations. Do not implement the superseded autonomous Project Factory.

At the start of every new session:

1. Read [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md) in full.
2. Read this master plan and its latest progress/scope-decision log.
3. Read [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) for the as-built code and production facts.
4. Read [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md) and [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md) before touching application identity, grants, Service Binding or retrieval.
5. Treat [BRVIN_AUTONOMOUS_PROJECT_FACTORY.md](BRVIN_AUTONOMOUS_PROJECT_FACTORY.md) as superseded historical documentation only. Do not follow its milestones.
6. Inspect the current main branch, latest commits, PRs, workflow runs and relevant production state. Do not assume the previous chat's status is still current.
7. Resume at the first incomplete M6–M11 acceptance item. Do not redo completed milestones or create the retired fixed test client.
8. Implement one milestone at a time. Use a feature branch and focused PR.
9. Update the master plan, final product-scope document and relevant as-built/contract documents in the same PR. Record tests, CI run, PR, merge, deployment and live-verification evidence.
10. Clearly distinguish planned, coded, deployed and live-verified behavior. Never mark a milestone complete from a mock, registry row or unit test alone.

### Repository, runtime and data safety

- ChatGPT performs consumer repository code changes, CI/CD and deployment using the user's own authorized integrations.
- BRVIN does not create repositories, build application code, administer ChatGPT's provider connection or run an autonomous coding agent.
- Never expose `brvin-service` publicly.
- Never put BRVIN D1, AI Search, GCS or master credentials in a consumer application.
- Never accept app/environment identity from browser or request-body fields.
- Preserve Fatman's data, quota history and current retrieval behavior.
- Preserve existing AskMoina Voice runtime; it is optional and not a fixed test harness.
- Audit dependencies before hiding/removing historical provider-admin UI or stored credentials. This scope change alone does not authorize credential deletion/revocation.
- Do not create a new knowledge database/index/Worker/repository for each teacher knowledge project.
- Do not claim a live connection without a real v2 Service Binding verification.

## 9. Completion definition

BRVIN 2 is complete when a nontechnical administrator can:

1. Create a distinct knowledge project for a teacher/use case.
2. Upload and organize PDFs, shortcuts, formulas, methods and notes supported by the ingestion pipeline.
3. See OCR/indexing progress, readiness, failures and recovery actions.
4. Register an independently built application, its repository/runtime references and trusted deployment environments.
5. Generate a correct, non-secret ChatGPT integration handoff for the application's first-time code integration.
6. Use ChatGPT and the user's separately authorized GitHub/Cloudflare connections to integrate, test and deploy the application.
7. Verify that the deployed consumer calls private BRVIN v2 through its trusted environment identity.
8. Grant one or more knowledge projects to an application and revoke them without another code deployment.
9. Prove teacher/project isolation, cross-application grants, source readiness, no-result behavior, quotas and failure recovery.
10. Inspect application health, project/source usage, audit events, grants, revocations and operating instructions from the BRVIN admin panel.

The connected application generates its final answers using its own model/provider. BRVIN supplies only authorized evidence and provenance. The finish line is a reliable, reusable knowledge service with low-friction application onboarding—not an autonomous software factory.


### Historical milestone log — 5 November 2026 — earlier acceptance target correction (superseded by final product scope)

**Historical note:** At the time of this older entry, the first test was planned as a separate text-only Worker inside askmoina-voice and was later changed to a factory-generated PDF-chat application. The fixed test fixture was removed by PR #386; PR #385 was closed without merging. A subsequent 5 November 2026 product-scope decision superseded the Project Factory target as well. Neither historical target is active. Do not follow the old test-Worker or factory implementation steps recorded below.


**User direction:** Stop treating the existing AskMoina Voice application as the product BRVIN must repair. BRVIN is the product; the existing AskMoina voice app is only an optional consumer/pilot. The first controlled architecture test will be a separate, text-only Worker housed in the `askmoina-voice` repository.

**What has already shipped:** The AskMoina voice integration (PR #370) and its acceptance-harness changes exist on production. AskMoina PR #380 (merge commit `ffa145b970b929f996b12a09fd94033567806319`) changes only acceptance scripts/CI to follow Gemini Live turn boundaries. Release Validation on the merged head passed. It did not add a new consumer-facing voice feature. A production workflow triggered by that merge may finish, but its camera/audio/latency outcome is informational and does not gate BRVIN M4. Do not start more voice-specific acceptance runs or alter the production voice runtime for BRVIN.

**M4 implementation delivered:** A separate Worker named `brvin-test-client` in `ashini-x/askmoina-voice`, with config `wrangler.brvin-test-client.jsonc`, entrypoint `workers/brvin-test-client/src/index.ts`, isolated TypeScript config `tsconfig.brvin-test-client.json`, text interface and server-side connector handler. It lists only projects returned for its future trusted identity, accepts a text query/exact page and displays source citations. It does not share the existing voice Worker's runtime or production state.

**Identity/data safety:** The test Worker needs a distinct `brvin_applications` row, environment identity, app-project grant and dedicated test project/source. Never borrow AskMoina's production environment ID as a new app identity; never default the test client to Fatman or hard-code a fabricated identity. Use the M5 protected admin lifecycle to create these records and grant the test project. Before that is available, build the test Worker against mocked connector contracts and validate locally. No production D1 mutation is authorised by this plan note.

**Sequence:** M4 scaffold is complete. (1) M5: implement application/project administration, including test app/environment/project/grant lifecycle; (2) M6: use Connect Application to add the generated environment ID as trusted Service Binding props and deploy/connect the test Worker with a separate test access token; (3) M7: verify real retrieval/citations, app isolation, denial/revocation and future-project automation. The existing AskMoina voice app is not a dependency for these steps.


### Milestone log — 5 November 2026 — M5 application/project administration complete

**Status:** COMPLETE — implementation merged, paired production deployment succeeded, and the live release acceptance gate passed.

**Branch / PR:** `brvin/m5-application-project-admin`; [PR #72](https://github.com/ashini-x/parmar-ai/pull/72), squash merge `5872c2d21cdef17feb21d661e50ddde820c51f40`.

**Paths/components changed:**
- `src/brvin/admin.ts` — application registry/environment/grant overview; create application; create environment identity; suspend/reactivate/revoke application; disable/reactivate/revoke environment; grant/revoke app-project permissions with retained revocation history; app-associated project creation; project edit/activate/deactivate; mobile-friendly Applications & Access dashboard.
- `src/index.ts` — new POST routes behind existing admin authentication and same-origin/CSRF protection.
- `test/brvin-app-admin.test.ts` — application/environment lifecycle, active-state constraints, grant/revoke, revocation permanence, app-bound project creation and legacy service-client compatibility tests.
- `test/brvin-admin-script.node.test.ts` — dashboard UI and route contract assertions.

**Compatibility and data safety:** No D1 schema migration was added or applied. No production D1 rows, grants, counters or source permissions were mutated by this change. A new project created with an application ID receives an explicit `brvin_application_project_grants` row and no legacy `brvin_service_clients` row. The legacy/no-application path remains available for existing v1/Fatman consumers. Knowledge-source book/collection grants remain independent of app-project grants.

**Verification:**
- PR Release Validation #41899630676 passed `npm run check`, `npm test`, `npm run test:node`, private BRVIN service dry-run and Parmar Worker dry-run.
- Main Release Validation and paired production release [#41900067751](https://github.com/ashini-x/parmar-ai/actions/runs/41900067751) completed success.
- Cloudflare Workers Build [3ae32566-9d8e-4a2d-bd8b-e1267167cb1c](https://dash.cloudflare.com/b34a6c0b7221454c5db977fe61ddf759/workers/services/view/parmar-ai/production/builds/3ae32566-9d8e-4a2d-bd8b-e1267167cb1c) completed success. Production versions: `brvin-service` `c6755ca2-5b5f-4968-8bbc-e957a767926d`; `parmar-ai` `d239c941-f119-4ad1-9020-63e9a2353434`.
- Production root and BRVIN-backed health/Fatman readiness smoke passed. The acceptance manifest reports `workerHealth=passed`, `brvinServiceBinding=passed`, `fatmanRetrieval=passed`; artifact `13357333270` was uploaded. Automatic rollback steps were skipped because acceptance passed.
- The branch-preview Cloudflare build failed only because the account had reached the Free-plan limit of 100 Durable Object namespaces. This was a preview quota issue, not a source/test failure; the main production build/deployment passed. No plan upgrade or quota workaround was attempted.

**M5 boundary:** The dashboard distinguishes a registered environment from a live-verified Worker connection. M6 owns GitHub/Cloudflare discovery, Service Binding provisioning and post-deployment connection verification. The production release acceptance verified root, private BRVIN connectivity and Fatman retrieval; the new administrative lifecycle is covered by code/route tests and is now deployed.

**Historical next step (superseded):** M6 was originally planned to register and deploy the fixed text-test Worker. That path has been retired. Follow the revised M6 — Delegated Provider Administration & Credential Lifecycle section at the start of this plan.

### Historical milestone log — 5 November 2026 — original fixed-adapter M6 Connect Application wizard (retired)

**Retirement note:** The fixed test-client provisioning and deployment workflow described in this historical entry was removed in PR #83/#386. PR #385 was closed without merging. Do not follow its test-client registration, secret-copy, adapter-PR or deployment steps. The revised M6 is provider administrator consent, credential creation and secret delivery for the Project Factory.


**Status:** IN PROGRESS — Connect Application is merged and production-deployed, but the first independent text consumer is not yet registered, deployed or live-connected. M6 is not complete until the administrator's provider setup, generated adapter PR, independent Worker deployment, live identity check and a real text retrieval smoke test all pass.

**Branch / PR / merge:** `brvin/m6-connect-application-wizard`; [PR #75](https://github.com/ashini-x/parmar-ai/pull/75), merged to `main` as `7ee4b58320ba457ac2ac94651ad872fd0b937445` on 5 November 2026.

**Implementation paths:**
- `src/analytics/db.ts` — provider connection vault, hashed one-time OAuth states and connection audit events.
- `src/brvin/connect-wizard.ts` — private GitHub App manifest/install/repository workflow; Cloudflare OAuth and refresh; fixed BRVIN home-account check; dedicated text-test app/environment/project/grant registration; fixed supported adapter PR generation; deployment checks; one-time tester token only after a live project RPC check.
- `src/brvin/admin.ts` — protected Connect Application workspace, fixed app identity selector, provider setup and PR/test actions.
- `src/index.ts`, `src/config/env.ts`, `wrangler.jsonc` — protected routes, types and fixed home-account configuration.
- `test/brvin-connect-wizard.test.ts`, `test/brvin-admin-script.node.test.ts` — OAuth scope/state/security, isolated identity, rejected voice app reuse, live runtime probe and UI/API contracts.
- `docs/BRVIN_2_MASTER_PLAN.md` — milestone ledger and this as-built release log.

**Non-voice isolation:** The only supported code adapter targets `wrangler.brvin-test-client.jsonc` and `workers/brvin-test-client/src/index.ts` in `ashini-x/askmoina-voice`. This is a separate text-only Worker with a separate runtime, Wrangler config, bearer-token gate and deployment workflow. The repository is only its source-code home. PR #75 does not change the AskMoina Voice Worker, voice production config, Gemini Live, camera/microphone sessions, voice UI, AskMoina D1 databases or the voice production workflow. The wizard hardcodes `brvin-text-test-client` / `production` and refuses to reuse `askmoina-voice` or `parmar-ai` identities.

**Automated validation and production release:**
- M6 PR Release Validation [#41915083328](https://github.com/ashini-x/parmar-ai/actions/runs/41915083328) passed `npm run check`, `npm test`, `npm run test:node`, private BRVIN service dry-run and Parmar AI Worker dry-run.
- Main paired release and live acceptance [#41915231086](https://github.com/ashini-x/parmar-ai/actions/runs/41915231086) passed. It deployed both Workers and passed root, BRVIN connectivity and Fatman readiness smoke checks. Automatic rollback steps were skipped because the release gate succeeded.
- Active production version IDs at 100%: `parmar-ai` `0828f742-0018-448c-a2ec-aa4bc97bea19`; `brvin-service` `f1ae2248-a5af-415e-8f7c-6dd6fd4d8d24`. Release manifest / acceptance artifact: [#13363568373](https://github.com/ashini-x/parmar-ai/actions/runs/41915231086).
- The schema-on-demand release added `brvin_provider_connections`, `brvin_oauth_states` and `brvin_connection_events` to the shared production D1. Read-only query after deployment: zero provider connection records, zero OAuth states and zero connection events.
- Read-only production D1 audit confirms the only app rows remain Parmar AI and AskMoina Voice; only the existing `fatman` project is present; only the prior Parmar AI → Fatman and AskMoina Voice → Fatman application-project grant rows remain. No dedicated text-test app/environment/project/grant has been created.
- Read-only Cloudflare Worker inventory confirms `parmar-ai` and private `brvin-service` exist, but `brvin-test-client` does not yet exist in the account. No test Worker binding or tester token has been provisioned.
- AskMoina PR #383 merged the independent test-Worker deployment workflow. Its first deploy [#41908940305](https://github.com/ashini-x/askmoina-voice/actions/runs/41908940305) passed the test-client checks, 597 tests and Wrangler dry-run but failed deployment with `No access to the specified resource`. AskMoina PR #384 then changed only that workflow to use a separate `BRVIN_TEST_CLOUDFLARE_API_TOKEN` and merged as `2e3a0896599f678a6c1f395d76dd06c762934d01`; Release Validation #41909320822 passed. The dedicated secret is not yet present in repository Actions secrets.
- No user provider credentials, provider connection rows, new app identities, test project grant, Service Binding changes or test-worker secret were written by the M6 merge/release.

**Outstanding M6 administrator gates:**
1. Open the deployed BRVIN admin workspace and register the private BRVIN GitHub App; install it only for `ashini-x/askmoina-voice`.
2. Create the private Cloudflare OAuth client using authorization-code and refresh-token grants, the exact callback URL from the wizard, and required Workers Scripts Read/Write scopes; save the client ID/secret through the admin UI and authorize the fixed BRVIN home account.
3. Use the wizard to create the dedicated BRVIN Text Test Client application, its production environment, isolated project and explicit project grant.
4. Add `BRVIN_TEST_CLOUDFLARE_API_TOKEN` to `ashini-x/askmoina-voice` Actions secrets with account-scoped Workers Scripts Write permission. Do not reuse the AskMoina Voice deployment token.
5. Generate and review the adapter PR; explicitly merge it so the independent text Worker workflow deploys only `brvin-test-client`.
6. Verify the deployed `BRVIN_SERVICE` binding/entrypoint and 100% traffic. The Worker settings API does not expose `props`, so the wizard's definitive check must be its authenticated live `/api/projects` response containing the dedicated project ID before it reveals the one-time tester token.
7. Run a real text question / exact-page retrieval smoke test after assigning at least one ready source to the test project.

**Current next milestone:** Continue revised M6 — delegated GitHub/Cloudflare administrator authorization and credential lifecycle. Do not provision or deploy the old text-test Worker. After the two provider consents are approved, implement real account-token creation, direct Actions/Worker secret delivery, project-scoped verification, rotation and revocation before M7.


### Historical milestone log — 5 November 2026 — M4 reference Worker scaffold delivered (retired later the same day)

**Retirement note:** AskMoina PR #386 removed this scaffold's Worker, configuration, tests and deployment workflow. No test Worker was ever deployed. PR #385 was closed without merging. The generic connector is preserved; do not follow historical steps here to provision, bind or deploy `brvin-test-client`.


**Implementation:** AskMoina PR #381, “M4: add isolated text-first BRVIN test client Worker”, merged to main as `bf8e5a1e9fe7f451ad31430143ab52aaf801214e`. It adds an independent `brvin-test-client` Worker with `wrangler.brvin-test-client.jsonc`, `workers/brvin-test-client/src/index.ts`, `tsconfig.brvin-test-client.json`, a text retrieval UI and its dedicated tests.

**Security and isolation:** All API routes require the `BRVIN_TEST_ACCESS_TOKEN` secret. The Service Binding and `applicationEnvironmentId` remain absent by design; the browser cannot select an application identity. The Worker has no AskMoina D1, Durable Object, queue or Gemini bindings. It is not deployed. Existing voice-worker production deploy, production-health and voice-synthetic workflows ignore test-client-only changes.

**Validation:** The merged PR's Release Validation includes the separate Worker type-check, full existing `npm test`, and a separate Wrangler dry-run for `wrangler.brvin-test-client.jsonc`. The PR was merged after its validation passed. The test client contract covers token authentication, only-authorized project discovery, pre-retrieval denial for other projects, readiness, exact physical page, retrieval citations, cross-origin denial and no-binding behavior.

**M4 completion boundary:** This completes the independent reference-client scaffold, not live connectivity. No Service Binding, app/environment D1 row, test-project grant, secret deployment or Worker deployment was done. M5 must provide protected admin lifecycle for those records; M6 connects and deploys; M7 performs live acceptance. Do not resume AskMoina camera/audio/latency production test cycles as BRVIN blockers.


### Milestone log — 5 November 2026 — Autonomous Technical Administrator and Project Factory direction approved

**Decision status:** APPROVED PRODUCT DIRECTION; documentation only in this change. No runtime implementation, provider permission change, credential rotation, D1 mutation or Cloudflare deployment is claimed.

**User's canonical goal:** BRVIN is the user's autonomous technical administrator and engineering brain across GitHub and Cloudflare. The user intends to grant administrator-level provider authority. BRVIN should decide what repository, infrastructure, credential, token, Actions secret, Worker secret, workflow, binding, test and deployment is needed for each project, provision it directly, verify it and maintain it. The user should mainly provide an idea and approve the project plan or genuinely consequential changes—not perform routine technical administration.

**New architecture:** Added BRVIN_AUTONOMOUS_PROJECT_FACTORY.md as the binding design for provider administration, credential lifecycle, independent software repositories, Project Factory orchestration, approval policy, security and the first generated application. Software projects receive independent GitHub repositories; BRVIN knowledge projects remain workspaces in the shared BRVIN platform and do not create repositories or deployments. This preserves the original multi-application/multi-project retrieval design.

**First proof application:** Chat with Your PDFs. BRVIN must generate a separate ChatGPT-like text application, create its repository and Cloudflare runtime, configure credentials/secrets automatically, connect a dedicated BRVIN application/environment/knowledge project, reuse existing PDF ingestion/private retrieval, deploy it and prove grounded answers with physical PDF-page citations plus denial/revocation behavior. The application owns its UI, user authentication, conversations and answer generation; BRVIN owns knowledge ingestion, permissions and evidence retrieval. AskMoina Voice/Gemini Live is not required.

**Provider permission model:** GitHub uses the broad GitHub App permissions supported for repository creation/administration, contents, pull requests, Actions, Actions secrets/variables, environments, deployments and related lifecycle operations, installed across all repositories when the user approves. GitHub App installation tokens are the default automation credential; user-authorised OAuth is used only for operations unavailable to installation tokens. Do not claim that GitHub can mint a classic PAT through an unsupported API. Cloudflare uses Developer Platform Admin scopes for the products BRVIN manages and the account token-provisioning capability; the current Workers Editor-only authorization is insufficient. Token scopes, actual permission groups, resource scopes and token lifecycle must be verified.

**Credential policy:** BRVIN chooses the credential type based on the operation, generates Cloudflare tokens only when required, stores provider credentials encrypted in a versioned vault, and sends generated deploy/runtime secrets directly into GitHub Actions repository/environment secrets or Cloudflare Worker secrets. Master administrator credentials must never be injected into generated applications. Per-project credentials are scoped and revocable; operations are audited and idempotent. No token is copied by the user as a recurring task.

**Existing implementation truth:** M0–M5 remain complete. The narrow M6 Connect Application wizard (PR #75, merge 7ee4b58320ba457ac2ac94651ad872fd0b937445) remains deployed as a foundation, but it is not accepted as the complete delegated-administrator/Project Factory capability. The current provider connection supports Workers Editor, not the full approved Admin/token-provisioning model. The fixed adapter remains limited to ashini-x/askmoina-voice.

**Retired proposal and adapter:** AskMoina PR #385 was closed without merging. The isolated text-client source/config/tests/deployment workflow were removed from `askmoina-voice` by [PR #386](https://github.com/ashini-x/askmoina-voice/pull/386), merged as `6ed5b5f59f5d972dd3af8e832261ef7168206703`. Release Validation #1815 passed (run `42016305287`). The Cloudflare account inventory confirmed no `brvin-test-client` Worker had been deployed. The old BRVIN app/environment/project/grant records were revoked/inactivated, and the GitHub connection's PR #385 metadata was cleared. The ready `BRVIN Test - Rain Gardens (3 pages)` PDF remains in the library as an unassigned source; no document bytes or OCR/index data were deleted. Do not reopen PR #385 or recreate this fixed adapter. The new proof application must be generated in its own repository by the Project Factory.

**Revised sequence:** M6 Delegated Provider Administration & Credential Lifecycle; M7 Autonomous Software Project Factory; M8 first factory-generated Chat with Your PDFs app; M9 generate a second distinct app and complete multi-app/project acceptance; M10 security, release and nontechnical handover. Optional cross-account gateway moves to M11 and remains deferred.

**Implementation starting point:** M6 remains the first incomplete milestone. The live admin panel is deployed at `https://parmar-ai.thenewtongs.workers.dev/admin/brvin`. The next user-side actions are one-time provider approvals only: (1) update the existing BRVIN GitHub App permissions and set its installation to All repositories; (2) update the existing BRVIN Connect Cloudflare OAuth client scopes using the panel's Copy button, preserving its callback URL and authorization-code/refresh-token grants, then click Authorize once. After those approvals, run Verify provider access and continue implementing token provisioning and direct secret delivery. Do not ask the user to create an API token, Worker, repository secret or test-client Worker manually.

**Files changed by this documentation proposal:** docs/BRVIN_AUTONOMOUS_PROJECT_FACTORY.md (new), docs/BRVIN_2_MASTER_PLAN.md (revised goal, administrator experience, milestones, prompts and ledger), docs/BRVIN_SYSTEM_REFERENCE.md (as-built boundary and continuity pointer). The source commit/PR and checks are recorded when this documentation branch is reviewed and merged.


### Documentation release record — 5 November 2026

The autonomous Project Factory specification was merged through [PR #80](https://github.com/ashini-x/parmar-ai/pull/80) as commit `8fb34381aef72f510f512fa2b31e24376403171d`. Release Validation [#664](https://github.com/ashini-x/parmar-ai/actions/runs/42012212458) passed type-checking, unit tests, Node tests, and both Worker bundle validations. Production deployment and live-production verification were skipped because this was a documentation-only change. Exactly three documentation files changed; no production infrastructure was modified.


### Milestone log — 5 November 2026 — M6 provider-admin preflight deployed; text adapter retired

**Implementation PRs:** [PR #82](https://github.com/ashini-x/parmar-ai/pull/82) merged as `5ade1aede0a215166fb827a08f1fdaf84e303c22`; [PR #83](https://github.com/ashini-x/parmar-ai/pull/83) merged as `ceef8f17927b190a5bba71bce61732c7067e34a0`. The production main commit is `ceef8f17927b190a5bba71bce61732c7067e34a0`.

**Code delivered:** expanded GitHub App manifest permission set, Cloudflare Developer Platform/AI OAuth permission set including the catalogue-backed Account API Tokens Write scope (`account-api-tokens.write`), provider capability endpoint, GitHub app/installation links, live repository-selection and permission output, copyable Cloudflare scope list, preservation of the existing encrypted OAuth client, and removal of all fixed `brvin-test-client` registration/PR/deployment-verification/test-token functions, API routes, admin controls and tests. The generic BRVIN connector and private retrieval service remain.

**PR validation:** Release Validation [#673](https://github.com/ashini-x/parmar-ai/actions/runs/42020393642) passed type-check, Vitest, Node integration tests and both Worker bundle checks. Main push Release Validation [#675](https://github.com/ashini-x/parmar-ai/actions/runs/42020525691) passed all validation and production release gates. Production smoke and acceptance confirmed root and health endpoints, BRVIN Service Binding, Fatman retrieval and one authorised source. No rollback was needed.

**Production deployment evidence:** `brvin-service` deployment `5d1b649d-5041-4957-9c2c-09ad52f18b5d`, version `82e902c9-be00-47da-81fa-c4d879e58fcc`, 100% traffic. `parmar-ai` deployment `fdc896dd-d0cb-437d-8bbb-cf9491f49dea`, version `c6f4fd4f-00aa-42e0-af68-dc3af1b83144`, 100% traffic.

**One-time provider approvals still pending:** GitHub App permission expansion and installation repository selection All; Cloudflare OAuth re-consent. Live account inspection found one Cloudflare member with Super Administrator — All Privileges, so no new member role assignment or invitation is required. BRVIN's saved Cloudflare OAuth scope remains the prior `workers-scripts.edit offline_access` until re-consent is completed. The existing OAuth client secret remains encrypted in D1.

**Retired adapter and D1 cleanup:** AskMoina PR #385 closed without merging. AskMoina PR #386 merged as `6ed5b5f59f5d972dd3af8e832261ef7168206703`; Release Validation #1815 (run `42016305287`) passed. No `brvin-test-client` Worker was deployed. The fixed app and environment were revoked, the test project set inactive, the project grant revoked, stale PR metadata removed from the GitHub connection, and a `brvin_connection_events` audit record inserted. The sample Rain Gardens PDF remains ready but unassigned; it was not deleted.

**M6 remaining work:** implement actual API-token provisioning; scope and verify project-specific Cloudflare deployment tokens; write them directly to GitHub Actions repository/environment secrets or Worker secrets; test real create/deploy/rotation/revocation; finish the encrypted credential vault and provider audit lifecycle. Provider preflight is deployed but M6 is not complete.


### M6 OAuth correction — 5 November 2026

The first owner-run Cloudflare consent attempt returned `invalid_scope`: the self-managed BRVIN Connect OAuth client is not allowed to request `account_api_tokens:create`. This is an internal scope added to Cloudflare's own `cf` CLI OAuth catalog, not a generally requestable self-managed OAuth scope (Cloudflare Workers SDK PR [#15883](https://github.com/cloudflare/workers-sdk/pull/15883)). BRVIN no longer requests it and instead requests the catalogue-backed `account-api-tokens.write` permission. The subsequent consent attempts exposed another mismatch: the uploaded client-scope list omits `ai-search.metadata_read` and multiple other metadata/admin IDs which BRVIN had been requesting. The code now requests only the configured IDs and retains a separate capability gate for product-level Admin permissions. The uploaded list grants Workers Editor (`workers-scripts.edit`) but not Workers Admin (`workers-scripts.admin`). Cloudflare documents that Editor cannot create/delete Workers; product-level Admin is required. Account API Tokens Write is accepted by the account token-create API, but actual OAuth-backed token creation remains unverified until a dedicated test is run. No token has been created and no Cloudflare resource or credential was changed by this correction.


### M6 configured-scope reconciliation and production deployment — 5 November 2026

- The administrator-provided Cloudflare OAuth selection was compared with the live Cloudflare scope catalogue and BRVIN's requested IDs. BRVIN previously requested 13 IDs that were absent from the supplied client configuration: `ai-search.metadata_read`, `aig.metadata_read`, `d1.metadata_read`, `messaging.metadata_read`, `pages.metadata_read`, `queues.metadata_read`, `websearch.metadata_read`, `workers-kv-storage.metadata_read`, `workers-r2.metadata_read`, `workers-scripts.admin`, `workers-scripts.read`, `workers-scripts.write`, and `workers_ai.metadata_read`. They are no longer in the default authorization request. The supplied set includes `offline_access`, `account-api-tokens.write`, and `workers-scripts.edit`.
- `workers-scripts.admin` is tracked separately as a critical Project Factory capability. The supplied set grants Workers Editor (`workers-scripts.edit`), which can deploy/update existing Workers but cannot create/delete Workers. Cloudflare documents that product-level Workers Admin is required to create new Workers. The authorization flow does not request this unconfigured scope; the capability preflight now reports the blocker explicitly. If Cloudflare offers this scope for the existing self-managed OAuth client, it must be added and approved before M6 Worker creation can pass. If not, obtain approval for a supported alternative deployment authority/architecture.
- Cloudflare CLI-only `account_api_tokens:create` remains prohibited for this self-managed client. BRVIN requests Account API Tokens Write (`account-api-tokens.write`), which the account-token create API lists as an accepted permission. OAuth-backed token creation has not yet been exercised; no project token has been created.
- PR [#88](https://github.com/ashini-x/parmar-ai/pull/88) merged to `main` as `12a7f216387b483be669647df18c1e548baead79`. Release Validation [#683](https://github.com/ashini-x/parmar-ai/actions/runs/42038383649) passed typecheck, unit/integration tests, both Worker bundle builds, production deployment and smoke acceptance.
- Production acceptance artifact `13420620125` records both Workers at 100% traffic: `brvin-service` deployment `d2a63c37-3274-467a-8697-3a1ffa6f0c7d`, version `c22150a0-6aef-4a84-bcd7-ffa4d3d274bb`; `parmar-ai` deployment `0fa6e194-c1f6-4398-8dc6-1d037c9a1ec2`, version `83fe277d-c667-4e45-89a5-2364197fbf3d`. Root, health, private BRVIN Service Binding and Fatman retrieval smoke checks passed.
- The Cloudflare Workers Builds branch-preview check separately failed because the account has reached the Free-plan limit of 100 Durable Object namespaces (Cloudflare error 10067). This is an account preview quota limitation, not a source/test failure; the main production release deployed and passed. No paid-plan change or quota workaround was made.
- **Current M6 boundary:** the invalid-scope request mismatch is corrected and deployed. M6 is not complete: re-consent still needs to succeed, Workers Admin is not in the supplied configured scopes, account-token creation must be tested using the BRVIN OAuth credential, project-scoped token permissions/resource selectors must be verified, and direct GitHub Actions/Worker secret delivery, rotation and revocation remain outstanding.


### Product scope and milestone correction — 5 November 2026 — authoritative update

The user clarified that BRVIN's goal is to make teacher-specific digital brains reusable across multiple independently built applications. ChatGPT remains the software developer through its own GitHub/Cloudflare connections. BRVIN's product is knowledge administration, application/environment registration, connection handoff, live retrieval verification, knowledge grants/revocations, usage and operational oversight.

The former autonomous technical administrator/Project Factory scope is superseded. Do not continue its M6 provider credential lifecycle, M7 code-generation factory, M8 generated PDF chat app, or PR/CI/CD automation work as BRVIN requirements. The historical document remains in the repository with an explicit superseded warning.

The active final milestones are M6–M11 as defined in [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md). The first incomplete milestone is M6 — Admin workspace aligned to teacher knowledge operations. This is a scope/documentation decision; it does not claim any new runtime capability or production deployment.

