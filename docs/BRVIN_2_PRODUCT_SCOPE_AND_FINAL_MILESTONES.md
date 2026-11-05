# BRVIN 2 — Product Scope, Admin Experience and Final Milestones

**Status:** User-approved product direction and canonical remaining-work plan  
**Decision date:** 5 November 2026  
**Owning repository:** `ashini-x/parmar-ai`  
**Canonical continuation tracker:** [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md)  
**As-built technical reference:** [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md)  
**Architecture and RPC contracts:** [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md), [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md)

> **This document supersedes the autonomous software Project Factory direction.** BRVIN is a shared, application-aware knowledge platform and admin connection manager for teacher-specific digital brains. ChatGPT remains the user's software engineer through the user's separately authorized GitHub and Cloudflare connections. BRVIN does not need its own LLM brain, code-generation agent, repository factory or deployment administrator for this product goal.

## 1. Product decision

BRVIN exists to let the administrator create and manage multiple teacher-specific knowledge workspaces ("digital brains") and securely connect those workspaces to independently built applications.

The target commercial workflow is:

1. A teacher supplies PDFs containing the teacher's shortcuts, formulas, methods, notes and other approved teaching material. The first delivery is PDF-oriented; native text/notes and additional file formats are not assumed until implemented.
2. The administrator creates that teacher's BRVIN knowledge project, uploads and organizes the material, and waits for indexing/readiness checks.
3. The administrator or developer creates an independent application (for example, a mathematics Telegram bot) in its own GitHub repository. ChatGPT builds and maintains that application using the user's connected GitHub and Cloudflare tools.
4. The administrator registers the application, its repository reference and its runtime environment in BRVIN.
5. BRVIN generates a precise one-time integration handoff for ChatGPT. ChatGPT implements the BRVIN connector in the application repository and deploys through the application's existing workflow.
6. The application is verified against BRVIN's private retrieval service.
7. The administrator grants the application access to the intended teacher knowledge project(s). The app can retrieve only explicitly granted, ready material.
8. Future PDFs, collections and knowledge-project assignments are managed in BRVIN. Adding or removing a project grant must not require another application code change or deployment.

**Product promise:** Manage teacher knowledge once in BRVIN; connect each application once; grant and revoke knowledge access from the BRVIN admin panel. Continue using ChatGPT for application engineering.

## 2. Responsibilities and ownership

### 2.1 BRVIN owns

- The administrator-only knowledge workspace.
- Knowledge projects, document sources, collections, upload state, OCR/indexing, retrieval readiness and source-level grants.
- The application registry and trusted application-environment identities.
- Explicit application-to-knowledge-project grants.
- Private retrieval, authorization checks, quotas and activity/audit events.
- Application connection metadata, onboarding state and connection diagnostics.
- A generated, repository-specific integration handoff for ChatGPT.
- Verification that an application environment actually reaches the private BRVIN retrieval service, once the verification contract is implemented.
- Usage and operational visibility needed to administer the knowledge service.

### 2.2 ChatGPT and the individual application own

- Product requirements and application architecture.
- Creating and maintaining the application's GitHub repository.
- Frontend, Telegram bot, API, backend and user experience code.
- The application's model/provider choice, model credentials, prompts and final answer generation.
- The application's user authentication, Telegram-user mapping, session and conversation history.
- Implementing the one-time BRVIN connector/tool handler in the app's server-side code.
- Adding the private Cloudflare Service Binding in the consumer Worker's deployment configuration.
- Running the application's tests, CI/CD, deployment, repair and release using the user's separately authorized ChatGPT GitHub/Cloudflare connections.
- Enforcing any end-user or teacher-specific entitlement inside the application before selecting a BRVIN project.

BRVIN returns bounded passages and provenance. It does not generate the final answer, provide an LLM, or replace the model used by the consumer application.

### 2.3 Provider authorization boundary

The user's ChatGPT GitHub and Cloudflare connections are separate from any provider credentials BRVIN might hold. BRVIN cannot grant itself access to ChatGPT's connector, cannot expand ChatGPT's repository selection, and cannot silently authorize a new repository inside ChatGPT.

For a new private repository:
- the administrator records its URL/owner/name/default branch in BRVIN;
- the administrator ensures the repository is selected/available in ChatGPT's GitHub connection when ChatGPT is asked to work on it;
- ChatGPT performs repository and Cloudflare code/deployment operations using its own connected tools;
- BRVIN records the repository reference and the verified application environment, not ChatGPT's OAuth credentials.

Do not make a claim that a BRVIN button can authorize ChatGPT's provider connection. When the repository is not available to ChatGPT, show the exact external step the user must complete.

## 3. Core domain model

Keep these concepts separate.

