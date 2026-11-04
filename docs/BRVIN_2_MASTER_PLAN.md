# BRVIN 2 — Master Architecture, Implementation Plan and Continuity Tracker

**Document type:** Canonical project handover and implementation tracker  
**Project:** BRVIN 2 — Application Connectivity and Automated Provisioning  
**Owning repository:** `ashini-x/parmar-ai`  
**Reference test-client repository:** `ashini-x/askmoina-voice` (the BRVIN test client is a separate Worker in this repository, not the existing AskMoina Voice Worker)
**Created:** 4 November 2026  
**Planning baseline:** `main` at the current BRVIN 2 implementation baseline
**Overall implementation status:** M0–M4 complete at the scaffold/reference-consumer level. M4's independent `brvin-test-client` Worker is merged in `ashini-x/askmoina-voice` PR #381 as `bf8e5a1e9fe7f451ad31430143ab52aaf801214e`; its separate Wrangler config, tester-token gate, text retrieval UI, authorization/provenance contract tests and independent Worker dry-run are included. It intentionally has no BRVIN Service Binding, registered test app/environment, test-project grant or deployment yet. M5 application/project administration is now the first incomplete milestone; M6 will connect and deploy the test client after the identity and isolated grant are provisioned. Existing AskMoina Voice remains an optional pilot, not a BRVIN acceptance gate.

> **Read this document first when continuing BRVIN 2 in a new ChatGPT chat, Codex task, or work branch.** It contains the approved target architecture, the implementation sequence, progress ledger, acceptance rules and copy-ready milestone instructions. Do not ask the user to repeat the architecture.

---

## 1. Project vision

Turn BRVIN into a shared, application-aware knowledge platform where an administrator connects an application once and can subsequently create many independent knowledge projects, upload books, organise collections, assign access, test retrieval and activate projects from the BRVIN admin dashboard.

The key user promise is:

> Connect an application once. After that, manage its projects and knowledge from BRVIN without recurring code changes, API-key handling or Wrangler edits.

This is an automation and administration project, not a rebuild of the existing PDF/OCR/AI Search pipeline.

AskMoina Voice is the first integrated pilot, but it is not a dependency for completing BRVIN 2. The controlled acceptance client is a separate text-only Worker in the `askmoina-voice` repository. It exercises the same private v2 connector and Service Binding without changing the existing voice Worker, Gemini Live sessions, camera, audio or conversation state.

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

### 4.1 First-time setup — connect application (once)

For a supported same-account Cloudflare Worker application:

1. Admin opens BRVIN and selects **Connect Application**.
2. Admin explicitly authorises GitHub.
3. Admin selects the target repository and branch.
4. Admin explicitly authorises Cloudflare.
5. Wizard discovers the account and Worker and confirms it is in the same Cloudflare account as private BRVIN.
6. Admin selects production/preview environment(s).
7. BRVIN generates an application and trusted environment identity.
8. Wizard prepares the Service Binding and installs/references the standard BRVIN connector.
9. Wizard prepares the supported application-side retrieval/tool-handler changes.
10. Wizard creates a GitHub pull request and runs checks.
11. Admin reviews and approves the changes.
12. The application's existing deployment pipeline deploys it.
13. BRVIN verifies the live connection and shows readiness.

This first-time step may require a technical engineer for an unsupported custom application architecture. Never claim arbitrary code can always be auto-integrated. Never silently merge/deploy to production. Avoid asking administrators to paste API tokens into source files, chat, or dashboard fields.

### 4.2 Every subsequent project — no application code changes

1. Admin clicks **Create Project**.
2. Enters project name and description.
3. Selects an already-connected application.
4. BRVIN creates UUID, slug, project row and application-project permission.
5. Admin uploads PDF(s), chooses/creates collection(s), and assigns direct or collection access.
6. Existing ingestion pipeline performs upload, OCR, indexing and QA.
7. BRVIN marks source/project ready only after required readiness conditions.
8. Admin runs **Test Knowledge** with a representative query.
9. Admin sees retrieved passages, source titles and PDF page references.
10. Admin activates the project.

No new Service Binding, Wrangler edit, GitHub PR or application redeployment should be required just to add another project.

### 4.3 End-user experience

The end user does not need to know BRVIN exists and does not upload the same knowledge again.

