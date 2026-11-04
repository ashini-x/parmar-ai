# BRVIN 2 — Master Architecture, Implementation Plan and Continuity Tracker

**Document type:** Canonical project handover and implementation tracker  
**Project:** BRVIN 2 — Application Connectivity and Automated Provisioning  
**Owning repository:** `ashini-x/parmar-ai`  
**First additional consumer:** `ashini-x/askmoina-voice`  
**Created:** 4 November 2026  
**Planning baseline:** `main` at `939a6046f2a6fa461898f2479e6ed22923e3f3f9`  
**Overall implementation status:** Milestone 0 design package READY FOR REVIEW in PR #60; runtime implementation NOT STARTED

> **Read this document first when continuing BRVIN 2 in a new ChatGPT chat, Codex task, or work branch.** It contains the approved target architecture, the implementation sequence, progress ledger, acceptance rules and copy-ready milestone instructions. Do not ask the user to repeat the architecture.

---

## 1. Project vision

Turn BRVIN into a shared, application-aware knowledge platform where an administrator connects an application once and can subsequently create many independent knowledge projects, upload books, organise collections, assign access, test retrieval and activate projects from the BRVIN admin dashboard.

The key user promise is:

> Connect an application once. After that, manage its projects and knowledge from BRVIN without recurring code changes, API-key handling or Wrangler edits.

This is an automation and administration project, not a rebuild of the existing PDF/OCR/AI Search pipeline.

The first additional real consumer is AskMoina Voice. Its existing Gemini Live model/function-call architecture should consume BRVIN evidence while retaining responsibility for answer generation, voice/video sessions and conversation state.

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

These are the proposed Milestone 0 design. They are not implemented runtime behavior. The current v1 references remain authoritative for production until Milestones 1–2 are implemented and verified.


All milestones initially start as **NOT STARTED**. Change a status only after implementation and evidence. A commit alone is not completion. Each completed milestone must record PR/commit, changed areas, tests, deployment status, acceptance evidence and remaining risks.

| Milestone | Name | Initial status | Completion outcome |
|---|---|---|---|
| 0 | Architecture freeze and migration blueprint | NOT STARTED | Approved ADR, D1 design, RPC v2 contract and backwards-compatible rollout sequence |
| 1 | Multi-application, multi-project identity | NOT STARTED | D1 application/environment/project permissions migrated; Fatman compatibility retained |
| 2 | Private retrieval API v2 | NOT STARTED | Trusted app identity and explicit per-project authorisation enforced on every retrieval |
| 3 | Reusable BRVIN application connector | NOT STARTED | Typed reusable app-side adapter and tests |
| 4 | AskMoina Voice integration | NOT STARTED | Real Gemini Live tool-to-BRVIN-to-answer flow verified |
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

### Milestone 4 — AskMoina Voice integration

Register AskMoina app + production/preview trusted identities. Add private Service Binding and reusable connector. Add a Gemini Live BRVIN search function tool and server-side handler. Select a project from trusted app/user/workspace context, call BRVIN, and return concise passages with book title/PDF page to Gemini Live. Preserve AskMoina's own D1, auth, voice/video/session continuity and final answer generation. Test audio/camera, page-specific, no-result, denied/revoked grants, quota and outage. Do not rewrite the app.

### Milestone 5 — Application and project administration

Upgrade the protected BRVIN dashboard with application registry/connection health, environment identities, activate/revoke, authorised project list; project create/edit/activate/deactivate and app association; knowledge library; collections; direct and collection grants; readiness and retrieval-test flows. Generate IDs automatically. Keep admin mobile-friendly and understandable to a nontechnical operator. Preserve current Fatman workflow.

### Milestone 6 — Automated Connect Application wizard

Implement explicit GitHub and Cloudflare authorisation, repository/branch and Worker/environment discovery, same-account check, generated app/environment identity, Service Binding config, connector/tool-handler template changes, tests, GitHub PR and admin approval. Run standard checks and connection test; let normal deployment pipeline deploy; verify live connection. Least privilege, secure credential handling, no tokens in source, no silent production branch push/deploy. Support only known adapter templates initially and clearly report unsupported architectures. After this first connection, additional projects must not create PRs or deployments.

### Milestone 7 — End-to-end acceptance