| Concept | Meaning | Creates a repository or deployment? |
|---|---|---|
| **Teacher / owner label** | Human or organization the administrator associates with a knowledge project or application. Initially an admin-managed label, not a teacher login/account. | No |
| **Knowledge project** | A teacher-specific corpus and permission boundary: sources, collections, readiness, usage and grants. | No |
| **Collection** | A named group of sources inside the shared knowledge platform. | No |
| **Application** | A separately maintained consumer product, such as a Telegram bot, website or assistant. | Its repository/runtime are managed outside BRVIN by ChatGPT/user. |
| **Application environment** | A trusted deployment identity for one app environment, e.g. production, staging or preview. | No |
| **Application-project grant** | The explicit permission edge allowing an application to retrieve one knowledge project. | No |
| **Repository reference** | Metadata pointing to the independent source repository ChatGPT maintains. | No |
| **Runtime reference** | Metadata describing the deployed consumer Worker/environment that uses the BRVIN binding. | No |

One application can be granted multiple knowledge projects. One knowledge project can be deliberately shared with multiple applications. A knowledge project never requires its own repository, Worker, D1 database or AI Search instance.

The current v2 grant is application-wide and applies to the application's active environments. It is not a per-Telegram-user grant. A multi-teacher application must enforce its own authenticated user-to-project mapping server-side. For the initial teacher offering, a dedicated application per teacher is the simpler operating model where each teacher's knowledge must remain separate.

## 4. Product and security architecture

Preserve the deployed BRVIN 2 foundation:

- `parmar-ai` remains the BRVIN admin/control application.
- `brvin-service` remains a private Cloudflare Worker with no public route.
- The existing D1 registry, shared AI Search resource, storage, OCR and background ingestion pipelines remain centralized.
- Same-account Cloudflare Worker applications consume BRVIN through the private `BRVIN_SERVICE` Service Binding and `BrvinRetrievalApi` entrypoint.
- V2 caller identity comes only from the Service Binding's deployment-controlled `props.applicationEnvironmentId`.
- Every v2 project request checks the active application, active environment, active project and exact active application-project grant.
- The request's `projectId` is a selector, not authentication or proof of authorization.
- Unknown, disabled, revoked or ungranted identities/projects fail closed.
- Search is restricted to ready sources covered by direct-book and collection grants; no unfiltered/global fallback is permitted.
- Consumer applications never receive BRVIN D1, AI Search, GCS credentials or BRVIN master secrets.
- The consumer app uses its own model and sends returned passages to that model as evidence.

**Same-account constraint:** Cloudflare Service Binding is the current supported integration for consumer Workers in the same Cloudflare account as BRVIN. A Worker in another Cloudflare account, or a server outside Cloudflare, requires a separately designed authenticated gateway. Do not expose `brvin-service` publicly to avoid this constraint.

## 5. Final administrator experience

The admin workspace should be designed around two primary jobs: **manage knowledge** and **connect applications**.

### 5.1 Navigation

1. **Overview** — counts, readiness, active applications, recent activity and items needing attention.
2. **Knowledge projects** — teacher-specific digital brains, owner label, status, sources, collections, assigned applications and usage.
3. **Sources & collections** — PDF/document library, upload, OCR/index progress, grouping, archive/restore/delete and source-level access.
4. **Applications** — independent bots/apps, owner label, type, repository reference, runtime reference, environment list and connection health.
5. **Connections** — guided onboarding, generated ChatGPT handoff, deployment verification and reconnect/revoke workflow.
6. **Operations & usage** — import/retrieval events, quotas, failed jobs, recent connection checks and per-project usage.
7. **Security & audit** — application/project grants, suspensions, revocations, administrative changes and retention/deletion safeguards.

Do not make a broad "Provider Administrator / Autonomous Project Factory" section a primary BRVIN product feature. ChatGPT's provider connections remain the user's engineering interface, not a BRVIN-managed product. Existing provider-connection implementation must be audited for dependencies before any UI or credential is removed; never delete or revoke existing provider credentials as a side effect of this documentation decision.

### 5.2 Overview

The landing page should answer:
- How many active knowledge projects are managed?
- How many applications are registered and connected?
- How many sources are ready, processing or failed?
- Which applications have a pending or failing connection?
- Which knowledge projects have no application, or applications with no granted knowledge?
- What needs attention now?

Use live data, never fabricated counters. Prioritize quick actions: **Create knowledge project**, **Upload sources**, and **Connect application**.

### 5.3 Knowledge project detail

A project detail page should have:
- **Summary:** owner/teacher label, description, status, readiness and usage.
- **Sources:** source title, collection, indexed pages, processing state, errors and safe actions.
- **Collections:** named groups and their source membership.
- **Applications:** apps with active grants, pending grants and revoked history.
- **Usage & activity:** retrieval counts, monthly limit, recent operations and failures.

A source or collection becomes retrievable only when it is ready and explicitly granted to the knowledge project. The platform must not automatically expose all uploaded material to every application.

### 5.4 Application detail