The consumer application selects the applicable project using its own authenticated user/workspace context. It calls BRVIN server-side. BRVIN checks the caller and app-project permission, retrieves only authorised knowledge, and returns evidence/provenance. The consumer's model constructs and delivers the final answer.

For multi-tenant apps, mapping an authenticated app workspace/customer to a BRVIN project belongs to the consumer app's trusted server-side context. Never trust a raw project ID from an unauthenticated browser.

## 5. Implementation milestones and completion gates

### Milestone 0 design package

The architecture freeze deliverables are maintained in two reviewable documents:

- [BRVIN 2 Architecture Decision Record](BRVIN_2_ARCHITECTURE_DECISIONS.md) — exact additive D1 schema, identity trust model, migration seed, compatibility/rollback plan, AskMoina integration, admin/wizard design and acceptance checklist.
- [BRVIN 2 Private Retrieval RPC v2 Contract](BRVIN_2_RPC_V2_CONTRACT.md) — trusted binding identity, v2 methods/types, authorisation sequence, exact-page behavior, structured failures, quotas and tests.

These design documents have been implemented in M1–M3. The v1 references remain authoritative for existing Fatman retrieval, while v2 is deployed and used by the M4 AskMoina integration.


Milestones change status only after implementation and evidence. A commit alone is not completion. Each completed milestone records PR/commit, changed areas, tests, deployment status, acceptance evidence and remaining risks.

| Milestone | Name | Initial status | Completion outcome |
|---|---|---|---|
| 0 | Architecture freeze and migration blueprint | COMPLETE | M0 design package merged to `main` in PR #61; original docs-only PR #60 closed as superseded |
| 1 | Multi-application, multi-project identity | COMPLETE | PR #61 merged; Release Validation #586 passed; additive registry migration applied and production rows/FK check verified; v1/Fatman preserved |
| 2 | Private retrieval API v2 | COMPLETE | PR #62 merged as `3b68aaecf3c78c712e1a1c978285ad1f166d15c4`; Release Validation #596 passed; production v2 health parity and Fatman identity/data verified |
| 3 | Reusable BRVIN application connector | COMPLETE | PR #63 merged to main as `91b6a499bd782ae298b41e790157c23682f10881`; Release Validation #608 passed all checks and Cloudflare Preview build succeeded |
| 4 | Independent BRVIN text reference consumer | COMPLETE — scaffold and CI validated; binding/deployment deferred | AskMoina PR #381 merged as `bf8e5a1e9fe7f451ad31430143ab52aaf801214e`; Worker `brvin-test-client` has isolated Wrangler/TypeScript configs, token gate, text UI, v2 connector handler, authorization/provenance tests and separate dry-run. No Service Binding, registered test identity/grant or deployment yet; those are M5/M6 prerequisites for M7 live tests |
| 5 | BRVIN application/project administration | NOT STARTED | Admin can manage apps, projects, grants and knowledge centrally |
| 6 | Automated Connect Application wizard | NOT STARTED | Supported app can be onboarded through reviewed GitHub/Cloudflare workflow |
| 7 | End-to-end administrator and user acceptance | NOT STARTED | Full multi-app/multi-project and negative permission tests pass |
| 8 | Release completion and administrator handover | NOT STARTED | Production evidence, final docs and non-technical admin manual; declare completion |

Optional later expansion:
- **Milestone 9 — Cross-account gateway:** authenticated HTTPS gateway for Workers in other Cloudflare accounts or approved external backends. Keep the internal retrieval service private. This is not part of the first BRVIN 2 delivery unless explicitly reprioritised.

### Milestone 0 — Architecture freeze and migration blueprint

Deliverables:
- Architecture Decision Record (ADR) for application, environment/client identity, project and app-project grant model.
- Exact D1 table/column/constraint/index design.
- Current-to-target migration map, including legacy Fatman clients.
- RPC v2 input/output/failure contract.
- Service Binding identity and project-selection trust model.
- Safe compatibility rollout and rollback plan.
- AskMoina integration design.
- Admin and GitHub/Cloudflare wizard design.
- Detailed acceptance checklist.

Boundary: documentation/design only. Do not migrate D1 or modify production Worker infrastructure in this milestone.

### Milestone 1 — Multi-application, multi-project identity

Implement the approved D1 schema and safe migration. Support multiple applications, multiple environment identities per app, multiple projects per app, one project shared with multiple explicitly authorised apps, and application/project activation/revocation. Preserve existing Fatman identity and usage/data. Add migration and compatibility tests. Do not yet change consumer retrieval behavior.

