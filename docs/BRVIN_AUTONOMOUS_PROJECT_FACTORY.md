# BRVIN — Autonomous Technical Administrator and Software Project Factory

**Document type:** Canonical product/architecture specification and implementation acceptance contract  
**Decision date:** 5 November 2026  
**Status:** APPROVED PRODUCT DIRECTION — implementation not yet complete  
**Owning repository:** ashini-x/parmar-ai  
**Companion continuity tracker:** [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md)  
**As-built reference:** [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md)

## 1. Executive decision

BRVIN is to become the user's autonomous technical administrator and engineering brain across GitHub and Cloudflare.

The user provides an idea, outcome or instruction. BRVIN independently determines the engineering steps, provider resources, credentials, secrets, workflows, tests and deployment operations required to make that outcome work. It executes routine work end to end, validates external state and live behavior, repairs failures within policy and reports the result in its dashboard.

The user explicitly intends to authorise administrator-level access to GitHub and Cloudflare. Do not redesign this product into a limited read-only assistant or make the user manually provision every repository, Worker, API token or Actions secret. The implementation must use the strongest appropriate supported provider permissions after the user approves the one-time provider authorization/installation.

The primary user experience is:

> I describe what I want. BRVIN works out how to build it, creates the required project and infrastructure, configures access and credentials, builds and tests it, deploys it, verifies it, and tells me when it is ready.

This specification extends the existing BRVIN multi-application/multi-project knowledge architecture. It does not replace its trusted identity model, private retrieval RPC, shared ingestion pipeline, Fatman compatibility or source authorization.

## 2. User-approved requirements

1. **Administrator-level provider authority.** BRVIN must have broad technical administrator access to the user's GitHub account/repositories and Cloudflare account/developer infrastructure, including creation, modification and deletion of project resources.
2. **Autonomous resource decisions.** BRVIN decides when a project needs a repository, Worker, database, storage, workflow, API token, GitHub secret, Worker secret, domain, binding, queue, model provider or other service.
3. **Autonomous credential lifecycle.** BRVIN chooses the correct auth mechanism, generates credentials through provider-supported APIs, configures the destination secret store, validates use, tracks expiry/ownership and rotates/revokes them. No routine user copy/paste.
4. **One repository per independent software project.** A new application/API/service normally gets a distinct GitHub repository and lifecycle. Repository names/visibility/structure are part of the project plan.
5. **No repository per knowledge workspace.** A BRVIN knowledge project is a data/permission workspace in the existing shared BRVIN platform, not a new software repository or deployment.
6. **General application scope.** Do not hardcode the system to PDF chat, Workers only, or one frontend. Use reusable templates, platform adapters and an extensible engineering workflow; clearly report unsupported architecture constraints.
7. **Autonomous engineering.** Plan, write code, test, inspect failures, repair, retry within bounded budgets, create review artifacts, merge/deploy under the approved policy, verify live behavior and maintain the result.
8. **Dashboard-first oversight.** The user should mainly approve the project plan, one-time provider permission expansions and material/high-risk actions. Routine execution should not pause for repeated confirmations.
9. **Private credential boundary.** Master administrator credentials must never be exposed to generated applications, browser bundles, project source code, logs, PRs or chat.
10. **Proof through a real generated app.** The first acceptance application is Chat with Your PDFs, created by BRVIN in a new repository and deployed independently.
11. **Preservation.** Keep parmar-ai as BRVIN's control plane and brvin-service private. Preserve Fatman's data/ingestion/retrieval/usage and do not change the existing AskMoina Voice runtime to make BRVIN work.

## 3. Concepts and ownership boundaries

### 3.1 BRVIN control plane

The existing parmar-ai Worker/repository remains the BRVIN control plane. It owns the protected admin dashboard, application and project registries, provider-connection state, credential vault, project specifications, job orchestration, audit events and operational policy.

The Project Factory is a capability within BRVIN, not a separate ungoverned service. It should be split into durable modules/services if needed, while preserving the control plane and private retrieval boundaries.