An application page should show:
- Application name, purpose, owner/teacher label and type (Telegram bot, web app, API, voice assistant, etc.).
- GitHub repository URL, owner/name and default branch (reference metadata).
- Runtime provider/account and Worker/service name where applicable.
- Registered environments (production/staging/preview), their status and generated environment identity.
- Connection lifecycle state: Draft, Awaiting ChatGPT integration, Awaiting deployment, Connected, Needs attention, Suspended or Revoked.
- Knowledge projects granted to this application.
- Latest live verification, available source readiness, recent retrieval checks and usage.
- Actions to edit metadata, copy the ChatGPT handoff, verify, suspend, reconnect with a new environment identity, or revoke a grant.

A registry row or generated environment ID alone must never be labelled "Connected". Connected means the deployed consumer runtime has passed the defined live BRVIN check.

### 5.5 Connect application wizard

The wizard should replace separate technical forms with one guided flow:

**Step 1 — Application profile**
- Name, description, owner/teacher label and application type.
- Explain that the application keeps its own user accounts, conversations and model.

**Step 2 — Repository reference**
- Repository URL, owner/name and default branch.
- Record the reference. Do not claim BRVIN has changed the repository.
- Explain that ChatGPT must separately have access to this repository. If it is a new private repository, the user may need to enable it in ChatGPT's GitHub connection.

**Step 3 — Runtime and environment**
- Initial supported target: Cloudflare Worker in the same account as private `brvin-service`.
- Record Cloudflare account label/ID (non-secret metadata), Worker name and environment label.
- Register an application and a server-generated environment UUID through existing BRVIN admin APIs.
- Make clear that this ID is not an API key; trust comes from the private Service Binding configuration.

**Step 4 — Prepare the ChatGPT handoff**
- Show the exact repository and branch reference, application/environment IDs, Worker/service details, RPC v2 methods and required tests.
- Provide a **Copy ChatGPT integration prompt** action.
- The handoff asks ChatGPT to inspect the target repository, add the typed server-side BRVIN connector and Service Binding with `props.applicationEnvironmentId`, wire retrieval into the app's existing model/tool path, add safe diagnostics and tests, run the repo's normal CI, and deploy only under the user's existing deployment policy.
- It explicitly forbids public exposure of `brvin-service`, browser-side Service Binding calls, BRVIN D1/AI Search access from the consumer, secrets in source, v1 `clientId` fallback in v2, and changes unrelated to BRVIN integration.

**Step 5 — Await deployment and verify**
- Display the handoff as pending until ChatGPT has finished code integration and deployment.
- The deployed app must expose a minimal health/verification operation that invokes v2 status through its own trusted Service Binding.
- A future BRVIN verification mechanism must validate the environment and private RPC path without exposing source text or secrets. The exact callback/probe contract must be specified and tested before claiming this UI feature is complete.
- Keep connection verification separate from knowledge readiness: a connection may be healthy while its authorized project has no ready sources.

**Step 6 — Assign knowledge**
- Select one or more active knowledge projects.
- Show exactly which teacher knowledge projects the application will be able to retrieve.
- Create/revoke grants through the existing app-project grant API.
- Explain that a new grant does not require another code change or deployment.
- Require a clear confirmation before broadening an application's knowledge access.

## 6. ChatGPT integration handoff contract

BRVIN must not attempt to become ChatGPT or silently operate the consumer repository. It should generate a precise handoff artifact that ChatGPT can execute using the user's own connected GitHub/Cloudflare tools.

The generated brief must include:
- The target repository URL and branch recorded in BRVIN.
- The application name/ID and environment UUID.
- The declared runtime type/account/Worker/environment.
- The private service name `brvin-service`, entrypoint `BrvinRetrievalApi`, binding name `BRVIN_SERVICE`.
- The exact v2 identity property `applicationEnvironmentId`.
- Required methods: `listAuthorizedProjectsV2()`, `getProjectStatusV2({ projectId })`, `retrieveProjectContextV2(input)`.
- The v2 TypeScript contract and link to [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md).
- A requirement to wire retrieval into the consumer app's existing model/function-call path; BRVIN does not generate the final answer.
- A requirement to preserve source title, physical PDF page and other provenance in the model context/answer.
- The required authorization, isolation, no-evidence, outage and failure tests.
- A requirement to report changed files, commit/PR, CI status and deployed Worker/runtime evidence back to the administrator.

The handoff may include non-secret IDs and configuration. It must never include provider tokens, OAuth refresh tokens, client secrets, BRVIN D1 credentials, AI Search bindings or private storage credentials.

### Separate ChatGPT repository authorization

A repository being recorded in BRVIN does not make it visible to ChatGPT. The administrator must ensure the relevant repository is available through ChatGPT's GitHub connection before asking ChatGPT to edit it. BRVIN must explain this honestly and must not claim that it can change OpenAI-side connector permissions.

### Code integration is one-time per application

Adding another knowledge project to an already-integrated application is an admin grant operation, not a new engineering task. Adding a new application requires its first repository-specific connector and Service Binding integration, followed by deployment and verification.

## 7. Connection states and their truth conditions