### Milestone 2 — Private retrieval API v2

Implement trusted application resolution and project-level authorisation in the private service. Project ID is a requested scope, never an authorisation credential. Validate application, environment, project and app-project grant on each retrieval. Resolve only ready fully indexed sources with direct/collection grants; filter search by D1 prefixes and validate returned keys. Implement status/project discovery if approved, retrieval, exact page retrieval, quotas and structured failures. Keep legacy Fatman path until consumers migrate. No public route.

### Milestone 3 — Reusable connector

Create the standard typed server-side adapter in a maintainable package/module distribution approach selected after inspecting both repos. Include connection status, accessible project discovery if approved, project readiness, semantic/exact-page retrieval, provenance formatting, optional page image handling, error/retry classification, timeout/size limits and correlation logging. Provide sample integration and tests. Never unrestricted-search fallback.

### Milestone 4 — Independent BRVIN text reference consumer

**Status: COMPLETE — independent reference Worker scaffold merged and validated; live BRVIN connection intentionally deferred to M5/M6.**

The purpose of M4 is to deliver a small, deterministic text-first reference consumer for the frozen BRVIN v2 architecture—not to make the existing AskMoina Voice application pass unrelated voice/video acceptance suites.

Implemented in `ashini-x/askmoina-voice` PR #381, merged to `main` as `bf8e5a1e9fe7f451ad31430143ab52aaf801214e`:
- Worker: `brvin-test-client`, separate from the production `askmoina-voice` Worker.
- Config: `wrangler.brvin-test-client.jsonc`; entrypoint: `workers/brvin-test-client/src/index.ts`.
- Isolated TypeScript project: `tsconfig.brvin-test-client.json`.
- Mobile-friendly text interface: authorised project selector, question or exact PDF page, grounded passage display and physical-page citation.
- Every API route requires `BRVIN_TEST_ACCESS_TOKEN`; it is a tester access gate, not a BRVIN application identity or retrieval credential.
- Server-side connector uses v2 `listAuthorizedProjectsV2`, `getProjectStatusV2` and `retrieveProjectContextV2`; project IDs are selectors only and are checked against live authorised-project discovery plus service-side grants.
- Test coverage includes the tester token, unconnected state, authorized project discovery, ungranted-project denial, exact page, readiness, retrieval citations and cross-origin rejection.
- Release Validation type-checks the isolated Worker and performs an independent Wrangler dry-run. The merged PR also added path exclusions so text-client-only work does not deploy or run the existing AskMoina Voice production health/voice-synthetic workflows.

**Connection boundary:** The test Worker is deliberately *not deployed or connected yet*. `wrangler.brvin-test-client.jsonc` requires a tester token and has no `BRVIN_SERVICE` Service Binding or `props.applicationEnvironmentId`. M5 must first create its distinct BRVIN application, environment, isolated test project and explicit app-project grant through the protected admin workflow. M6 then adds the trusted Service Binding and approved deployment/connection workflow. Do not borrow AskMoina Voice's production environment ID, choose Fatman as the test project's default, create ad-hoc production D1 rows, or invent an environment UUID.

**M4 acceptance evidence:** PR #381 is merged; its Release Validation passed `npm run check`, the isolated Worker type-check, `npm test` (including the new reference-client tests), and separate Wrangler dry-run. No Worker deployment or production D1 mutation was performed. The later live retrieval, revocation and multi-app acceptance belongs to M7 after M5/M6.

The existing AskMoina Voice BRVIN/Gemini Live integration remains an optional pilot/second consumer. Its camera/audio/session-continuity/latency outcomes are informational only and are not a BRVIN milestone gate.
### Milestone 5 — Application and project administration

Upgrade the protected BRVIN dashboard with application registry/connection health, environment identities, activate/revoke, authorised project list; project create/edit/activate/deactivate and app association; knowledge library; collections; direct and collection grants; readiness and retrieval-test flows. Generate IDs automatically. Keep admin mobile-friendly and understandable to a nontechnical operator. Preserve current Fatman workflow.

### Milestone 6 — Automated Connect Application wizard