### 3.2 Software project

A software project is a separately deployable product such as a PDF chat app, inventory tool, booking service, website, API, agent or automation. It normally gets:
- a dedicated GitHub repository;
- its own project brief, architecture and technical documentation;
- source code, tests and CI/CD;
- distinct Cloudflare resources and environments as required;
- project-specific credentials/secrets;
- an application/environment identity and explicit BRVIN knowledge-project grant if it consumes BRVIN knowledge;
- an owner/resource inventory, deployment history and recovery policy.

BRVIN can create more than one Worker, database or supporting resource inside the same software project. One repository does not imply one Worker.

### 3.3 Knowledge project

A knowledge project is a document corpus/workspace in BRVIN. It has its own project ID, metadata, books, collections, readiness, quotas and grants. It uses the shared BRVIN ingestion/OCR/index/search infrastructure and private retrieval service.

Creating a knowledge project alone must not create a repository, Worker or software deployment. One software application can be granted multiple knowledge projects, and one knowledge project can be explicitly shared with multiple applications.

### 3.4 Application identity

When a generated software project uses BRVIN knowledge, BRVIN creates a new application and trusted environment identity, plus an explicit app-project grant. The environment identity is supplied only through trusted deployment configuration (same-account Service Binding props.applicationEnvironmentId for Cloudflare Workers). It is never accepted from a browser request.

## 4. Administrator access model

### 4.1 GitHub

The user authorises BRVIN's GitHub App/provider connection across all repositories when available and approved. The app must request the supported granular permissions required for:
- repository creation and repository Administration (where needed);
- repository contents, metadata, branches, commits, tags, releases;
- Actions workflows/runs and deployment workflows;
- Actions secrets and variables, including secret-public-key retrieval and encrypted secret writes;
- environments and environment secrets;
- pull requests, reviews, merging and status checks;
- deployments and deployment statuses;
- webhooks, rulesets/branch protection and security configuration where required for managed repos.

The permission matrix must be derived from exact GitHub endpoints used by the implementation and tested against an actual GitHub App installation. Do not assume one permission unlocks all operations. GitHub Apps have granular repository, organization, enterprise and account permissions. When app permissions are expanded, the account owner must approve the updated installation. All-repository installation enables future repos to be managed without repeated installation, subject to GitHub's installation behavior and user approval.

**Repository creation:** request GitHub's Repository Creation permission where it covers the endpoint. GitHub documents Repository Creation write or repository Administration write for the authenticated-user create-repository endpoint. Use Administration write for additional owner-level repository settings when needed.

**Authentication selection:** prefer GitHub App installation access tokens for repository automation. Mint short-lived installation tokens on demand and do not save them as long-lived Actions secrets. Use a user-authorised OAuth/user access token only for operations that require the user's identity and are not available to an installation token. GitHub does not provide a supported API for an App to mint an arbitrary classic personal access token on the user's behalf. Never design recurring manual PAT creation as the standard integration path. If a permission/API operation is unavailable, explain the exact platform limitation and request only the one-time authorization actually required.