| State | Exact meaning |
|---|---|
| Draft | Application profile is saved; no environment integration is claimed. |
| Awaiting ChatGPT integration | Repository reference and environment identity exist; the code handoff has not passed acceptance. |
| Awaiting deployment | App code has been updated, but the configured runtime has not passed the live BRVIN check. |
| Connected | The deployed runtime has passed the v2 identity/status check through the private Service Binding. |
| Connected — no ready knowledge | Connection works, but no granted source is ready for retrieval. |
| Needs attention | A formerly working connection or retrieval health check failed. |
| Suspended | Application retrieval is disabled by administrator policy. |
| Revoked | Application/environment/grant identity has been permanently revoked; retain audit history. |

Never derive Connected from application/environment rows existing in D1. A successful live check is required. Never use "knowledge ready" as a synonym for "connection healthy".

## 8. Security, teacher isolation and operational rules

1. The admin panel is initially operated by the BRVIN administrator. Teacher/customer self-service logins, roles and billing are not implied.
2. An owner/teacher label is metadata unless a separately approved authenticated customer/tenant model is implemented. Do not present it as a security boundary by itself.
3. The application-project grant is application-wide. If an app serves multiple teachers, its server must authenticate its end users and map each user to only the permitted project(s) before requesting retrieval.
4. A dedicated teacher application with one teacher knowledge grant is the simplest initial sale configuration.
5. A knowledge project shared with multiple applications is visible to each granted application. Sharing must be intentional and auditable.
6. Application/environment identity comes from trusted Worker deployment props. A browser request cannot select the identity.
7. Project IDs in RPC inputs are selectors and every request checks the exact active grant.
8. No public route is added to `brvin-service`.
9. No consumer app receives master BRVIN/provider credentials or direct access to D1/AI Search/GCS.
10. Source grants, application grants, project status and environment status must be reversible through the supported lifecycle; revoked identities remain auditable and cannot silently be reactivated.
11. Keep the current Fatman compatibility path, data, usage history and existing AskMoina Voice runtime intact.
12. Use existing ingestion, OCR, AI Search and private retrieval; no duplicate per-teacher infrastructure.
13. Maintain bounded quotas and distinguish rate/usage limits from no-result responses and service outages.
14. Log administrative and connection events without logging secrets or unnecessary raw passages.

## 9. Explicitly out of scope for this BRVIN 2 product

Do not implement these as BRVIN 2 requirements:

- A BRVIN-owned LLM/reasoning brain or Gemini/Vertex inference for BRVIN administration.
- An autonomous coding agent, software architect or self-repairing Project Factory.
- Automatic creation of arbitrary GitHub repositories or application source code.
- BRVIN-owned CI/CD, PR merging, Cloudflare deployment automation, Actions secret delivery, or project-specific deployment-token lifecycle.
- BRVIN taking over or replacing the user's ChatGPT GitHub/Cloudflare connector authorization.
- Automatic permission changes inside ChatGPT or OpenAI's GitHub connector.
- A universal no-code connector for arbitrary external applications.
- Teacher self-service accounts, tenant billing, subscriptions, payment processing or customer-facing admin portals.
- Per-teacher D1 databases, AI Search instances or duplicate OCR/index pipelines.
- Direct public access to the private retrieval Worker.

The user's existing ChatGPT integrations remain the engineering mechanism. A future BRVIN MCP/ChatGPT app connection is optional and not a dependency for the current product.

## 10. Final milestone register

Milestone completion is based on shipped code and evidence, not documentation alone. The status below separates the already completed core from the final product work.

| ID | Milestone | Status at scope freeze | Completion outcome |
|---|---|---|---|
| M0 | Architecture freeze and migration blueprint | COMPLETE | Data model, trust model and migration design accepted. |
| M1 | Multi-application, multi-project identity | COMPLETE | Application, environment and app-project grant registry deployed; Fatman identity preserved. |
| M2 | Private retrieval RPC v2 | COMPLETE | Trusted environment identity and grant-checked v2 retrieval deployed. |
| M3 | Reusable server-side connector | COMPLETE | Typed connector contract available to consumer applications. |
| M4 | Reference consumer scaffold | RETIRED / NOT A PRODUCT REQUIREMENT | The old fixed AskMoina text scaffold was removed and never deployed; do not recreate it. |
| M5 | Core application/project administration | COMPLETE — UX expansion remains | Existing app/environment/grant lifecycle and protected admin are deployed. |
| M6 | Admin workspace aligned to teacher knowledge operations | COMPLETE | Merged/deployed via PR #91; additive owner-label migration, app-neutral teacher knowledge project creation, project readiness/usage/detail UI, application metadata editing, and legacy provider controls collapsed. Main release #701 and production smoke passed. |
| M7 | Application connection registry and wizard | COMPLETE | PR #93 merged and deployed; production release #705 and smoke accepted; repository/default-branch/runtime metadata, generated env identities, Worker metadata, Pending status and D1 migration verified. No provider resource provisioning. |
| M8 | ChatGPT integration handoff | COMPLETE — merged, deployed and production release accepted | PR #95 merged; PR Release Validation #711 and Main Release Validation #713 passed. The admin generates a versioned, dated, copyable non-secret prompt and structured manifest per active application/environment. |
| M9 | Live connection verification and activation | IN PROGRESS — implementation branch | One-time environment-bound challenge/proof protocol, private proof RPC, consumer probe endpoint and admin finalization/status UI are implemented on a feature branch; CI, merge, deployment and live acceptance remain pending. |
| M10 | Teacher knowledge assignment and isolation acceptance | NOT STARTED | Multiple teacher projects and independent apps; grant, revoke, multi-project, sharing and cross-project denial tests pass. |
| M11 | Operations, usage and administrator handover | NOT STARTED | Live project/app usage, pipeline/connection failures, audit/revocation, recovery guidance and nontechnical admin manual. |