Implement explicit GitHub and Cloudflare authorisation, repository/branch and Worker/environment discovery, same-account check, generated app/environment identity, Service Binding config, connector/tool-handler template changes, tests, GitHub PR and admin approval. Run standard checks and connection test; let normal deployment pipeline deploy; verify live connection. Least privilege, secure credential handling, no tokens in source, no silent production branch push/deploy. Support only known adapter templates initially and clearly report unsupported architectures. After this first connection, additional projects must not create PRs or deployments.

### Milestone 7 — End-to-end acceptance

Test at minimum:
1. Use the independent BRVIN text test Worker as the first controlled consumer.
2. Connect a synthetic second application through the automated wizard; existing AskMoina Voice is an optional pilot, not a prerequisite.
3. One app with multiple projects.
4. One project deliberately shared across multiple apps.
4. Multiple PDFs and collections.
5. Direct and collection grants.
6. Readiness and page-level citations.
7. App A denied Project B until explicitly granted.
8. Revocation and deactivation applied to future retrieval.
9. Unknown identities and malformed project IDs.
10. Quotas, service outage and recovery.
11. Fatman original flow and quota history remain intact.
12. New projects can be created and populated without code/Wrangler changes.
13. Full text question-to-grounded-answer path through the reference test Worker.
14. Optional AskMoina Voice pilot remains compatible without requiring camera/audio-specific acceptance.

Capture synthetic test evidence, production Worker versions, commit/source revision and acceptance manifest.

### Milestone 8 — Final release and handover

Audit repo/infrastructure against approved ADR. Verify all milestones and tests. Confirm no public exposure, secret leakage, broken Fatman behavior or undocumented configuration. Publish nontechnical admin manual for connect application, project creation, PDF upload, collections, knowledge tests, access activation/revocation and troubleshooting. Record final release versions and limitations. Do not declare BRVIN 2 complete if the user journey only exists as code without end-to-end proof.

## 6. Copy-ready prompts for each milestone

Use these prompts verbatim (or ask ChatGPT to read the corresponding milestone in this file and execute it). The project name and requirements are already in this document; the user should not have to explain them again.

### Prompt to start a new chat / branch

~~~text
Continue BRVIN 2 from the GitHub source of truth:
https://github.com/ashini-x/parmar-ai/blob/main/docs/BRVIN_2_MASTER_PLAN.md

First read that master plan and all linked BRVIN references. Inspect the latest main/feature branch and current code/infrastructure to determine the actual progress; do not rely only on a previous chat summary.

Read the progress ledger and identify the first milestone that is not fully complete. Tell me briefly what the tracker says and what repository evidence confirms it. Then execute only that milestone, following its scope and acceptance criteria.

Use the existing BRVIN architecture and protect Fatman production. Work in a feature branch and PR, update this master plan's progress ledger and all affected docs as part of the work, run tests and verify actual behavior. Do not ask me to repeat the architecture. Do not move to the next milestone until this one is completed and reported with commit/PR, tests, deployment state and remaining issues.
~~~

### Milestone 0 prompt

~~~text
Execute BRVIN 2 Milestone 0 from docs/BRVIN_2_MASTER_PLAN.md. This is architecture freeze and migration blueprint only: inspect current code and infrastructure, produce the complete ADR, exact D1 data model, RPC v2 contract, application/environment trust model, legacy Fatman migration/backward compatibility, AskMoina integration design, admin wizard design, rollout/rollback plan and acceptance criteria. Do not change application code, D1 production schema or Cloudflare infrastructure. Update the master plan with evidence and commit the documentation.
~~~

### Milestone 1 prompt

~~~text
Execute BRVIN 2 Milestone 1 from docs/BRVIN_2_MASTER_PLAN.md using the approved Milestone 0 ADR. Implement the multi-application/multi-environment/multi-project D1 identity and authorisation model with safe migrations. Preserve Fatman data, identity, permissions and usage accounting. Add migration, idempotency, uniqueness, revocation and backward-compatibility tests. Do not switch consumers to RPC v2 yet. Update docs and tracker; verify tests and report the commit/PR.
~~~

### Milestone 2 prompt

~~~text
Execute BRVIN 2 Milestone 2 from docs/BRVIN_2_MASTER_PLAN.md. Implement the private BRVIN retrieval RPC v2 with trusted application identity, explicit project authorisation on every call, project status/discovery as specified by the ADR, scoped source resolution, filtered AI Search and post-retrieval key validation, exact-page retrieval, quotas and structured errors. Keep brvin-service private and maintain the Fatman compatibility path. Add comprehensive authorised/unauthorised tests. Update API docs and tracker; do not migrate AskMoina yet.
~~~