Test at minimum:
1. Connect AskMoina and a synthetic second app.
2. One app with multiple projects.
3. One project deliberately shared across multiple apps.
4. Multiple PDFs and collections.
5. Direct and collection grants.
6. Readiness and page-level citations.
7. App A denied Project B until explicitly granted.
8. Revocation and deactivation applied to future retrieval.
9. Unknown identities and malformed project IDs.
10. Quotas, service outage and recovery.
11. Fatman original flow and quota history remain intact.
12. New projects can be created and populated without code/Wrangler changes.
13. Full end-user question-to-answer for AskMoina.

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
| 0 — Architecture freeze | READY FOR REVIEW | [PR #60](https://github.com/ashini-x/parmar-ai/pull/60), head `571857252c84f132fecb6bb98b81828a58c9a1df` | ADR and RPC v2 contract added; current D1/code/Cloudflare state reconciled; no runtime or production writes | Awaiting review/merge; design only, not implementation |
| 1 — Identity model | NOT STARTED | — | — | Must preserve Fatman |
| 2 — Private RPC v2 | NOT STARTED | — | — | Must remain private |
| 3 — Reusable connector | NOT STARTED | — | — | Standard app-side adapter |
| 4 — AskMoina integration | NOT STARTED | — | — | First additional live consumer |
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

**Status:** READY FOR REVIEW (not marked complete until the design PR is reviewed and merged).  
**Branch:** `brvin-2/m0-architecture-freeze`  
**Pull request:** https://github.com/ashini-x/parmar-ai/pull/60  
**PR head:** `571857252c84f132fecb6bb98b81828a58c9a1df`  
**Base audited:** `main` at `a16a9273d581d9dd5acfc3c53c3cc1f2cba819fd`

**Paths changed:**
- `docs/BRVIN_2_ARCHITECTURE_DECISIONS.md` — ADR, target D1 DDL and constraints, identity trust model, Fatman migration seed, compatibility rollout/rollback, AskMoina integration, admin/wizard design and acceptance checks.
- `docs/BRVIN_2_RPC_V2_CONTRACT.md` — private v2 methods, types, request validation, authorisation order, quota and failure semantics, exact-page contract and test matrix.
- `docs/BRVIN_SYSTEM_REFERENCE.md` — links to the BRVIN 2 design while preserving its as-built boundary.
- `docs/BRVIN_INTEGRATION_GUIDE.md` — labels existing instructions as v1 and prevents premature v2 production configuration.
- `docs/BRVIN_2_MASTER_PLAN.md` — this ledger and continuity record.

**D1 migration:** none. Read-only inspection only. The live database showed the existing Fatman project/client mapping, the existing Fatman and Rain Gardens books, existing project grants, and 20 queries recorded for the 2026-11 billing month in Fatman usage. No tables, rows, grants, source records or usage counters were written or changed.

**Cloudflare:** no configuration, binding, secret, Worker, Workflow, D1, GCS or AI Search changes. Read-only inspection confirmed the current `parmar-ai` and `brvin-service` Workers, their shared D1 binding and shared `default` AI Search instance. `brvin-service` remains configured with `workers_dev: false`; the current caller still uses `props.clientId: "fatman"`. AskMoina production has its own D1 and no BRVIN Service Binding. Observed active deployment version IDs at audit time: `parmar-ai` `56cdd777-7f48-4c63-869d-4d18a2de3e9b`; `brvin-service` `1a533c1c-a1e4-4994-9eaa-0dfb0fee0cf1`; AskMoina Voice `abee86c2-8a80-47f3-87f5-eb92a60cc2d8`. These are baseline observations, not deployments from this PR.

**Verification performed:** inspected current `main`, recent commits and PR state; compared the four-commit BRVIN 2 planning delta; read the BRVIN system, private API, integration and operations references; inspected D1 table/index definitions and relevant rows; inspected both BRVIN Worker code paths and Wrangler configs; inspected AskMoina Wrangler/D1/Worker binding state; inspected live Worker settings/deployment versions and AI Search instance/statistics. The design was cross-checked against those facts. No application tests were run because this PR changes documentation only. No synthetic or production acceptance was claimed.

**Deployment / rollback:** no deployment was attempted, so no rollback was required. Existing paired release workflow is unchanged.

**Outstanding gate / next milestone:** review and merge PR #60. After that, begin Milestone 1 from the approved ADR with additive schema/migration tests only; keep v1 retrieval behavior and production binding unchanged.

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