### M6 — Admin workspace aligned to teacher knowledge operations

**Build:** Reshape the existing `/admin/brvin` interface, not a new admin product. Make Knowledge Projects and Applications the primary concepts. Add admin-managed owner/teacher metadata where required, and show source readiness, collections, assigned applications, connection state and usage in each detail view. Remove the Project Factory/provider administrator pitch from primary navigation.

**Do not:** implement teacher logins, payments, autonomous coding, provider token automation, or new infrastructure per teacher.

**Acceptance:**
- The admin can create a named knowledge project with an owner/teacher label.
- The admin can see that project's sources, collections, applications and usage together.
- The admin can see all applications and their connection/grant status.
- Existing D1 records and Fatman history are preserved.
- Current upload/OCR/index/retrieval workflows remain unchanged.

### M7 — Application connection registry and wizard

**Build:** A single wizard that registers application metadata, repository reference, runtime reference and one or more deployment environments. Generate the immutable environment identity through the existing backend. Save provider/repository details as metadata only unless a separately justified read-only API is added.

**Acceptance:**
- Admin can register a new Telegram bot or web app without creating a knowledge project or repository automatically.
- Admin can associate an existing GitHub repository URL/default branch and Cloudflare Worker/runtime details.
- Admin can add production, staging and preview environment records.
- The UI states that ChatGPT's GitHub repository authorization is separate and may require repository selection in ChatGPT.
- Environment registration is visibly Pending, not Connected.
- Creating additional knowledge projects does not create an application or environment.

### M8 — ChatGPT integration handoff

**Build:** Generate a deterministic, copyable integration prompt and structured manifest for each registered application/environment. It must be grounded in the exact v2 RPC contract and current repository/runtime metadata. The prompt instructs ChatGPT to do the source-code integration in the connected repository.

**Acceptance:**
- Handoff contains correct repo/branch, app/environment IDs, private service/entrypoint/binding and v2 methods.
- Handoff uses `applicationEnvironmentId`, never the legacy v1 client ID for v2.
- Handoff requires server-side integration into the app's existing model/tool path.
- Handoff contains a security and test checklist.
- No master or deployment secret appears in the handoff.
- The admin can regenerate the handoff after metadata changes and sees its revision/date.

### M9 — Live connection verification and activation

**Build:** Use the accepted challenge/proof protocol in ADR-012. BRVIN admin creates a short-lived challenge for one active environment. The deployed consumer Worker invokes `proveConnectionV2({ challengeId, nonce })` through its private Service Binding, using its trusted binding props. The service issues a single-use proof only for the matching active environment and stores only the proof hash. The authenticated admin UI relays the proof to the finalizer; no consumer master credential, shared secret, passage text or source content is involved. The browser probe may call only the target Worker's content-free `POST /brvin/connection-probe` endpoint.

**Acceptance:**
- A registered but undeployed app cannot be marked Connected.
- A wrong/missing/revoked environment identity fails.
- A valid same-account Service Binding passes the v2 identity/status check.
- The result distinguishes connected/no-ready-source from connected/ready.
- BRVIN can show last check time, environment and safe failure code without secret disclosure.
- Expired, wrong-environment, inactive, forged and replayed challenges fail closed.
- The result distinguishes Connected from Connected — no ready knowledge.
- The service remains private and no unfiltered retrieval path is introduced.

**Implementation and validation state (5 November 2026):** PR #98 is open on `brvin/m9-live-connection-verification`, head `e849fcd3afd1299031008a6efa158220bc75bcdd`. GitHub Release Validation #726 passed typecheck, all unit tests, Node/browser-script tests and both Worker bundle dry-runs. The separate Cloudflare Workers Builds preview check failed because the existing `wrangler preview` trigger hit Free-plan Durable Object namespace limit `10067`; this is an account capacity blocker, not a source/test failure. Production deployment and live proof acceptance remain pending. The branch has not been merged or deployed, and production environments must remain unverified. A registered D1 row or mock result is not completion evidence.

### M10 — Teacher knowledge assignment and isolation acceptance

**Build:** Make application-to-project and project-to-source assignment easy to manage from both application and knowledge-project detail views. Keep the existing app-wide grant semantics explicit. Add tests for the user-facing teacher delivery model.