### Milestone 3 prompt

~~~text
Execute BRVIN 2 Milestone 3 from docs/BRVIN_2_MASTER_PLAN.md. Build and test the reusable typed server-side BRVIN connector, select an appropriate reusable package/module distribution method after inspecting both repos, provide an integration example and consistent status, retrieval, provenance, page-image and failure handling. No unrestricted fallback. Update docs/tracker and report tests/commit.
~~~

### Milestone 4 prompt

~~~text
Execute BRVIN 2 Milestone 4 from docs/BRVIN_2_MASTER_PLAN.md. Integrate AskMoina Voice as the first additional BRVIN application using production/preview identities, the private Service Binding and the reusable connector. Add a Gemini Live knowledge-search function tool and route it through the existing server-side handler. Preserve Gemini answer generation, D1, user auth and voice/video continuity. Test real question-to-retrieval-to-spoken-answer, page citations, denied/revoked projects, no-result, quota and outages. Verify the deployed app, update the tracker/docs and report evidence.
~~~

### Milestone 5 prompt

~~~text
Execute BRVIN 2 Milestone 5 from docs/BRVIN_2_MASTER_PLAN.md. Implement the application-aware BRVIN administration experience for applications, environments, connection health, projects, project permissions, collections, books, indexing readiness, test-knowledge and activation/revocation. Project IDs/slugs must remain automatic. Use the existing ingestion pipeline. Make it clear and usable for a nontechnical administrator. Preserve Fatman. Add tests, update docs/tracker and report evidence.
~~~

### Milestone 6 prompt

~~~text
Execute BRVIN 2 Milestone 6 from docs/BRVIN_2_MASTER_PLAN.md. Implement the Connect Application wizard with explicit GitHub and Cloudflare authorisation, repository/branch/Worker/environment discovery, same-account verification, generated identity/binding/adapter changes, tested GitHub PR, admin approval and post-deploy connection verification. Use least privilege; do not store tokens in source or silently modify/deploy production. Be honest about unsupported app architectures. Prove that after the initial connection, additional projects require no PR or Wrangler changes. Update tracker/docs and test the wizard.
~~~

### Milestone 7 prompt

~~~text
Execute BRVIN 2 Milestone 7 from docs/BRVIN_2_MASTER_PLAN.md. Run the complete synthetic end-to-end acceptance for multiple apps, multiple projects, shared-project permissions, PDF/collection ingestion, direct/collection grants, page citations, denied/revoked/deactivated access, quotas, outage/recovery and preserved Fatman operation. Verify a new project can be added with no code/Wrangler change. Capture test and production evidence, deployed versions and release manifest. Fix failures before marking complete. Update tracker/docs.
~~~

### Milestone 8 prompt

~~~text
Execute BRVIN 2 Milestone 8 from docs/BRVIN_2_MASTER_PLAN.md. Conduct the final code, database, Cloudflare and GitHub Actions audit against the approved ADR. Verify every milestone and acceptance gate, production behavior, Fatman compatibility, app onboarding, repeat project creation, permissions, secrets and rollback. Finalise the nontechnical admin manual and all docs. Record exact source revision, deployment versions and test evidence. Declare BRVIN 2 complete only if the end-to-end system works in production; otherwise mark remaining blockers clearly in the tracker.
~~~

### Optional Milestone 9 prompt

~~~text
Execute optional BRVIN 2 Milestone 9 from docs/BRVIN_2_MASTER_PLAN.md only after Milestones 0–8 are complete or explicitly reprioritised. Design and implement a separate authenticated HTTPS gateway for applications outside the BRVIN Cloudflare account. Keep brvin-service private. Include high-entropy per-project/application credentials, hashed storage, rotation/revocation, validation, rate limits, usage controls, audit trail, abuse protection and complete cross-account tests. Do not weaken same-account Service Binding security.
~~~

## 7. Progress ledger — update after every milestone

This table is the human-readable status. The evidence fields must be filled from actual GitHub/Cloudflare/test results, not assumptions.