Official references:
- [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-github-app/choosing-permissions-for-a-github-app)
- [GitHub App permissions required by REST API endpoints](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
- [Create a repository](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user)
- [GitHub account/repository access model](https://docs.github.com/en/get-started/learning-about-github/access-permissions-on-github)

### 4.2 Cloudflare

The user wants BRVIN to have administrator-level authority across the Cloudflare account's developer infrastructure, not merely Workers Editor access. Request and verify relevant product-level Admin roles/scopes for each managed resource category, including Workers and deployments, D1, R2, KV, Queues and Workflows, AI/Search/Vectorize, DNS/domains/routes only when needed, and additional Developer Platform products added through explicit tested adapters.

Cloudflare distinguishes Editor (updates/deploys existing Workers) from Admin (creates, reads, updates, deploys and deletes Workers). The uploaded permission inventory contained Workers Editor (workers-scripts.edit) but not Workers Admin. BRVIN therefore requires the product-level Workers Admin scope (workers-scripts.admin) for autonomous Worker creation; Workers Editor alone cannot satisfy the Project Factory acceptance gate. This is distinct from the account member's Super Administrator role. For D1, R2, KV, Queues, AI/Search, Vectorize and other managed products, request the product-specific Read/Write permissions needed by the exact APIs. Prefer narrower project/resource scopes for deployment credentials wherever Cloudflare supports them.

**Account API token creation remains an explicit capability gate.** The existing BRVIN Connect self-managed OAuth client cannot request Cloudflare's special account_api_tokens:create scope (Cloudflare rejected it as invalid_scope; that scope is documented for Cloudflare CLI OAuth). BRVIN continues to request the catalogue-backed account-api-tokens.write permission, but must prove that POST /accounts/{account_id}/tokens succeeds with the actual BRVIN OAuth token before claiming token provisioning works. Cloudflare's token-creation guide also documents that API-driven creation starts with an initial dashboard-generated API token carrying Account API Tokens Edit. If the OAuth operation is rejected, record the exact provider limitation and use only a documented one-time bootstrap path; do not silently fall back to a broad permanent token or claim the no-manual-token architecture is complete. Generated tokens remain limited by the creator's permissions and their granted permission/resource scopes.

Official references:
- [Cloudflare Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/)
- [Cloudflare account roles](https://developers.cloudflare.com/fundamentals/manage-members/roles/)
- [Cloudflare OAuth client and scopes](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/)
- [Cloudflare account API token provisioning announcement](https://developers.cloudflare.com/changelog/post/2026-10-01-account-api-token-provisioning/)
- [Create account API tokens](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/)

### 4.3 One-time bootstrap versus recurring automation

One-time provider approval may be required to register/update the GitHub App, approve expanded permissions, install it for all repositories, update Cloudflare OAuth client scopes, grant Account API Token Provisioning or authorize account access. Provider consent cannot be forged or skipped by code.

After bootstrap, BRVIN must autonomously create new repositories, resources, tokens and secrets; update workflows; deploy; rotate/revoke project credentials; and verify connectivity. Do not ask the user to create a Worker, generate a new API token, copy a token into GitHub Actions or add a repository secret by hand for each project.

### 4.4 Credential decision engine

Before each provider operation, BRVIN resolves target account/repository/resource, exact API operation and permission groups, available credential, whether a new credential is necessary, credential owner/scope/expiry/rotation, direct secret destination and revocation/recovery behavior. Prefer short-lived provider tokens. Do not create a long-lived token if a short-lived installation or OAuth token can perform the task.

### 4.5 Credential handling and secret distribution

**GitHub:** Use GitHub App installation tokens for normal API work. Use user OAuth only when required. For Actions calling Cloudflare, create an appropriately scoped Cloudflare credential (or use a supported federation approach) and write it directly to the relevant repository/environment Actions secret. For secret writes, obtain the repository Actions public key, encrypt the secret and call the GitHub secret API. Verify the API response without trying to read secret values back.

**Cloudflare:** Create account-owned API tokens only when required through the approved token-provisioning path. Scope each token to the target project/resources and exact permission groups. Verify with a non-destructive API call, then install it directly into the GitHub Actions secret or Cloudflare Worker secret destination. Track token ID, purpose, scope, expiry, fingerprint and owning project.

**Never:** put master credentials in generated repos, frontend code, source files, logs, PRs, analytics, screenshots, user chat or test snapshots. Never expose secrets to a browser. Revoke project-owned credentials on project teardown without affecting other projects.

### 4.6 Credential vault

Review and extend the existing provider connection vault before using it for more powerful credentials. Requirements: envelope encryption with versioned keys and rotation; separation of OAuth refresh tokens, App private keys, account API-token metadata and project deploy/runtime secrets; control-plane-only access; redacted logs; fingerprints and metadata without rendering plaintext; idempotent create/rotate with safe overlap and revocation; recovery for revoked tokens and App key rotation; credential inventory, expiry warnings and per-project revocation.

## 5. Software Project Factory

### 5.1 Project intake

A user writes a natural-language brief. BRVIN turns it into a structured project specification with goals, non-goals, user journeys, requirements, architecture, stack, data model, privacy boundary, repository/branch plan, Cloudflare resource graph, secrets/provider dependencies, BRVIN application/environment/knowledge-project relationships, security, cost/limits, tests, acceptance, deployment, rollback and maintenance plan.

Ask only if a missing detail materially affects architecture, security, cost or user-visible behavior. For low-risk details, select a sensible documented default and let the user revise it.

### 5.2 Repository creation

Create one new GitHub repository per independent software project by default. Make it private unless the user explicitly requests public visibility. Initialize source code, package configuration, README, architecture/operations docs, tests, fixtures, CI/CD, issue/PR templates where useful, security defaults, default branch/merge policy and a BRVIN project manifest recording resource ownership.

Do not create a new repo for a new knowledge collection, book or BRVIN knowledge project.

### 5.3 Infrastructure planning and provisioning

Create only the resources the architecture needs, such as Workers, D1, R2, KV, Queues, Workflows, AI services, secrets, bindings, domains/routes, observability and alarms. Link each resource to a software project/environment using ownership metadata/tags where supported. Maintain an authoritative resource inventory. Use idempotent create-or-reconcile operations, not blind duplicates.

### 5.4 Engineering and execution orchestrator

Use persistent job state rather than a long synchronous request. Each job records immutable brief/plan version, ordered step graph, state, per-step inputs/outputs/redacted evidence/retry count, idempotency key, concurrency lock, timeout and budget, checkpoint/resume, cancellation, compensating actions and provider-mutation audit.

The engineering agent writes code and tests, reads Actions logs/artifacts and Cloudflare diagnostics, classifies failures, repairs within bounded budgets, creates commits/PRs, merges/deploys under policy, runs live synthetics and rolls back failed releases.

For complex projects, delegate bounded specialist tasks with explicit scopes, contracts and acceptance. A supervisor integrates and verifies results. Prevent concurrent edits to the same files/resources without coordination.

### 5.5 Merge and deployment policy

Build on a branch, run checks and inspect changes, create PR/release evidence, auto-merge only when approved policy permits and required checks are green, deploy with tracked version IDs, run health/functional tests, roll back failed deployments and publish a summary.

The user approves the project plan once. Routine PR creation, merging and deployment can proceed automatically under that plan. Seek confirmation for expanded permissions, billing, unrelated/protected production resources, public exposure, cross-account access or irreversible operations outside the generated project.

## 6. First proof application — Chat with Your PDFs

Generate an independent application with a simple ChatGPT-style text interface. The user uploads one or more PDFs and asks questions; answers are grounded in those PDFs and cite the physical PDF page.

The app owns its UI, user/admin authentication, conversation history, model provider adapter, final answer generation and upload UX. BRVIN owns application/environment registration, project grants, PDF upload orchestration, OCR, indexing, source/collection permissions, private retrieval, exact-page evidence, quotas and audit. The generated app must never access BRVIN D1 or shared AI Search directly; it calls private brvin-service from its trusted Worker via Service Binding. The browser cannot choose trusted identity. Model/provider integration is configured through an adapter; Gemini Live/AskMoina Voice is not required.

Minimum UI: source list and processing status; main chat transcript/composer; protected upload with validation/progress/readiness; answers citing source title and physical page; clickable page citation where supported; empty/loading/error/no-evidence states; conversation history and new conversation; responsive mobile-friendly layout.

Acceptance: the factory creates a distinct private repository and deployment; registers app/environment/project/grant; provisions required Cloudflare resources and secrets; uploads a test PDF through the deployed UI; verifies ingest/ready state; answers representative and exact-page questions with correct citations; returns no-answer when evidence is absent; denies ungranted/guessed/revoked/inactive projects; tests session isolation and recovery; leaves Fatman and AskMoina Voice production unchanged.

## 7. Approval and resource safety

Broad provider authority is intentional and user-approved. Do not reduce the design to Workers Editor or repository contents-only access. However, autonomous power must be attributable, recoverable and bounded to the approved project/policy.

- A user-approved plan permits routine actions within that plan.
- New-project resources may be updated/deployed automatically and deleted automatically only where the user has enabled that lifecycle policy.
- Deletion of BRVIN core, Fatman data, shared retrieval infrastructure, account-wide resources or another project's resources remains separately protected.
- Permission upgrades, OAuth consent, provider installation scope and account-role grants require the provider's actual owner/admin approval.
- Account-wide membership, billing and ownership changes are not implied by a software project plan; request only if a provider feature strictly requires them and explain why.
- Resource inventory, ownership tags, backups, deployment versions, rollback targets, credential rotation and audit events are mandatory.
- Detect when an API cannot perform an operation with current auth; never fabricate capability or use a root credential in the target app.

## 8. Revised milestones and acceptance gates

See [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md). The revised sequence is M0–M5 complete; M6 Delegated Provider Administration & Credential Lifecycle in progress; M7 Autonomous Software Project Factory; M8 first generated Chat with Your PDFs app; M9 generalisation and second app; M10 security/release/handover; M11 optional cross-account gateway deferred.

Do not mark milestones complete because docs, mocks or unit tests exist. Use real provider-backed resources, actual workflow runs and live application behavior.

## 9. New-chat continuity contract

At the start of every new chat/Codex session, read these GitHub files in order:
1. BRVIN_2_MASTER_PLAN.md
2. BRVIN_AUTONOMOUS_PROJECT_FACTORY.md
3. BRVIN_SYSTEM_REFERENCE.md
4. BRVIN_2_ARCHITECTURE_DECISIONS.md
5. BRVIN_2_RPC_V2_CONTRACT.md

Then inspect latest branches, commits, PRs, checks and relevant Cloudflare state. Resume at the first incomplete milestone. The user should not need to repeat this specification in a new chat.

Current first task: M6 remains incomplete. PRs #82/#83 deployed the provider-administrator permission preflight and admin-panel instructions. The remaining one-time approvals are: (1) approve the expanded existing BRVIN GitHub App permissions and set its installation to All repositories; (2) update the existing BRVIN Connect OAuth client with the current scope list, including Workers Admin (workers-scripts.admin), preserve its callback URL and authorization-code/refresh-token grants, then authorize once. Do not request the unsupported account_api_tokens:create scope from this self-managed client. After consent, first prove whether account-api-tokens.write can call the real token-creation endpoint; if not, decide and document the minimum supported one-time bootstrap path. Then implement project/resource-scoped credentials, direct GitHub Actions/Worker secret delivery, encrypted vault lifecycle, rotation and revocation before M7.

## 10. Implementation boundaries

- Do not force generated apps into askmoina-voice or another unrelated existing repository. Each independent software project gets a purpose-built repository.
- Do not use existing AskMoina Voice production runtime, Gemini Live, camera/microphone or voice acceptance suite as a BRVIN dependency.
PR #385 in askmoina-voice is closed without merging; PR #386 removed the old undeployed text-test-client scaffold. Do not reopen PR #385 or recreate that fixed adapter.
- Do not create per-knowledge-project repositories or duplicate OCR/search infrastructure.
- Do not expose brvin-service publicly to make generated apps connect.
- Do not trust browser-supplied app/environment or project IDs as authorization.
- Do not store GitHub/Cloudflare master credentials in generated repos, frontend code, logs or chat.
- Do not manually create routine Workers, repositories, tokens or Actions secrets when provider connection can do it.
- Do not silently perform billing purchases or account membership/ownership changes.
- Do not claim successful deployment or retrieval without actual live evidence.
