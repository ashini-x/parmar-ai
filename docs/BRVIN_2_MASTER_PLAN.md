# BRVIN — Master Architecture, Implementation Plan and Continuity Tracker

**Document type:** Canonical project handover and implementation tracker  
**Project:** BRVIN — Autonomous Software Project Factory and Application-aware Knowledge Platform  
**Owning repository:** `ashini-x/parmar-ai`  
**Historical reference-test-client repository:** `ashini-x/askmoina-voice` (the scaffold is not the Project Factory target; do not deploy it for the new PDF-chat proof app)
**Created:** 4 November 2026  
**Planning baseline:** `main` at the current BRVIN 2 implementation baseline
**Overall implementation status (5 November 2026):** M0–M5 are complete and merged. The original M6 Connect Application wizard (PR #75) is implemented and production-deployed, but its fixed text-client path has now been retired. M6's first administrator-preflight slice is merged and production-deployed (PRs #82 and #83); the full credential lifecycle is not yet complete. The old text-client PR #385 was closed without merging; the isolated scaffold was removed from askmoina-voice by PR #386. The first incomplete milestone remains M6: obtain one-time GitHub/Cloudflare provider consent, then implement automated project-scoped token creation and secret delivery. The first software proof app will be generated independently by the Project Factory.

> **Read this document first when continuing BRVIN 2 in a new ChatGPT chat, Codex task, or work branch.** It contains the approved target architecture, the implementation sequence, progress ledger, acceptance rules and copy-ready milestone instructions. Do not ask the user to repeat the architecture.

---

## 1. Project vision

BRVIN is both a shared, application-aware knowledge platform and the user's autonomous technical administrator and engineering brain across GitHub and Cloudflare.

The user provides an idea, outcome or instruction. BRVIN independently determines the engineering steps, provider resources, credentials, secrets, workflows, tests and deployment operations required to make that outcome work. It executes routine work end to end, validates external state and live behavior, repairs failures within policy and reports the result in its dashboard. The user intends to authorise administrator-level provider authority so routine technical administration is not repeatedly handed back to them.

BRVIN must turn a plain-language software idea into a working, independently maintained application: plan its architecture, create its GitHub repository, write code, provision Cloudflare infrastructure, configure credentials and deployment, test, repair, release and verify the result.

The platform continues to provide shared, application-aware knowledge services. Applications connect once through a trusted environment identity and explicit application-project grants. They can then use independent knowledge projects, upload PDFs, organise collections, assign access, test retrieval and activate projects without a new application deployment for each knowledge project.

> Describe what you want to build. BRVIN creates and operates the software and infrastructure. Connect an application to BRVIN knowledge once; thereafter create additional knowledge projects without recurring code changes, token copying, Wrangler edits or application deployments.

This extends BRVIN's existing architecture; it does not rebuild the existing PDF/OCR/AI Search pipeline. Preserve the central ingestion and retrieval platform. Create a separate GitHub repository for each independent software application, not for each knowledge workspace.

AskMoina Voice is optional and is not a dependency for completing BRVIN 2. The brvin-test-client scaffold in ashini-x/askmoina-voice is a historical reference/test harness, not the target Project Factory architecture. The existing AskMoina Voice production runtime, Gemini Live sessions, camera, audio and conversation state must remain untouched by BRVIN Project Factory work.

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

## 4. Target administrator and project-factory experience

### 4.1 Core operating model

BRVIN is the delegated engineering administrator for the user's GitHub and Cloudflare accounts. The user explicitly intends to authorise administrator-level access so BRVIN can independently decide which repositories, credentials, secrets, Workers, databases, storage, workflows and deployments are needed.

The normal interaction is:
1. User describes an idea or goal in the BRVIN dashboard.
2. BRVIN analyses requirements, proposes an implementation plan, identifies permissions/resources and classifies risk.
3. User approves the project plan and any genuinely consequential provider-permission expansion.
4. BRVIN performs routine engineering and infrastructure work without asking the user to copy tokens, create resources manually, edit YAML, use Wrangler or repeat provider setup.
5. BRVIN reports evidence: repository, checks, deployed URL, resource inventory, security/permission state, test outcomes and recovery path.

BRVIN should support a policy-driven approval model. Once the user approves a project plan and the configured operating policy, routine steps within that plan—including repository creation, code changes, tests, repair iterations, project-scoped credential provisioning, pull-request creation/merging and deployment—may proceed automatically. Ask again only for actions outside the approved policy, material changes in scope, public exposure or destructive/irreversible actions affecting protected production assets, billing or account ownership/security settings.

### 4.2 Provider administrator — GitHub

BRVIN must have administrator-level technical authority across the user's GitHub personal account and all repositories the user authorises, including new repositories created later. The GitHub App/provider connection must request the granular permissions needed to create repositories; administer repository settings; read/write code, branches, commits, tags and releases; manage pull requests and merges; manage Actions workflows and runs; manage Actions secrets and variables; manage environments and deployments; and manage webhooks, rulesets/branch protection and security configuration when required.

GitHub Apps do not receive one undifferentiated account-owner permission. Request the broadest relevant GitHub App permissions supported by the API and account, and obtain owner approval when permissions or installation scope change. Use GitHub App installation tokens for normal automation and short-lived credentials. Use user-authorised OAuth/user-to-server access only for operations that GitHub does not expose to an installation token. Do not claim that a GitHub App can mint a classic personal access token (PAT) through an API; never make recurring manual PAT generation the normal workflow.

For repository creation, request the GitHub Repository Creation permission where sufficient. GitHub documents Repository Creation write or repository Administration write for the authenticated-user repository creation endpoint. Use Administration write for additional owner-level repository settings when needed. The app should be installed for all repositories when the user approves that scope, so future repos do not require another installation.

### 4.3 Provider administrator — Cloudflare

BRVIN must have account-level administrator authority over the Cloudflare Developer Platform resources it operates. This includes the relevant Admin permissions—not Editor-only permissions—for Workers, D1, R2, KV, Queues, Workflows, AI/Search/Vectorize and additional Cloudflare products required by a project. It must be able to create, configure, update, deploy, inspect, rotate and delete project-owned resources.

Cloudflare distinguishes Editor (updates existing resources) from Admin (creates and deletes resources). The current workers-scripts.edit / Workers Editor connection is not sufficient for the approved Project Factory. Provider bootstrap must request the relevant Admin scopes and Account API Token Provisioning capability. If a necessary account-level operation is available only to a higher account role, the required one-time approval must be recorded accurately; do not imply that Workers Admin is equivalent to Super Administrator.

For dynamic credential provisioning, support the Cloudflare OAuth scope account_api_tokens:create where offered, and the account's API Token Provisioning role. Cloudflare-generated tokens are constrained by the permissions/scopes of the creator; BRVIN must verify the created token's actual permission groups and resource scope before saving or using it. The existing OAuth client may need a scope update and re-consent. Do not assume the current Editor OAuth grant upgrades itself.

### 4.4 Autonomous credential and secret manager

Credential provisioning is a first-class BRVIN service, not a manual setup checklist. BRVIN decides which credential mechanism is appropriate for each task and manages its lifecycle.

Supported decisions include:
- GitHub App installation tokens for routine GitHub API operations; request fresh short-lived tokens on demand.
- User-authorised GitHub OAuth access only for operations that require acting on behalf of the user and are unavailable to installation tokens.
- Cloudflare account-owned API tokens created through the authorised token-provisioning path when a deployment or API workflow needs one.
- GitHub Actions repository or environment secrets for CI/CD credentials.
- Cloudflare Worker secrets for runtime credentials.
- Provider OAuth refresh tokens and app private keys encrypted in BRVIN's credential vault.

For each credential, store owner/provider, purpose, target project/repository/environment, permissions, resource scope, creation/expiry/rotation/revocation metadata and a non-reversible fingerprint. Encrypt secret material at rest using a versioned envelope/key-management design; never persist secret plaintext in logs, commits, PRs, browser storage, generated code or chat. Deliver credentials directly from the provider to the intended secret store. Never make the user copy a Cloudflare token into GitHub Actions by hand.

Prefer short-lived credentials, provider-native federated/OIDC authentication where genuinely supported, and project-specific least privilege. BRVIN is authorised to use administrator-level connections, but must not give each generated application the master administrator credential. A generated project's Actions workflow receives only the deployment token/identity it needs. A runtime Worker receives only its required runtime secrets. Project revocation must remove/expire that project's credentials without breaking unrelated projects.

Do not create tokens merely because a project exists. Create them when the selected deployment/runtime architecture requires them, and verify their use. Reuse a safely scoped existing provider connection where appropriate; otherwise create a project- or environment-scoped credential. Credential lifecycle operations must be idempotent, audited and recoverable.

### 4.5 Software project versus knowledge project

**Software project:** an independent application/API/service. Normally receives its own GitHub repository, codebase, CI/CD workflows, deployment resources and BRVIN application/environment identity if it consumes BRVIN knowledge. The Project Factory owns its build, deployment and maintenance lifecycle.

**Knowledge project:** a workspace of PDFs/books/collections and access grants inside BRVIN. It does not receive a GitHub repository or new application deployment. It uses the existing shared ingestion, OCR, indexing and retrieval infrastructure. It can be assigned to one or more explicitly authorised applications.

Creating a new software project may automatically create an associated BRVIN knowledge project if the app needs document knowledge. Creating a new knowledge project alone must never create a repository, Worker or deployment.

### 4.6 Project Factory and engineering orchestrator

The Project Factory accepts a plain-language objective and maintains a machine-readable project plan with requirements, assumptions, architecture, repository, services, data model, identity, permissions, secrets, environments, tests, deployment steps, cost/limits, approval requirements and rollback instructions.

Its cooperating capabilities are:
1. **Planner:** clarifies only material ambiguities, decomposes requirements and creates an auditable implementation plan.
2. **Architecture selector:** chooses a stack and reusable templates/adapters based on requirements, not a single hardcoded application type.
3. **Repository operator:** creates a new GitHub repository, branch policy, README, docs, source tree, tests and automation.
4. **Infrastructure operator:** provisions Cloudflare resources, bindings, domains/subdomains and deployment targets.
5. **Credential manager:** creates and distributes the right scoped provider credentials directly to GitHub Actions or Worker secrets.
6. **Engineering agent:** writes code, runs static checks/tests, inspects failures, fixes and reruns within bounded budgets.
7. **Release operator:** creates review artifacts, merges or deploys according to the approved policy, checks live health and runs synthetic acceptance.
8. **Maintenance operator:** tracks deployment versions, failed workflows, credential expiry, drift and recovery/rollback status.

The orchestrator must use idempotent operations, persistent job state, retry/backoff, per-step checkpoints, concurrency locks, quotas, cancellation, audit events and compensating actions. It must never report success until external provider state and runtime behavior are verified.

### 4.7 First Project Factory acceptance application — Chat with Your PDFs

The first software project generated by BRVIN must be a separate GitHub repository and independent application with a simple ChatGPT-like text interface. The user can add PDFs through a protected upload flow and ask questions. Answers must be grounded in BRVIN retrieval evidence and display the source title plus physical PDF page citations; exact-page queries must return the requested physical page when available.

The generated application owns its UI, user authentication, conversation history and final answer generation. BRVIN owns PDF registration/upload orchestration, OCR, indexing, source grants, application/project authorisation and evidence retrieval. Use the existing private brvin-service and shared ingestion/search infrastructure; do not create a duplicate OCR/search platform for the generated app. Choose a model/provider through an explicit configuration adapter; never hardcode a provider key or assume AskMoina Voice/Gemini Live is required.

The acceptance journey is end-to-end: BRVIN creates the repository and Cloudflare resources; provisions credentials and Actions secrets automatically; runs checks; deploys the app; reports its URL; an administrator uploads a test PDF; the app answers representative questions with accurate citations; an ungranted/revoked project is denied; and no existing Fatman or AskMoina Voice runtime is changed.

### 4.8 Approval, deletion and production safety

User intent authorises broad administrative capability, but operational policy still protects against accidental destruction and runaway automation:
- The user can approve a complete project plan once; routine in-scope tasks then proceed automatically.
- A generated project's own resources may be automatically updated, redeployed and (when explicitly enabled by project policy) removed.
- Deleting BRVIN core resources, Fatman data, shared retrieval infrastructure, account-wide resources or another project's resources requires a separate confirmation.
- Expanding provider permissions, changing account membership/ownership, billing/subscriptions, disabling security controls or exposing private services publicly requires explicit dashboard confirmation.
- Maintain audit logs, resource ownership tags/metadata where supported, backups, deployment rollback and credential revocation.
- Fail closed on identity or permission ambiguity. Never expose BRVIN's master provider credentials to a generated project.

### 4.9 Repeatability promise

After the one-time provider bootstrap, creating another software project should not require repeated app registration, API-token copy/paste, manual GitHub Actions secret entry, Worker creation through the dashboard or hand-written Wrangler configuration. BRVIN determines and provisions what is needed. Creating another knowledge project requires no new repository or app deployment.


## 5. Implementation milestones and completion gates

The foundational M0–M5 work remains complete. The earlier M6 Connect Application wizard (PR #75) is an implemented starting point, not the final acceptance target. The 5 November 2026 direction broadens the unfinished work into delegated provider administration, autonomous credential lifecycle and a reusable software Project Factory. The revised sequence below supersedes the earlier M6–M8 target and their copy-ready prompts; historical milestone logs remain records of what was actually shipped.

| Milestone | Name | Status | Completion outcome |
|---|---|---|---|
| 0 | Architecture freeze and migration blueprint | COMPLETE | M0 design package merged in PR #61 |
| 1 | Multi-application, multi-project identity | COMPLETE | Additive identity registry and production migration verified; Fatman preserved |
| 2 | Private retrieval API v2 | COMPLETE | Trusted environment identity, app-project authorisation and private RPC deployed |
| 3 | Reusable BRVIN application connector | COMPLETE | Typed server-side connector merged and validated |
| 4 | Independent BRVIN text reference consumer scaffold | COMPLETE — historical proof of concept, now retired | The scaffold was removed from askmoina-voice in PR #386; no brvin-test-client Worker was deployed. The generic BRVIN connector remains. |
| 5 | Application/project administration | COMPLETE | Protected admin dashboard, app/environment lifecycle and project grants deployed |
| 6 | Delegated Provider Administration & Credential Lifecycle | IN PROGRESS — first incomplete milestone | GitHub and Cloudflare administrator connections, automatic credential provisioning, encrypted vault, Actions/Worker secret distribution, rotation/revocation and permission verification work without manual token copy/paste |
| 7 | Autonomous Software Project Factory | NOT STARTED | A natural-language request creates a new repo, architecture plan, code, tests, Cloudflare resources, credentials, CI/CD and verified deployment |
| 8 | First generated application — Chat with Your PDFs | NOT STARTED | Factory creates an independent ChatGPT-like PDF application with grounded responses, physical PDF-page citations and access-denial tests |
| 9 | Generalisation and multi-project acceptance | NOT STARTED | Generate a second distinct application type; prove multiple apps/projects, grants, revocation, isolation and no repeated provider bootstrap |
| 10 | Security, release completion and administrator handover | NOT STARTED | Full audit, recovery/rollback, credential lifecycle evidence and nontechnical operating manual |

Optional expansion after M0–M10: M11 Cross-account gateway for separately authenticated applications outside the BRVIN Cloudflare account. Keep same-account private Service Binding as default and keep brvin-service private.

### Milestone 0 — Architecture freeze and migration blueprint

The existing ADR and RPC v2 contract remain authoritative for identity, data migration, retrieval trust, source grants and Fatman compatibility. This milestone is complete; the Project Factory specification adds provider administration and software generation without weakening these contracts.

### Milestone 1 — Multi-application, multi-project identity

COMPLETE. Preserve the existing application/environment/project/grant tables, stable identities and legacy Fatman compatibility.

### Milestone 2 — Private retrieval API v2

COMPLETE. Preserve trusted binding identity, per-request application/project authorisation, ready-source filtering, exact-page retrieval, quotas and structured failures.

### Milestone 3 — Reusable connector

COMPLETE. Generated apps should consume this server-side connector through the approved package/module pattern. They must not query D1 or AI Search directly.

### Milestone 4 — Independent BRVIN text reference consumer scaffold

COMPLETE as a historical proof of concept, now retired. Its fixed Worker/config/test/deployment files were removed from askmoina-voice by PR #386; no brvin-test-client Worker was ever deployed. The generic BRVIN connector remains available for future generated applications. Do not recreate the fixture. The new PDF-chat app must be generated in its own repository by the Project Factory.

### Milestone 5 — Application and project administration

COMPLETE. Preserve the protected administration lifecycle, app-project grants and knowledge-source management. Extend the dashboard rather than creating a parallel admin product.

### Milestone 6 — Delegated Provider Administration & Credential Lifecycle

Implement the foundation that lets BRVIN act as the user's delegated technical administrator.

Deliverables:
- GitHub App permission upgrade and all-repository installation/owner approval, including repository creation/administration, contents, pull requests, Actions, secrets, variables, environments, deployments and other required technical permissions.
- Correct GitHub authentication selection: installation tokens for normal app automation; user-authorised OAuth/user access only for actions that cannot be performed with installation tokens. Never claim to create PATs through an unsupported API.
- Cloudflare OAuth scope upgrade from Workers Editor to the relevant Developer Platform Admin scopes, plus account API token provisioning (account_api_tokens:create where available) and the required account role.
- Provider capability discovery and permission preflight. BRVIN must know which endpoint/resource needs which permission, detect missing scopes before performing changes and show the exact one-time consent required.
- Encrypted, versioned provider credential vault with key rotation, redaction, expiry, ownership, purpose, scope and audit metadata.
- Credential selection and automatic creation. Create a Cloudflare API token only when the chosen task requires it; validate permission groups/resource scope; deliver it directly to the appropriate GitHub Actions repository/environment secret or Worker secret.
- No administrator/master credential in generated repositories, browser code, frontend bundles, chat, logs, PRs or source files.
- Automatic rotation/revocation and project teardown of project-owned credentials, without breaking other applications.
- Tests for missing permissions, token creation limits, invalid scopes, secret encryption, secret delivery failures, rotation, revocation and idempotent recovery.
- Migrate the narrow M6 wizard without losing valid encrypted provider connections; require re-consent explicitly when scopes expand.

Acceptance gate: after one-time provider authorisation/consent, create a test GitHub repository and a test Cloudflare Worker from the BRVIN dashboard without the user manually creating a Worker, generating a Cloudflare token or copying a secret into Actions. Verify the project credential can deploy only its intended resources. Do not mark M6 complete from mocked API tests alone; exercise provider APIs in dedicated test resources and record evidence.

**Live status after PR #83 / Release Validation #675 (5 November 2026):**
- The BRVIN admin panel now exposes GitHub App permission and repository-scope preflight, Cloudflare OAuth scope preflight, a copyable required-scope list, and links to the existing GitHub App/installation settings. It no longer contains the fixed AskMoina-hosted text-client adapter.
- The existing GitHub App is BRVIN Connect, already installed for the user's `ashini-x` account. Its registration and installation permissions have not yet been expanded/approved. The user must approve the requested App permissions and change installation repository access to **All repositories** once.
- The Cloudflare account has one member with **Super Administrator — All Privileges**; no additional member invitation or permanent role change is required. However, BRVIN's encrypted OAuth connection still contains only `workers-scripts.edit offline_access`. The existing BRVIN Connect OAuth client must be expanded with the required Developer Platform/AI scopes and `account_api_tokens:create`, then the user must authorize BRVIN once. The existing client secret is already stored encrypted; do not ask the user to re-enter it.
- PR #82 added the expanded permission manifest/scope request and the read-only capability preflight. PR #83 removed the old fixed test-client functions/routes/UI and updated the admin panel. These changes passed Release Validation #673 and were deployed in Release Validation #675. The live smoke gate verified BRVIN service binding and Fatman retrieval; it did not verify the newly requested provider scopes because user re-consent is still pending.
- Next M6 implementation work: implement Cloudflare account API token creation through the approved OAuth token-provisioning scope; validate returned token permission groups/resource selectors; create and distribute project-scoped GitHub Actions and Worker secrets directly; persist encrypted metadata/fingerprints/expiry/owner; verify actual deployment with the new credential; then add rotation and revocation. GitHub App installation tokens remain the default GitHub API credential; do not create manual PATs.

### Milestone 7 — Autonomous Software Project Factory

Build the general software factory above the existing BRVIN knowledge core.

Deliverables:
- Natural-language project intake and persistent project brief.
- Planner that produces a reviewable scope, architecture, assumptions, data model, security model, infrastructure plan, cost/limit estimate, test plan, rollout and rollback plan.
- Reusable templates/adapters for common app classes, but no fixed single-app assumption. BRVIN must support varied software goals by selecting/extending an appropriate blueprint and clearly identifying unsupported requirements.
- Automatic GitHub repository creation per independent software project, with coherent naming, visibility, default branch, README, docs, issue/PR templates, branch protections where supported, Actions workflows, dependency/security defaults and project metadata.
- Cloudflare resource graph and provisioning/deprovisioning with ownership tracking, idempotency and drift detection.
- Per-project application/environment identity and explicit BRVIN knowledge-project grant when the app consumes BRVIN.
- Engineering agent that writes/updates code, runs type checks/unit/integration/security tests, reads build logs, repairs failures and retries within bounded time/token/cost budgets.
- Persistent orchestrator with queued jobs, state checkpoints, locks, retries/backoff, cancellation, concurrency controls, step evidence and recovery after Worker restarts.
- Release automation that creates reviewable commits/PRs, runs checks, merges/deploys under the user's approved policy, verifies the live deployment and publishes results to the dashboard.
- Project activity timeline explaining what BRVIN decided, created, changed, tested, deployed and why.

Acceptance gate: one dashboard instruction creates a new repository and a functioning deployed application using the authorised providers. No manual token generation, Actions-secret copying, Cloudflare dashboard resource creation or hand-written Wrangler setup. Every action has provider response evidence and an auditable resource owner.

### Milestone 8 — First generated application: Chat with Your PDFs

Use the Project Factory—not a manually assembled repository—to generate an independent PDF-chat application.

Minimum user experience:
- Responsive, mobile-friendly ChatGPT-style text interface.
- Protected administrator sign-in and secure PDF upload flow.
- Source library with document title, processing/readiness status and failure/retry status.
- Conversational question/answer interface with conversation history.
- Responses grounded in BRVIN-returned passages; visibly cite document title and physical PDF page.
- Clickable citation opens the exact source page or page preview when supported.
- Exact-page retrieval test and clear no-evidence/no-answer behavior.
- The generated app owns its user/session/authentication, conversation history and model answer generation. BRVIN owns ingestion/indexing, source grants, application/project authorisation and evidence retrieval.
- Model provider is configured through an adapter and managed credentials; Gemini Live/AskMoina Voice is not required.
- Dedicated GitHub repository, independent Worker/runtime, project-specific resources and credentials, full CI/CD and live health check.

Acceptance gate:
1. Factory produces the repository and deployment from the approved brief.
2. BRVIN registers a new application, environment, knowledge project and grant.
3. BRVIN provisions its Worker, Service Binding and secrets automatically.
4. User opens the deployed URL and uploads a test PDF through the protected UI.
5. Ingestion reaches the defined ready state.
6. Representative questions return correct grounded answers and physical-page citations.
7. Exact-page question cites the requested physical page.
8. Unauthorised, guessed, revoked and inactive project requests fail closed.
9. Existing Fatman, parmar-ai, brvin-service and AskMoina Voice production state is unchanged except for explicitly approved shared BRVIN improvements.

### Milestone 9 — Generalisation and multi-project acceptance

Generate a second, materially different software application from a plain-language brief. It must not be a copy of the PDF-chat app with a changed label.

Additionally verify:
- one application with multiple BRVIN knowledge projects;
- one BRVIN knowledge project deliberately shared with multiple applications;
- direct-book and collection grants;
- multiple PDFs and collections;
- readiness and page-level citations where knowledge applies;
- denial before explicit grant, and denial after revocation/deactivation;
- unknown identities and malformed selectors;
- quotas, service outage and recovery;
- Fatman's original flow and usage history;
- adding a knowledge project requires no repository, Service Binding or application deployment;
- adding a software project does create an independent repository and only the resources it needs;
- credential rotation and project teardown do not affect other projects.

### Milestone 10 — Security, release completion and administrator handover

Audit GitHub App/OAuth permissions, Cloudflare roles/scopes, credential vault, provider token lifecycle, GitHub Actions secret delivery, Worker runtime secrets, resource ownership, audit logs, approval policy, repository/resource deletion protections and rollback. Verify the full journey on the deployed system. Publish a nontechnical manual for describing an idea, approving a plan, operating generated apps, uploading PDFs, inspecting citations, managing project access, recovering from failures and revoking a project. Declare BRVIN 2 complete only after M0–M10 have evidence.


## 6. Copy-ready prompts for each milestone

Use the revised prompts below for M6–M10. Older milestone prompts are retained as historical context, not as current implementation instructions. The project goal and requirements are in GitHub; the user should not have to explain them again.

> **5 November 2026 direction update:** The Project Factory specification in BRVIN_AUTONOMOUS_PROJECT_FACTORY.md is the binding forward architecture. Older M6/M7/M8 prompts below are historical context and are superseded where they describe a fixed brvin-test-client adapter or manual token/secret setup.

### Current continuation prompt (use in every new chat)

Read these GitHub files first: BRVIN_2_MASTER_PLAN.md, BRVIN_AUTONOMOUS_PROJECT_FACTORY.md, BRVIN_SYSTEM_REFERENCE.md, BRVIN_2_ARCHITECTURE_DECISIONS.md and BRVIN_2_RPC_V2_CONTRACT.md. Inspect latest main, open PRs, commits, workflow runs and relevant Cloudflare state. Resume at the first incomplete revised milestone (currently M6: Delegated Provider Administration & Credential Lifecycle). PR #385 in askmoina-voice is closed without merging; PR #386 removed the retired, undeployed test-client scaffold. Do not recreate that adapter or modify/deploy the existing AskMoina Voice runtime for BRVIN acceptance. Preserve Fatman, parmar-ai and private brvin-service. Do not ask the user to repeat the product vision or manually perform recurring token/secret/resource setup. The two one-time provider approvals still pending are expanded GitHub App permissions/All-repository installation and expanded Cloudflare OAuth scopes/re-consent. After those approvals, continue automated token and secret provisioning.

### Revised Milestone 6 prompt

Execute revised BRVIN M6 from BRVIN_AUTONOMOUS_PROJECT_FACTORY.md. Implement delegated GitHub administrator permissions, Cloudflare Developer Platform Admin and account API token provisioning, provider capability discovery, encrypted credential lifecycle, automatic creation/distribution of GitHub Actions and Worker secrets, rotation and revocation. Distinguish GitHub App installation tokens and user-authorised OAuth; never claim to create PATs through an unsupported API. Preserve current provider credentials where possible and require consent only for expanded scopes. Validate with real provider-backed test resources. No manual API-token copy/paste or changes to AskMoina Voice runtime.

### Revised Milestone 7 prompt

Build the reusable natural-language Software Project Factory and persistent engineering orchestrator. Create an independent GitHub repository per software project, plan architecture, provision required Cloudflare resources, create appropriate credentials/secrets automatically, write code and tests, repair failures within bounded budgets, merge/deploy under the approved policy, verify live behavior and maintain an audit/recovery trail. Distinguish software projects from knowledge projects.

### Revised Milestone 8 prompt

Use BRVIN's Project Factory to generate the first independent Chat with Your PDFs application from a plain-language brief. Create a new repository and dedicated deployment; integrate existing BRVIN PDF ingestion and private retrieval. Implement a ChatGPT-like text UI, protected PDF upload, conversation history, grounded answers and physical PDF-page citations. Automatically provision identities, grants, Worker bindings and CI/CD secrets. Run live upload/OCR/index/retrieval/citation and unauthorised/revoked-access tests. Do not manually create a repo or Worker.

### Revised Milestone 9 prompt

Generate a second, materially different software application through BRVIN's Project Factory. Verify that templates/orchestration are reusable and not limited to PDF chat. Complete multi-app/project sharing, grants, revocation, quota, recovery, credential rotation and Fatman preservation acceptance. Adding another knowledge project must not require another repository or deployment.

### Revised Milestone 10 prompt

Complete the final BRVIN security, release and handover audit. Inspect GitHub and Cloudflare administrator permissions, OAuth scopes, generated token permission groups, encrypted credential vault, GitHub Actions and Worker secret delivery, project ownership, audit history, approval policy, protected-resource deletion and rollback. Verify M0–M10 evidence. Publish the nontechnical administrator manual. Do not mark BRVIN complete without deployed end-to-end acceptance.

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
Execute BRVIN 2 Milestone 4 from docs/BRVIN_2_MASTER_PLAN.md. Build the isolated text-first BRVIN reference Worker inside the askmoina-voice repository with a separate Wrangler config, entrypoint, tester-token boundary, text retrieval interface and server-side v2 connector. Do not modify or deploy the existing AskMoina Voice Worker. Validate mocked authorised-project discovery, query retrieval, exact PDF page citations, ungranted-project denial and not-ready handling. Keep the test Worker unconnected until M5 provisions its app/environment/project/grant records and M6 attaches the trusted binding through the wizard.
~~~

### Milestone 5 prompt

~~~text
M5 is implemented and deployed in main. Verify the protected BRVIN administration experience for applications, environments, application-project grants, project association/edit/activation and the existing knowledge/collection/source-grant workflows. Keep registered environment state distinct from a verified live Service Binding. Preserve Fatman and its legacy v1 mapping.
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

**Canonical product direction:** read BRVIN_AUTONOMOUS_PROJECT_FACTORY.md in full. The user wants BRVIN to be the autonomous GitHub/Cloudflare technical administrator and software Project Factory. M6 is the first incomplete milestone. PR #385 in askmoina-voice is closed without merging; PR #386 removed the retired test-client scaffold. Do not recreate that adapter. Do not make the user repeat this goal or manually provision routine tokens, secrets, repos or Workers.

At the start of every new session:

1. Open this master plan from GitHub.
2. Read [BRVIN_AUTONOMOUS_PROJECT_FACTORY.md](BRVIN_AUTONOMOUS_PROJECT_FACTORY.md) in full; it contains the canonical autonomous-administrator and Project Factory specification.
3. Open [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) to understand the audited current architecture.
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

BRVIN is complete only when a nontechnical user can:

1. Authorise the GitHub and Cloudflare provider connections once at the required administrator level.
2. Describe a software idea in the BRVIN dashboard and approve its project plan.
3. Have BRVIN create a new GitHub repository, codebase, tests, CI/CD, required Cloudflare resources, application/environment identities and project credentials without manual token/secret copy-paste.
4. Have BRVIN build, test, repair, merge/deploy under the stored approval policy, verify live behavior and maintain an auditable resource/deployment history.
5. Create an independent Chat with Your PDFs application through the factory, upload PDF documents, ask questions and receive grounded answers with correct physical PDF-page citations.
6. Create a second, materially different software application through the same factory without a bespoke manual infrastructure process.
7. Create additional BRVIN knowledge projects, collections and source grants for connected apps without creating new software repositories, Service Bindings or application deployments.
8. Share projects only through explicit application-project grants; prove denial, revocation, deactivation, quota and recovery behavior.
9. Preserve Fatman's data, ingestion, retrieval, permissions and usage history, keep brvin-service private, and leave AskMoina Voice runtime independent.
10. Inspect the audit trail, credentials, deployments, errors and rollback/recovery instructions from the BRVIN dashboard.

The connected application must retrieve only its authorised project's content and generate an answer using its own model/provider. BRVIN must not expose its master administrator credentials to generated applications.

**The finish line is a working autonomous engineering and knowledge platform—not a collection of merged code changes or a wizard that still depends on manual provider setup.**



### Historical milestone log — 5 November 2026 — acceptance target correction (superseded by Project Factory direction)

**Retirement note:** At the time of this historical entry the first test was planned as a separate text-only Worker inside askmoina-voice. That fixture was later removed by PR #386; PR #385 was closed without merging. Do not follow the old test-Worker implementation steps recorded below. The current target is an independent PDF-chat application generated by the Project Factory.


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

The first owner-run Cloudflare consent attempt returned `invalid_scope`: the self-managed BRVIN Connect OAuth client is not allowed to request `account_api_tokens:create`. This is an internal scope added to Cloudflare's own `cf` CLI OAuth catalog, not a generally requestable self-managed OAuth scope (Cloudflare Workers SDK PR [#15883](https://github.com/cloudflare/workers-sdk/pull/15883)). Cloudflare's self-managed OAuth client schema also rejects colon-delimited scopes. BRVIN therefore no longer requests this special scope and continues to require the catalogue-backed `account-api-tokens.write` permission, corresponding to Account API Tokens Write. After re-consent, verify the actual account-token creation API operation with the OAuth access token before claiming token provisioning works. No token has been created and no Cloudflare resource or credential was changed by this correction.