| Milestone | Status | PR / commit | Verification evidence | Notes |
|---|---|---|---|---|
| 0 — Architecture freeze | COMPLETE | [PR #61](https://github.com/ashini-x/parmar-ai/pull/61) merged as `5735314b3e692019c34ba3d2a0d851cbb6c43aa3` | ADR and RPC v2 contract merged to main; Release Validation #586 passed for the combined code/docs PR | Original docs-only PR #60 closed as superseded |
| 1 — Identity model | COMPLETE | [PR #61](https://github.com/ashini-x/parmar-ai/pull/61), merge commit `5735314b3e692019c34ba3d2a0d851cbb6c43aa3` | Release Validation #586 passed; production migration marker and all three seed rows verified; foreign-key check empty; both Workers active on new versions | No v1 RPC or Fatman permissions/counter reset |
| 2 — Private RPC v2 | COMPLETE | [PR #62](https://github.com/ashini-x/parmar-ai/pull/62), merge commit `3b68aaecf3c78c712e1a1c978285ad1f166d15c4` | Release Validation #596 passed; production environment-bound methods deployed; v1 Fatman path/usage unchanged | Private Service Binding only; no public retrieval route |
| 3 — Reusable connector | COMPLETE | [PR #63](https://github.com/ashini-x/parmar-ai/pull/63), merge commit `91b6a499bd782ae298b41e790157c23682f10881` | Release Validation #608 passed; Cloudflare Preview build `a4c154e3-c056-489a-9b14-8ebac9ed9c0d` succeeded | Connector vendored by AskMoina PR #370 |
| 4 — AskMoina integration | IN PROGRESS — deployed, final production acceptance pending | [BRVIN PR #65](https://github.com/ashini-x/parmar-ai/pull/65), merge `0b3c621b83a28de2f4ca5da95db349b364558a60`; [AskMoina PR #370](https://github.com/ashini-x/askmoina-voice/pull/370), merge `ce725d33df452de0e9df2f4613c70ec89592251e`; acceptance harness PRs #372, #373, #377, #378, [#379](https://github.com/ashini-x/askmoina-voice/pull/379), latest merge `0840af352a1e9ab03bfd36a39b691bb6068af55b` | Production Worker version `6b6b5a56-24b3-4b74-ad0c-1a47c78df784` is deployed at 100%; release validation #1787 passed; health/routes/PWA checks passed; exact-page retrieval, three grounded searches, spoken card, ranked list, spoken memory, browser recovery, >170-second continuity and history/memory APIs passed in run #647. Run #647 failed only two synthetic terminal-state checks (camera and 20-turn audio benchmark; 120,000 bytes/21 messages observed). PR #379 corrects the tests to use `generationComplete`/`turnComplete` and explicitly close finite audio input; full production run #648 is in progress and remains the gate | Fatman project allowance remains shared; AskMoina Preview intentionally has no BRVIN binding |
| 5 — Admin experience | NOT STARTED | — | — | Application/project/knowledge UI |
| 6 — Connect wizard | NOT STARTED | — | — | GitHub/Cloudflare + PR automation |
| 7 — E2E acceptance | NOT STARTED | — | — | Full synthetic journey |
| 8 — Release/handover | NOT STARTED | — | — | Final admin manual and release evidence |
| 9 — External gateway (optional) | DEFERRED | — | — | Separate cross-account expansion |

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

At the start of every new session:

1. Open this master plan from GitHub.
2. Open [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) to understand the audited current architecture.
3. Open [BRVIN_PRIVATE_RETRIEVAL_API.md](BRVIN_PRIVATE_RETRIEVAL_API.md), [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md) and [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md) as relevant.
4. Inspect current repo branches, latest commits, PRs, workflow runs and live Cloudflare state when the next task depends on them.
5. Compare actual progress to the ledger. Correct the ledger if evidence disagrees.
6. Resume from the first incomplete milestone. Do not redo finished work or skip unfinished prerequisites.
7. Work only on the milestone requested/next in sequence unless the user explicitly changes priority.
8. Update this tracker and related docs before closing each milestone.

### Repository and infrastructure safety

- Do not deploy or modify production infrastructure during Milestone 0.
- Use a feature branch and PR for implementation.
- Do not overwrite a concurrent branch or skip reviewing latest main.
- Do not commit credentials, private keys, access tokens, production student data or raw OCR/PDF payloads.
- Preserve the current paired deployment and rollback controls.
- Keep `brvin-service` private.
- Never let a project selector bypass application-project authorisation.
- Preserve Fatman's current user-facing flow and usage history.
- Do not claim an unverified deployment or test result.

## 9. Completion definition

BRVIN 2 is complete only when a nontechnical administrator can:

1. connect a supported app once through the wizard;
2. create a new project under that connected application;
3. upload and organise knowledge;
4. assign direct/collection permissions;
5. wait for processing and readiness;
6. test relevant questions and see source/page evidence;
7. activate or revoke access;
8. repeat this for additional projects without recurring code, Wrangler, GitHub PR or application deployment changes.

And when the connected end-user application can retrieve only its authorised project's content and generate a correct answer using its own model.

**The finish line is a working administrator-operated product, not a collection of merged code changes.**



### Milestone log — 5 November 2026 — acceptance target correction

**User direction:** Stop treating the existing AskMoina Voice application as the product BRVIN must repair. BRVIN is the product; the existing AskMoina voice app is only an optional consumer/pilot. The first controlled architecture test will be a separate, text-only Worker housed in the `askmoina-voice` repository.

**What has already shipped:** The AskMoina voice integration (PR #370) and its acceptance-harness changes exist on production. AskMoina PR #380 (merge commit `ffa145b970b929f996b12a09fd94033567806319`) changes only acceptance scripts/CI to follow Gemini Live turn boundaries. Release Validation on the merged head passed. It did not add a new consumer-facing voice feature. A production workflow triggered by that merge may finish, but its camera/audio/latency outcome is informational and does not gate BRVIN M4. Do not start more voice-specific acceptance runs or alter the production voice runtime for BRVIN.

**M4 implementation delivered:** A separate Worker named `brvin-test-client` in `ashini-x/askmoina-voice`, with config `wrangler.brvin-test-client.jsonc`, entrypoint `workers/brvin-test-client/src/index.ts`, isolated TypeScript config `tsconfig.brvin-test-client.json`, text interface and server-side connector handler. It lists only projects returned for its future trusted identity, accepts a text query/exact page and displays source citations. It does not share the existing voice Worker's runtime or production state.

**Identity/data safety:** The test Worker needs a distinct `brvin_applications` row, environment identity, app-project grant and dedicated test project/source. Never borrow AskMoina's production environment ID as a new app identity; never default the test client to Fatman or hard-code a fabricated identity. Use the M5 protected admin lifecycle to create these records and grant the test project. Before that is available, build the test Worker against mocked connector contracts and validate locally. No production D1 mutation is authorised by this plan note.

**Sequence:** M4 scaffold is complete. (1) M5: implement application/project administration, including test app/environment/project/grant lifecycle; (2) M6: use Connect Application to add the generated environment ID as trusted Service Binding props and deploy/connect the test Worker with a separate test access token; (3) M7: verify real retrieval/citations, app isolation, denial/revocation and future-project automation. The existing AskMoina voice app is not a dependency for these steps.


### Milestone log — 5 November 2026 — M4 reference Worker scaffold delivered

**Implementation:** AskMoina PR #381, “M4: add isolated text-first BRVIN test client Worker”, merged to main as `bf8e5a1e9fe7f451ad31430143ab52aaf801214e`. It adds an independent `brvin-test-client` Worker with `wrangler.brvin-test-client.jsonc`, `workers/brvin-test-client/src/index.ts`, `tsconfig.brvin-test-client.json`, a text retrieval UI and its dedicated tests.

**Security and isolation:** All API routes require the `BRVIN_TEST_ACCESS_TOKEN` secret. The Service Binding and `applicationEnvironmentId` remain absent by design; the browser cannot select an application identity. The Worker has no AskMoina D1, Durable Object, queue or Gemini bindings. It is not deployed. Existing voice-worker production deploy, production-health and voice-synthetic workflows ignore test-client-only changes.

**Validation:** The merged PR's Release Validation includes the separate Worker type-check, full existing `npm test`, and a separate Wrangler dry-run for `wrangler.brvin-test-client.jsonc`. The PR was merged after its validation passed. The test client contract covers token authentication, only-authorized project discovery, pre-retrieval denial for other projects, readiness, exact physical page, retrieval citations, cross-origin denial and no-binding behavior.

**M4 completion boundary:** This completes the independent reference-client scaffold, not live connectivity. No Service Binding, app/environment D1 row, test-project grant, secret deployment or Worker deployment was done. M5 must provide protected admin lifecycle for those records; M6 connects and deploys; M7 performs live acceptance. Do not resume AskMoina camera/audio/latency production test cycles as BRVIN blockers.