**Acceptance:**
- Teacher A's app retrieves Teacher A's granted ready sources.
- Teacher B's app cannot access Teacher A's project without a distinct grant.
- A grant can be revoked and the next request is denied.
- One app can access multiple intentionally granted projects.
- One project can be shared with multiple intentionally authorized apps.
- A collection grant includes eligible future ready sources in that collection according to the existing contract.
- Empty, unready, inactive and revoked scopes return no passages or fail closed.
- If one application serves several teachers, its own authenticated user-to-project policy is tested; BRVIN app-wide grants are not misrepresented as per-user grants.

### M11 — Operations, usage and administrator handover

**Build:** Complete operational visibility and the real product acceptance run. The first meaningful consumer should be a separate teacher-focused app such as an SSC Mathematics Telegram bot in its own repository, built and deployed by ChatGPT/user. BRVIN only registers and connects it.

**Acceptance:**
- A fresh application is registered, connected through the ChatGPT handoff and passes live BRVIN verification.
- Teacher-specific knowledge is uploaded, assigned and retrieved correctly.
- Existing Fatman and AskMoina state is unaffected.
- Admin can inspect source pipeline failures, connection failures, usage/quota, grants, revocations and activity.
- The nontechnical manual explains create teacher brain, upload sources, register app, hand off to ChatGPT, verify connection, assign knowledge and revoke access.
- No claim of end-to-end commercial readiness is made until the tests and operational evidence are recorded.

### Deferred M12 — Cross-account / non-Cloudflare consumer gateway

Keep the private Service Binding for same-account Workers. A separate authenticated HTTPS gateway may be designed later for consumer applications outside the BRVIN Cloudflare account or outside Workers. This is not required to complete M0–M11.

## 11. Development log and documentation maintenance contract

The BRVIN 2 documentation is a living handover. Update it in the same PR as every milestone implementation.

For every development PR:
1. Read this document and `BRVIN_2_MASTER_PLAN.md` before editing.
2. Work from the current first incomplete milestone; do not skip gates.
3. Update the milestone status only to In progress, Blocked or Complete with evidence.
4. Record changed files, migration IDs, tests, CI run, PR, merge commit, deployment IDs/versions, live checks and known limitations.
5. Distinguish **implemented**, **deployed**, **live-verified**, **planned** and **blocked**. Unit tests or mocks alone do not prove provider/runtime acceptance.
6. Update [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) when as-built code, schema, bindings, identity or runtime behavior changes.
7. Update [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md) whenever the RPC contract changes.
8. Update [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md) for any trust, identity, grant, transport or integration-contract decision.
9. Add a dated entry to the progress ledger in `BRVIN_2_MASTER_PLAN.md` and to the change log below.
10. Never mark a milestone complete until its acceptance checklist has evidence from the relevant deployed environment.

### Required log entry

```markdown
### Milestone log — YYYY-MM-DD — Mx: short title

**Status:** In progress / Blocked / Complete  
**Scope:** What this change intended to deliver.  
**Implementation:** Exact files, routes, tables, bindings and behavior changed.  
**Tests:** Commands/check suites and results.  
**PR:** Link, number and merge commit when merged.  
**Deployment:** Workflow run, Worker deployment/version IDs and traffic where applicable.  
**Live verification:** Exact request/acceptance checks and results.  
**Limitations:** What remains incomplete or was not tested.  
**Next milestone/action:** The first outstanding acceptance item.
```

### Scope decision log

- **5 November 2026:** User clarified the intended product as a teacher digital-brain knowledge platform with an application connection manager. ChatGPT continues to build and deploy consumer applications through its separately authorized GitHub/Cloudflare integrations. The autonomous BRVIN coding brain, GitHub Project Factory, provider-admin credential vault, automatic repository creation and BRVIN-owned CI/CD were removed from the required product scope. Existing implementation history is retained; future work follows M6–M11 above.

## 12. Canonical continuity instructions

For a new ChatGPT chat or branch:
1. Read [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md).
2. Read this document in full.
3. Read [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) for as-built facts.
4. Read [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md) and [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md) before touching identity, grants or retrieval.
5. Treat [BRVIN_AUTONOMOUS_PROJECT_FACTORY.md](BRVIN_AUTONOMOUS_PROJECT_FACTORY.md) as superseded historical documentation only; do not follow its Project Factory milestones.
6. Inspect latest GitHub commits, PRs, CI runs and relevant production state. Continue at the first incomplete M6–M11 acceptance item.
7. Update these documents in every development PR. Never rely on chat memory as the project ledger.


## 13. Documentation change log

### 5 November 2026 — final product scope freeze

- **PR:** [#89](https://github.com/ashini-x/parmar-ai/pull/89), merged to `main`.
- **Merge commit:** `5a40e969a34a98b8150f9a8446c608e36c5f1f46`.
- **Validation:** [Release Validation #691](https://github.com/ashini-x/parmar-ai/actions/runs/42051789698) passed type-check, unit tests, Node tests and both Worker bundle validations.
- **Changed:** final product-scope/milestone document, master plan, architecture decisions, system reference, application integration guide and superseded Project Factory notice.
- **Deployment:** none. This was documentation-only; no runtime, schema, provider credentials or production resources changed.
- **Next milestone:** M6 — Admin workspace aligned to teacher knowledge operations.

## 14. M6 implementation progress

### 5 November 2026 — teacher-focused admin workspace (complete)

**Status:** COMPLETE — implementation merged and deployed; CI and production release/health acceptance passed. An authenticated visual click-through was not performed from this session.

**Implemented on branch:**
- Added the additive, idempotent `owner_label` metadata migration for existing/fresh knowledge projects and applications.
- Added teacher/owner labels to knowledge-project and application create/update APIs.
- Changed the new teacher-workspace form to create an application-neutral knowledge project. It sends `legacyClient:false`, so a teacher knowledge workspace does not silently create a legacy v1 service-client identity. Existing API callers retain the old legacy behavior unless they explicitly opt out.
- Added project overview metrics for distinct assigned sources, fully indexed ready sources, active app grants and current-month retrieval queries (including Fatman's existing separate v1 counter).
- Updated admin navigation and overview to foreground Knowledge Projects and Applications.
- Updated project cards to show teacher label, source readiness, assigned apps and retrieval usage; added edit dialogs for project/application metadata.
- Updated application cards to show owner label, environment/grant state and an explicit registration-only/unverified message. Live connection verification remains M9.
- Collapsed the older provider-admin section under a legacy-settings disclosure and clarified that ChatGPT uses its own GitHub/Cloudflare authorization. No provider credentials were deleted, reauthorized or revoked.

**Files:** `src/analytics/db.ts`, `src/brvin/admin.ts`, `src/index.ts`, `test/brvin-app-admin.test.ts`, `test/brvin-owner-metadata-migration.test.ts`, `test/brvin-admin-script.node.test.ts`.

**Preserved:** existing D1 rows/IDs, app/environment/project grants, direct and collection source grants, Fatman retrieval/usage semantics, private `brvin-service`, v2 RPC identity and consumer runtimes. No M7 connection wizard or M8 ChatGPT prompt generator has been started.

**Next:** finish source review, run Release Validation, merge only after checks pass, inspect the production owner-label migration and live `/admin/brvin` behavior, and record the deployed acceptance evidence before declaring M6 complete.

### M6 completion evidence — 5 November 2026

- **PR:** [#91](https://github.com/ashini-x/parmar-ai/pull/91), merged to `main`.
- **Merge commit:** `4ab6c555af64f5972607a9b9f409c181d0883c7f`.
- **PR validation:** [Release Validation #700](https://github.com/ashini-x/parmar-ai/actions/runs/42057326833) passed type-check, unit tests, Node/browser-script tests and both Worker bundle checks.
- **Production release:** [Release Validation #701](https://github.com/ashini-x/parmar-ai/actions/runs/42057587342) passed paired Worker deployment, root/health/private BRVIN/Fatman smoke and production release acceptance.
- **Deployments:** `brvin-service` deployment `4417adb9-43db-4bce-b6f3-a4d61bfaf59f`, version `9657e7ef-394e-43ac-abd7-2a3564d9500f`; `parmar-ai` deployment `8ad162b0-9fec-4531-a068-e4c29fa4e1fa`, version `fbcb906b-8d42-430d-815d-c4b9d4891f4f`. Each deployment carried 100% traffic at read-back.
- **D1 migration:** `owner_label` columns exist on `brvin_projects` and `brvin_applications`, each with empty-string default; marker `2026-11-05-brvin-owner-label-v1` exists. Fatman remains active and `fatman -> fatman` legacy v1 mapping remains.
- **Live data check:** exact project and application overview SQL ran successfully; the read-back showed project/source readiness, application counts and usage structures. Verification queries wrote zero rows. No new test project/application was created.
- **Production acceptance artifact:** `13429153708`; root, worker health, BRVIN Service Binding and Fatman retrieval all passed.
- **Manual note:** no authenticated administrator browser session was available for a visual page click-through. The deployed route/client is covered by Node/browser-script contract tests; user visual confirmation at `/admin/brvin` is the only unperformed check.
- **Current active milestone:** M7 — Application connection registry and wizard. Implementation is on `brvin/m7-application-connection-wizard`; it is not yet merged/deployed.


## 15. M7 implementation progress

### 5 November 2026 — application connection registry and wizard (complete)

**Status:** COMPLETE — merged as PR #93, production release #705 passed and D1 read-back confirmed the new metadata schema and preserved existing identities.

**Implemented on branch:**
- Additive application metadata: repository URL, default branch and runtime provider.
- Additive environment metadata: Worker name and HTTPS runtime URL.
- One wizard to register an application plus production/staging/preview environment identities in a single D1 batch. Every selected environment receives a BRVIN-generated UUID.
- Optional Worker name/URL pair per environment; input validation requires both or neither.
- Editing of application repository/runtime metadata and environment Worker references.
- Admin UI makes the Pending connection state explicit. It never labels stored repository/Worker metadata as verified.
- ChatGPT repository access is explicitly separate. No call is made to GitHub or Cloudflare by this wizard.

**Migration:** key `2026-11-05-brvin-connection-metadata-v1`; existing records default to empty repository/Worker references, default branch `main`, and runtime provider `cloudflare-workers`.

**Preserved:** no repository or Worker creation, no secret or binding write, no deployment, no new knowledge project, no application-project grant, no change to the trusted v2 identity contract or Fatman retrieval. Existing app/environment IDs and status lifecycle remain.

**Next:** finish CI/source review, open PR, merge only after all checks pass, run the paired production release and verify migration/read-back data before marking M7 complete.


### M7 completion evidence — 5 November 2026

- **PR:** [#93](https://github.com/ashini-x/parmar-ai/pull/93), merged to `main`.
- **Merge commit:** `3f7803fe5e3cc0f9894292a8ce7ad6c79a6d11d6`.
- **PR validation:** [Release Validation #704](https://github.com/ashini-x/parmar-ai/actions/runs/42062007227) passed type-check, unit tests, Node/browser-script tests and both Worker bundle validations.
- **Production release:** [Release Validation #705](https://github.com/ashini-x/parmar-ai/actions/runs/42062174803) passed paired Worker deployment, root/health/private BRVIN/Fatman smoke and release acceptance.
- **Deployments:** `brvin-service` deployment `8a98e1b0-650e-4421-b79f-0bcd443c6d9c`, version `146cb9f6-84c2-4321-87f6-c82045643fef`; `parmar-ai` deployment `15e68daf-1a53-47df-8a00-26b3223c8ffa`, version `4c4cfe12-ea03-417d-bf1e-8ee8e26c9d81`.
- **D1 migration:** marker `2026-11-05-brvin-connection-metadata-v1` exists. Application repository/default branch/runtime-provider columns and environment Worker name/URL columns exist with documented defaults.
- **Preservation:** Parmar AI, AskMoina Voice and revoked BRVIN Text Test Client app records remain. Existing application/environment IDs and status values remain. Fatman project and `fatman -> fatman` mapping remain. Fatman November counter read back as 31. Every verification query wrote zero rows.
- **No provider side effects:** no GitHub repository, Cloudflare Worker, secret, binding, token, project, grant or deployment was created by the wizard. Repository and runtime values remain descriptive metadata. GitHub access is separate.
- **Connection state:** every environment remains Pending until M9 live private Service Binding verification. This is intentional, not an unverified success.
- **Production acceptance artifact:** `13430623895`.
- **Next active milestone:** M8 — ChatGPT integration handoff. It has not been started by this work.


### 5 November 2026 — M8 ChatGPT integration handoff (complete)

- **Status:** COMPLETE — PR #95 merged to main as `81bc036ca1ffd2ae7d3ce6ed0170ee2e1e69d9fd`; paired production deployment and release acceptance passed.
- **Implementation:** The admin application/environment cards now expose Generate ChatGPT handoff. The modal shows a revision, generation time, complete prompt and structured JSON manifest, with copy controls. The protected endpoint regenerates from current saved app/environment metadata and verifies environment ownership and active status.
- **Contract:** Includes repository URL/default branch, application and environment IDs, private `brvin-service` / `BrvinRetrievalApi` / `BRVIN_SERVICE`, v2 methods, trusted `applicationEnvironmentId`, server-side model/tool-path integration, connector source pinning, security restrictions and required tests.
- **Security boundary:** No provider/master/deployment secret or legacy v1 client ID appears in the generated handoff. BRVIN does not provision repositories, Workers, bindings, secrets, grants or deployments. The target account is not proven by M7 metadata; the generated prompt requires explicit same-Cloudflare-account verification. Non-Cloudflare runtime providers are blocked for this private Service Binding path.
- **Validation:** PR Release Validation [#711](https://github.com/ashini-x/parmar-ai/actions/runs/42067500863) passed typecheck, unit/integration tests, Node/browser-script tests and both Worker bundle validations. Main Release Validation [#713](https://github.com/ashini-x/parmar-ai/actions/runs/42067800093) passed the initial feature deployment. The subsequent closeout release [#715](https://github.com/ashini-x/parmar-ai/actions/runs/42068966058) also redeployed the unchanged M8 code and passed paired deployment, root/health/private BRVIN/Fatman smoke and production release acceptance. Latest artifact ID: `13434968943`.
- **Latest production versions:** `brvin-service` version `797ea8a6-6735-44c4-afad-2dd19bf2363c`, deployment `d7436bd2-d0b8-435b-9a6f-d224abaf9c77`; `parmar-ai` version `5e248a66-1c1a-45df-a23a-fd7b8d941032`, deployment `f7dac7cd-8215-4748-86b1-296eb4219c27` (main release #715).
- **Limitations:** This session did not have an authenticated admin browser for manual visual click-through or per-app copy testing. The shipped admin script/route contracts and generator were covered by CI; no specific consumer is claimed Connected. Every environment remains Pending until M9.
- **Next:** M9 — Live connection verification and activation. No M9 work is included in this milestone.
