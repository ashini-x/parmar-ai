# BRVIN Teachers — Multi-Tenant Teacher Application Platform

**Product brand:** BRVIN Teachers  
**Status:** Architecture approved; implementation has not started  
**Decision date:** 6 November 2026  
**Planning location:** `ashini-x/parmar-ai/docs`  
**Proposed implementation repository:** `ashini-x/brvin-teachers` (not yet created)  
**Relationship to BRVIN:** Separate downstream consumer product using BRVIN v2; not BRVIN core, a BRVIN Worker, or a BRVIN milestone

> This document is the approved architecture and build handoff for BRVIN Teachers. It describes intended future behavior, not deployed capabilities. The repository, application Worker, application D1 database, consoles, schemas and channel integrations do not yet exist. The `BRVIN Teachers` name is a product brand; it does not move BRVIN's existing code, data or production infrastructure into the new repository.

## 1. Executive decision

Build **BRVIN Teachers**, a managed multi-tenant platform for operating teacher-specific AI teaching experiences, in the separate repository `ashini-x/brvin-teachers`.

The platform will support teacher experiences across channels such as Telegram, WhatsApp, websites, mobile applications and Telegram Mini Apps. Teachers provide or approve their knowledge, teaching methods, product requirements and branding. BRVIN Teachers supplies shared application runtime, AI orchestration, channel adapters, feature modules, student/session handling, administration, observability and cost controls.

The architecture decisions are:

1. **Preserve `ashini-x/parmar-ai` and its production behavior.** It is an existing Telegram-first SSC application and the current home of BRVIN administration/ingestion and private retrieval code. It is not an empty platform skeleton and must not be broadly refactored into BRVIN Teachers.
2. **Create a separate repository named `ashini-x/brvin-teachers`** when implementation is authorized. The new repository is a downstream BRVIN v2 consumer; branding does not make it BRVIN core or move BRVIN responsibilities into it.
3. **Keep the existing Parmar AI product standalone initially.** It is the dedicated application for Parmar SSC Sir. It is not automatically a BRVIN Teachers tenant, and no code/data transfer or migration is part of this build. A future migration may be considered only after deliberate feature-parity, data-continuity, security, operational and rollback review plus separate approval.
4. **Use one shared codebase with tenant-aware configuration and reusable feature modules.** Do not create copied codebases, branches, Workers or databases for every teacher or bot by default.
5. **Separate logical modules from deployed infrastructure.** Code boundaries do not automatically require separate Worker deployments.
6. **Start with one BRVIN Teachers runtime Worker and one application-runtime D1 database**, plus Durable Objects for stateful coordination where justified. Split Workers or shard databases only when measured workload, security isolation, provider boundaries or operational needs justify it.
7. **Keep BRVIN as the sole knowledge governance and retrieval system.** BRVIN Teachers is a v2 consumer. It must not create a competing teacher knowledge registry, copy BRVIN source files, query BRVIN D1/AI Search directly, or bypass grants.
8. **Use one central BRVIN Teachers Operator Console** for all tenants and their channel instances. Do not create one admin application per Telegram bot. Teacher-scoped self-service views can be added later with server-side role and tenant authorization.
9. **Make tenant and student authorization server-side.** A teacher ID, project ID, URL parameter, bot name or custom header supplied by a browser is not proof of permission.
10. **Make customization configuration-first, module-second and bespoke only by exception.** A teacher-specific code folder or scattered `if (teacherId === ...)` branches are not the customization model.

The target is not "one Worker at all costs." The target is low operational overhead, measured performance, strong isolation and the ability to split a component without rewriting the product.

## 2. Product and operating model

### 2.1 Default operating assumptions

Until a real pilot or commercial agreement changes them, use these working assumptions:

- The platform operator builds, deploys, monitors and maintains the teacher applications.
- Teachers provide or approve source material, teaching methods, style instructions, branding and feature requirements.
- Teachers do not need to own or operate a GitHub repository, Cloudflare account, database or deployment pipeline.
- A teacher may request a dedicated bot, website experience or app identity. Another teacher may use a shared portal or an integration into an existing website.
- Student identity and conversation context are isolated by teacher/tenant, even where the same student uses more than one teacher's channel.
- A teacher's teaching IP is private to the teacher's authorized project and must not be exposed to another teacher or their students.
- Teacher onboarding is operator-managed initially. A self-service teacher builder is not an MVP requirement.

These are recommended defaults, not claims that every teacher has already agreed to them.

### 2.2 Three customization levels

| Level | Typical request | Implementation approach |
|---|---|---|
| 1 — Configuration | Branding, subject, tone, teaching method, response format, usage limits, enabled channels | Versioned tenant configuration and feature flags |
| 2 — Reusable module | Custom quiz type, formula calculator, mock test, leaderboard, vocabulary trainer, Mini App component | Shared feature package with an explicit capability contract |
| 3 — Bespoke product | A genuinely unique workflow, frontend, integration or service boundary | Dedicated app/module and, where justified, independent deployment |

Default to Level 1. Build a Level 2 feature when it is reusable or has a clear product owner and acceptance test. Use Level 3 only when the requirement cannot reasonably be represented by configuration or a module, or when ownership, compliance, security or release independence requires a separate product.

Do not create `teachers/teacher-a` and `teachers/teacher-b` code copies. A tenant is primarily a data/configuration identity, not a directory of duplicated source code.

### 2.3 Dedicated identity does not require dedicated infrastructure

A teacher can have a dedicated Telegram bot token, bot username, webhook registration, brand, website hostname or application presentation while sharing the same application runtime.

A dedicated teacher-facing identity is not, by itself, a reason to create a dedicated Worker, D1 database or Git repository.

A genuinely independent customer-owned application can be a separate deployment or repository when contractual ownership, account ownership, security isolation or independently controlled release cadence requires it.

### 2.4 Product, platform and knowledge responsibilities

Keep three responsibilities distinct:

- **Parmar AI** is the existing purpose-built SSC teaching application for Parmar SSC Sir. Its current Telegram experience, `/admin`, student and usage records, Fatman integration and production lifecycle remain in `ashini-x/parmar-ai`. It continues operating independently during BRVIN Teachers development.
- **BRVIN** is the shared knowledge governance and retrieval system. Its implementation code currently lives in `ashini-x/parmar-ai` (including the protected `parmar-ai` admin/ingestion Worker and private `brvin-service` Worker). Its live knowledge and operational state live in Cloudflare D1, AI Search and private Google Cloud Storage, not in GitHub files alone. BRVIN owns source ingestion, OCR, indexing, projects, collections, grants, readiness, quotas, audit activity, connection verification and private retrieval.
- **BRVIN Teachers** is the new, separate downstream application platform in `ashini-x/brvin-teachers`. It owns tenant/student/channel identities, teacher configuration, its own application runtime and database, AI orchestration, reusable teaching features and its operator console. It calls BRVIN v2 for authorized evidence; it does not own or duplicate teacher source material.

The word `BRVIN` in the BRVIN Teachers brand is a product-family choice. It does not mean the new repository contains BRVIN core or that BRVIN's existing Workers, D1, AI Search, GCS, OCR or ingestion code are being transferred.

### 2.5 Parmar AI: current standalone status and future option

Parmar SSC Sir is conceptually a teacher in the wider product model, but the existing Parmar AI application is **not currently a tenant of BRVIN Teachers**. Do not route its production traffic through the new runtime, copy its production database, move its bot token, replace its `/admin`, or change its BRVIN identity as part of this project.

A future migration or consolidation is an optional, separate decision—not a target prerequisite. Before considering it, BRVIN Teachers must demonstrate the required Parmar workflows and administration capabilities, with explicit migration mapping, student/data continuity, security and tenant-isolation tests, operational runbooks, staged rollout and rollback. Until then, Parmar AI remains its own application and its current admin remains in place.

### 2.6 Administration surfaces and ownership

There are distinct consoles because they manage different responsibilities:

1. **Existing Parmar AI Admin (`/admin`):** continues to operate Parmar AI while that product remains standalone.
2. **BRVIN Admin (`/admin/brvin`):** manages knowledge projects, source uploads/ingestion, readiness, source/project grants, registered applications/environments and BRVIN operations. It remains the authority for knowledge governance.
3. **BRVIN Teachers Operator Console:** a new central console in the downstream platform. It will manage all BRVIN Teachers tenants, their teacher profiles/configuration, student identity and entitlements, channel/bot registrations, feature enablement, tenant usage/cost visibility and platform operations. It will reference BRVIN project IDs and use BRVIN Admin for knowledge-governance actions rather than duplicating its ingestion and grant controls.

The first BRVIN Teachers release is operator-managed. A teacher-facing console with tenant-scoped permissions is a later feature, not a prerequisite. There must not be one separate admin panel per bot: all bots and websites operated by BRVIN Teachers are managed from the same central Operator Console. This does not merge the existing Parmar AI Admin or BRVIN Admin into it.

### 2.7 Reusable teaching and administration capabilities

Detailed capabilities proven useful in Parmar AI—such as student search and profiles, suspension/reactivation, entitlements or unlimited access, quotas, usage/cost analytics, quiz/mock-test administration, activity history and audit—are requirements to evaluate for reusable BRVIN Teachers modules. They are not automatically copied wholesale from Parmar AI, and not all are MVP requirements.

Implement a capability once behind a tenant-scoped service/module contract. The same domain behavior can be used from Telegram, a website, a Mini App or a mobile client; channel adapters render the capability appropriately for each destination. Teacher-specific differences should ordinarily be versioned configuration and feature entitlements, not copied admin applications or per-teacher code branches.

### 2.8 Multiple bots and channels per teacher

A teacher tenant may have multiple Telegram bots, websites, Mini Apps or mobile experiences. Each is a distinct channel/application identity record mapped server-side to the same tenant and the appropriate configuration, feature entitlements and BRVIN project mapping. For example, one teacher could operate separate English- and Hindi-language Telegram bots while sharing the same tenant-level student policy and teaching modules.

The shared runtime resolves the verified channel registration to its tenant. Each Telegram bot has its own credential reference and webhook-secret validation, but it does not need its own Worker, repository, D1 database or admin panel by default. Student identity and conversation/session keys remain tenant- and channel-scoped so the same external Telegram user ID in two teacher contexts cannot collide.

## 3. Separation from BRVIN and existing Parmar AI

### 3.1 Existing production boundary

The existing BRVIN implementation remains in `ashini-x/parmar-ai`:

- `parmar-ai` continues to own the protected BRVIN admin/ingestion plane and the existing Parmar AI application responsibilities.
- `brvin-service` remains the private retrieval Worker.
- Existing BRVIN D1, AI Search, GCS, OCR, source grants, project grants, quotas, activity, connection verification and retention behavior remain under BRVIN ownership.
- Existing Parmar AI, Fatman and AskMoina data, identity, deployments and production behavior must not change as a side effect of BRVIN Teachers development.

BRVIN Teachers is an **independent downstream consumer**. It is not a new BRVIN service, does not host BRVIN's core implementation and does not move BRVIN responsibilities into the consumer.

### 3.2 BRVIN integration contract

New platform retrieval uses the existing private same-account Service Binding and frozen v2 contract:

- Binding: `BRVIN_SERVICE`
- Service: `brvin-service`
- Entrypoint: `BrvinRetrievalApi`
- Trusted identity: deployment-controlled `props.applicationEnvironmentId`
- Methods: `listAuthorizedProjectsV2()`, `getProjectStatusV2({ projectId })`, `retrieveProjectContextV2(input)`

Use a separate registered BRVIN application/environment identity for the platform's deployed environments. Do not invent or hardcode an environment UUID. Obtain it from the BRVIN admin registration and generated integration handoff.

The application must authenticate its own students and maintain a server-side mapping from authenticated user/tenant context to the BRVIN project(s) that user may access. BRVIN app-project grants are application-wide, not individual-student grants. A `projectId` is a selector checked by BRVIN, not a credential.

Every retrieval request must:
1. Resolve the authenticated student and tenant from trusted server-side identity.
2. Resolve that tenant's approved BRVIN project from the platform's controlled mapping.
3. Confirm that the project is in the application's authorized project list or status check.
4. Call v2 retrieval through the private binding.
5. Preserve book/source identity and physical PDF page provenance in the answer flow.
6. Treat returned passages as untrusted evidence, not executable instructions.
7. Fail closed on revoked/unknown projects, inactive identities, quota errors and service failures. Never fall back to global or unrestricted search.

The consumer must not receive BRVIN D1 credentials, AI Search bindings, GCS access, OCR credentials or provider master secrets. It must never call BRVIN's internal database or search namespace directly.

### 3.3 M11 remains a separate BRVIN acceptance gate

This architecture document does not complete or replace BRVIN M11. M11 remains open until a genuine teacher-focused consumer demonstrates useful retrieval from an actual teacher's approved project/source and then demonstrates denial after the application-project grant is revoked.

The new teacher platform may become that consumer only if it is independently registered/deployed and tested with a real teacher and approved material. No synthetic production teacher, project, source or grant may be used as a substitute.

## 4. Proposed monorepo layout

The `ashini-x/brvin-teachers` implementation repository should use a workspace structure (npm or pnpm can be selected during repository bootstrap; do not introduce workspace tooling without a concrete need).

~~~text
brvin-teachers/
├── apps/
│   ├── runtime-worker/          # Initial dynamic API and channel ingress runtime
│   ├── operator-console/         # Protected internal teacher/application management
│   ├── web-portal/               # Optional shared student/teacher-facing web frontend
│   └── mini-apps/                # Reusable Mini App shells and feature experiences
│
├── packages/
│   ├── contracts/                # Validated request, response and event schemas
│   ├── tenant-config/             # Versioned teacher profile/configuration resolver
│   ├── identity/                  # Tenant, student, channel and session identity mapping
│   ├── ai-orchestrator/            # Channel-neutral model/tool execution
│   ├── brvin-v2-client/            # Typed private BRVIN RPC client only
│   ├── channel-adapters/
│   │   ├── telegram/               # Webhook verification and Telegram formatting
│   │   ├── whatsapp/               # Provider verification and WhatsApp formatting
│   │   └── web/                    # HTTP/API/streaming contracts
│   ├── feature-modules/
│   │   ├── quizzes/
│   │   ├── mock-tests/
│   │   ├── calculators/
│   │   └── leaderboards/
│   ├── security/                   # Authorization, credential encryption and redaction
│   ├── usage-accounting/            # Tenant/student/model/channel metering
│   └── persistence/                 # Tenant-scoped D1 and DO repositories
│
├── migrations/
│   └── runtime-d1/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── security/
├── scripts/
├── .github/workflows/
├── package.json
└── wrangler.jsonc
~~~

This is a logical organization, not a requirement to deploy each directory as a separate Worker. The first deployable runtime is `apps/runtime-worker`. Frontends can be static deployments. Shared packages contain business logic and contracts, not hidden network services.

A custom teacher feature should enter through a declared module interface and capability configuration. Do not place teacher-specific product logic as scattered `if (teacherId === ...)` statements in the shared engine.

## 5. Worker and channel deployment strategy

### 5.1 Initial deployment

Start with the smallest useful deployment topology:

- **One runtime Worker** for the first pilot. It contains clearly separated route/adapter modules for the selected channel and the authenticated web/API surface needed by that pilot. Multiple teacher bots and channel registrations route through this shared runtime; a new bot does not automatically require a Worker.
- **One application-runtime D1 database** for tenant configuration and ordinary operational records.
- **Durable Objects** for conversation/session state or coordination where their single-object ordering and persistence are useful.
- **Static frontend hosting** only when the selected pilot needs a website or Mini App.
- **BRVIN private Service Binding** for knowledge retrieval.
- Use a Queue for work that needs reliable asynchronous processing, webhook acknowledgement, retries or buffering; do not add queues to every synchronous request by default.

Do not create one Worker per teacher. Do not create Telegram, WhatsApp, web and Mini App Workers merely to match folder names. Logical code boundaries come first; deployment boundaries follow concrete operational needs.

### 5.2 When to split a Worker

Split a channel or service into an independently deployed Worker when at least one real requirement supports the extra boundary, for example:

- Different provider credentials or a materially different secret blast radius.
- Different network, authentication or compliance requirements.
- Independent scaling/CPU/concurrency characteristics demonstrated by measurements.
- Different release cadence or failure domain.
- A need to isolate a high-volume or bespoke integration from the shared runtime.

Use Cloudflare Service Bindings for private Worker-to-Worker calls when appropriate. A split must have a documented contract, timeout/failure behavior, observability and deployment/rollback plan.

A tenant count alone is not a reason to split Workers.

### 5.3 Channel-specific responsibilities

**Telegram**
- Register each bot as a distinct tenant channel record.
- Configure a unique webhook destination/route identity for each bot.
- Validate Telegram's configured webhook secret header on every update.
- Map the verified route/channel to a tenant and bot credential server-side.
- Do not assume Telegram sends the bot API token in each update.
- Do not put the raw bot token in a public URL, browser payload, ordinary D1 text field or logs.
- Normalize inbound messages, callback queries, media and Mini App launch data before calling the shared engine.

**WhatsApp**
- Add only when a real teacher requires it.
- Use the selected official provider's signature/verification contract and message IDs for idempotency.
- Keep provider-specific templates, delivery states, retries and credentials in the WhatsApp adapter.
- Do not assume WhatsApp delivery, templates or session rules are identical to Telegram.

**Websites and mobile applications**
- Expose authenticated server API contracts, not direct BRVIN RPC.
- Use a proper user/session or scoped API credential model.
- A teacher slug, `X-Teacher-ID` header, origin or query-string value is a routing hint at most, never authorization.
- Support streaming (for example SSE) when it improves progressive answer delivery and works with the chosen hosting/client contract. Do not claim a fixed latency saving without measurement.

**Telegram Mini Apps**
- Treat the Mini App as an authenticated web client of the platform API.
- Validate Telegram launch `initData` on the server, including its signature and freshness, before deriving the user identity.
- Never trust a teacher ID or user ID supplied only through URL parameters or browser state.
- Share session and quiz state through the authenticated backend/DO flow, not ordinary Worker instance memory.

## 6. Tenant identity, authorization and isolation

### 6.1 Canonical tenant context

Resolve a tenant from a verified channel/application identity, then create an immutable server-side request context. Conceptually:

~~~ts
interface TenantRequestContext {
  tenantId: string;
  channelId: string;
  channelType: "telegram" | "whatsapp" | "web" | "mobile";
  actorId: string;
  conversationId: string;
  environment: "production" | "staging" | "development";
}
~~~

This is an illustrative domain contract; final TypeScript names and validation schemas are selected during implementation.

Do not accept `tenantId`, `teacherId`, `applicationEnvironmentId`, user entitlement or BRVIN project permission from untrusted request bodies. Resolve identity using verified provider credentials/session and server-side records. Bind the resulting tenant context to the rest of the request lifecycle.

### 6.2 Tenant-scoped data access

Application-runtime records that belong to a tenant must include tenant ownership in their keys, relationships and query boundaries. Use composite uniqueness and indexes such as `(tenant_id, external_user_id, channel_id)` where that matches the access pattern.

A SQL `WHERE tenant_id = ?` predicate is necessary but is not, by itself, a complete security guarantee. Enforce authorization in a small number of trusted repository/service boundaries, validate parent-child ownership, reject cross-tenant identifiers, and test every access path.

Never allow the browser or model to select an arbitrary tenant or BRVIN project.

### 6.3 Student and session identity

The same external student ID can exist in separate teacher/channel contexts. Scope identities by tenant and channel, for example:

- Tenant A + Telegram + Telegram user 1001
- Tenant B + Telegram + Telegram user 1001

These are different application identities unless an explicit, verified account-linking workflow joins them.

Conversation and quiz session keys must include tenant scope and a stable conversation/session identity. Never key a Durable Object by a bare student ID. Use an unambiguous canonical tuple encoding or stable hash to avoid delimiter collisions.

### 6.4 Isolation acceptance tests

At minimum, automated tests must prove:

- A student in Teacher A cannot read Teacher B's profile, session, quiz, analytics or private content.
- The same external student ID under two teachers maps to separate tenant-scoped state.
- Browser-supplied tenant/project IDs cannot change authorization.
- A Telegram update with an invalid/missing webhook secret is rejected.
- A valid bot route cannot be used to invoke another bot's credential or tenant.
- A forged or stale Mini App launch payload is rejected.
- A revoked BRVIN grant denies the next retrieval.
- Unready, ungranted or cross-project sources never appear in retrieval.
- A BRVIN outage or authorization failure never triggers unrestricted search.
- Logs and error responses do not reveal bot tokens, API keys, source passages or another tenant's data.

## 7. Application-runtime data and state

### 7.1 D1

Use one application-runtime D1 database initially, separate from BRVIN's existing `parmar-ai-admin-prod` database.

The runtime database owns only consumer-application data, such as:

- Teacher/tenant application profiles and configuration versions.
- Channel registrations and credential references.
- Student/application identities and access mappings.
- Feature entitlements and tenant-specific settings.
- Subscription and quota metadata if the commercial model requires it.
- Idempotency records, lightweight job metadata and audit references.

Do not reproduce BRVIN's books, OCR text, source grants, project grants, ingestion jobs or search index metadata as a second knowledge registry.

Design tenant-scoped tables, foreign keys, composite indexes, bounded queries and short transactions from the beginning. Keep large/burst event processing out of unnecessarily long D1 transactions.

Do not create one D1 database per teacher as the default. Do not promise that one D1 database will handle every possible scale. Measure write contention, query duration, database limits and operational blast radius. Introduce shards or dedicated databases only when workload or contractual isolation demonstrates the need, with an explicit tenant-to-database routing plan and migration procedure.

### 7.2 Durable Objects

Use Durable Objects for state that benefits from one authoritative coordinator, such as:

- A live conversation/session with ordered updates.
- Duplicate admission/idempotency coordination.
- A timed quiz or mock-test room.
- Short-lived collaborative or real-time activity.

Do not use an ordinary Worker global variable as persistent or cross-request session state. Do not create a Durable Object for every trivial record. Keep durable session data bounded, versioned and governed by retention/deletion rules.

### 7.3 Files and generated artifacts

Teacher source PDFs and indexed knowledge remain in BRVIN. Consumer-generated temporary artifacts, Mini App assets or exports may use an appropriate application storage service only when a real feature requires it. Do not copy BRVIN source material into consumer storage just to avoid using the retrieval contract.

## 8. Credentials and provider security

A platform serving many teachers may need many dynamically registered bot/provider credentials. Per-Worker environment secrets alone are not a complete dynamic per-tenant credential registry.

Before enabling multiple live bots, implement and review a dedicated credential handling design:

- Encrypt credentials at rest with authenticated encryption.
- Keep the encryption key outside the database in a narrowly scoped runtime secret.
- Use tenant/channel identity as authenticated associated data where supported.
- Store credential version and rotation metadata.
- Permit write/replace/disable operations without exposing the stored plaintext to ordinary admin views.
- Restrict decryption to the runtime path that needs to call the provider.
- Redact secrets from logs, traces, errors, exports and analytics.
- Define revocation, rotation and incident response procedures.
- Never accept provider credentials from students or browsers.

This is a consumer-platform credential store for the specific channels it operates. It does not authorize creating a broad BRVIN-owned provider-token vault or exposing provider administrator credentials through BRVIN.

The selected encryption/key-management implementation must be validated against current Cloudflare capabilities and the actual threat model during the security design phase. Do not assume a generic `credentials JSON` column is secure.

## 9. Channel-neutral AI execution

The shared AI engine must not depend on Telegram, WhatsApp or a particular frontend.

Normalize all channel inputs into a validated request. The runtime flow is:

1. Verify the channel/provider request or user session.
2. Resolve tenant, channel, actor and conversation identity.
3. Load the active, versioned teacher configuration.
4. Enforce the student's entitlement and server-side teacher/project mapping.
5. Load bounded conversation state from the appropriate Durable Object or persistence layer.
6. Retrieve authorized evidence through BRVIN v2 when the task requires teacher knowledge.
7. Build the model request using the teacher's approved instruction set and bounded retrieved evidence.
8. Treat uploaded/retrieved content as untrusted data; it cannot override system security rules.
9. Generate a typed response and validate its schema and content constraints.
10. Apply the requested feature module (quiz, calculator, mock test, etc.) through explicit contracts.
11. Persist the appropriate session/usage metadata and emit structured telemetry.
12. Convert the platform-neutral result into the target channel's supported format.

Teacher-specific style belongs in versioned configuration and approved prompt components. Feature behavior belongs in reusable modules with contracts. Channel-specific Markdown, poll, template, keyboard, stream or component rendering belongs in channel adapters.

Do not let channel handlers contain duplicate Gemini orchestration or retrieval authorization logic.

## 10. Latency, reliability and cost discipline

"Ultra-fast and cost-effective" is a measured service objective, not an assumption that one Worker or one D1 is always fastest.

### 10.1 Latency

Measure at least:
- Ingress authentication and tenant resolution.
- Session/state lookup.
- BRVIN retrieval duration and result size.
- Model time-to-first-token/audio and total generation time as applicable.
- Channel delivery time.
- End-to-end p50 and p95 by channel and workload.

Use streaming where the client experience benefits. Use asynchronous queues where a webhook needs quick acknowledgement or the work needs retries and backpressure. Preserve idempotency so retries do not double-charge a student or send duplicate quizzes/answers.

Do not claim fixed savings such as "150–300 ms" from SSE, Worker consolidation or a specific topology without a reproducible measurement.

### 10.2 Cost

Track usage by tenant, application/channel, student, model and operation. Enforce configurable per-tenant and per-student budgets/quotas before expensive model execution. Make retry, queue and duplicate behavior visible in cost accounting.

Context caching is optional, not the source of truth. Consider it only for large, stable, frequently reused teacher instructions or context where measured savings exceed cache storage cost. Teacher knowledge remains governed by BRVIN retrieval and its source freshness/readiness rules. Version teacher configuration and invalidate/rebuild applicable caches when their inputs change.

Do not use a context cache as a substitute for per-request project authorization or source grants.

### 10.3 Reliability

Use bounded retries, request IDs, idempotency, dead-letter handling where applicable, safe provider failure messages, and recovery procedures. A channel outage must not corrupt another tenant's configuration or session state. A model/provider outage must not cause unrestricted retrieval or reveal internal errors.

## 11. Operator tooling and onboarding

The first version is operator-managed:

1. Create the teacher/tenant record.
2. Record approved product requirements and teacher ownership/consent for supplied materials.
3. Register the BRVIN project and confirm source readiness in BRVIN Admin.
4. Register the platform application/environment and grant only the intended BRVIN project.
5. Register the channel identity and secure provider credential.
6. Configure branding, teacher instructions, features, limits and allowed origins/users.
7. Run a teacher-only validation conversation or sandbox.
8. Complete security, retrieval, citation, quota and failure tests.
9. Enable the channel for students.
10. Monitor tenant-specific usage, latency, model spend, errors and support needs.

A teacher validation sandbox is a useful product capability, but it must use the same production authorization rules and must not expose one teacher's data to another.

Do not build a general public self-service app factory, autonomous code generator or provider admin credential manager as part of this plan.

## 12. Phased build sequence

Build only what the pilot can validate.

### Phase 0 — Pilot definition

Before implementation, select one genuine teacher and agree:
- Subject and student use case.
- Approved BRVIN project and source material.
- First channel (Telegram is a practical candidate given the existing operating experience, but it is not a permanent platform restriction).
- Required answer behavior and provenance/citation expectations.
- Student authentication/entitlement model.
- Teacher's configuration and any truly bespoke feature.
- Acceptable latency, quality and per-student cost measurement method.

Do not create synthetic production teachers or grants to make the pilot appear complete.

### Phase 1 — New repository foundation

- Create the new repository only after the implementation target/name is confirmed.
- Set up workspace, TypeScript contracts, lint/typecheck/test/build and path-based CI.
- Create the runtime Worker and application-runtime D1 migration framework.
- Add tenant/channel identity resolution and a protected operator-only configuration path.
- Add structured logs, request IDs, redaction and environment separation.
- Add Durable Objects only for the first pilot's actual state requirements.
- Implement the reviewed channel credential storage design before registering live provider tokens.

### Phase 2 — First real consumer

- Implement one channel adapter end to end.
- Connect to BRVIN using the generated v2 handoff and private Service Binding.
- Implement authenticated student-to-tenant/project mapping.
- Implement the channel-neutral AI orchestration and typed response validation.
- Preserve source/page provenance.
- Prove allowed retrieval, wrong-tenant denial, quota handling and denied retrieval after BRVIN grant revocation.
- Run the teacher validation sandbox and real student acceptance before enabling wider traffic.

This phase can provide the real independent consumer evidence needed for BRVIN M11, but M11 remains open until its exact acceptance is recorded in BRVIN's canonical documents.

### Phase 3 — Reusable product features and frontend

Add only validated demand:
- Shared website/API experience.
- Telegram Mini App shell and approved interactive modules.
- Quiz/mock-test/calculator feature interfaces.
- Tenant branding and configuration management.
- Student entitlement, reporting and teacher usage views.

### Phase 4 — Additional channels and special deployments

Add WhatsApp or other channels when a real teacher requires them. Add separate Workers, separate frontend deployments or bespoke modules only where the requirements justify the operational boundary.

### Phase 5 — Measured scaling

Use pilot and production telemetry to decide:
- Whether runtime Worker responsibilities should split.
- Whether D1 needs sharding or dedicated tenant databases.
- Whether hot tenant/session workloads need separate capacity boundaries.
- Which feature modules should be generalized.
- Whether cache, queue or retrieval tuning lowers measured cost/latency without reducing correctness or isolation.

Do not pre-provision infrastructure for hundreds of hypothetical teachers.

## 13. Required release and security gates

No production teacher should be enabled until the applicable checks pass:

- Tenant identity is derived from a verified channel or authenticated user, not a caller-selected tenant header.
- Tenant and student records cannot be read or changed across tenant boundaries.
- Telegram/WhatsApp provider signatures or webhook secrets are checked.
- Mini App launch authentication is checked server-side.
- Channel credentials are encrypted, redacted and rotatable.
- BRVIN v2 identity comes from deployment props; request data cannot override it.
- The authenticated student maps only to the correct approved BRVIN project.
- BRVIN grants and source grants are honored on every retrieval.
- Revocation affects the next retrieval.
- Source title and physical PDF page provenance survive model/formatter processing.
- No-source, unauthorized, quota, provider failure and BRVIN-unavailable paths fail safely.
- Retries and duplicate updates do not double-deliver or double-charge.
- Usage/cost and latency are attributed to the correct tenant/channel.
- Existing Parmar AI, Fatman and AskMoina production behavior is unchanged.
- CI, deployment dry-run, environment checks, smoke tests and rollback are available for each independently deployed component.

## 14. Explicit non-goals and prohibited shortcuts

- Do not refactor the live `parmar-ai` repository into the new platform as the first step.
- Do not create one repository, branch, Worker or D1 database for each teacher by default.
- Do not force all future components into one Worker if an actual security/release/scaling boundary justifies a split.
- Do not treat one shared Worker as shared in-memory session state.
- Do not trust `X-Teacher-ID`, URL parameters, a bot username or a browser-supplied project ID as authorization.
- Do not store raw provider tokens in plaintext D1 columns or generic `credentials JSON`.
- Do not claim that a tenant filter alone guarantees isolation.
- Do not duplicate BRVIN source files, OCR, retrieval indexes or grants in the consumer platform.
- Do not call BRVIN's private Worker through a public URL.
- Do not use context caching as authorization or as the canonical source of teacher knowledge.
- Do not adopt SSE, Queues, Durable Objects, Worker splits or D1 shards without a concrete use case.
- Do not claim cost or latency outcomes without measurement.
- Do not make a self-service app factory, automatic repository creator or autonomous coding agent a prerequisite.
- Do not declare BRVIN M11 complete because this architecture document or a synthetic test exists.

## 15. Authoritative references and continuation

This architecture is subordinate to the actual BRVIN contract for knowledge access. Before implementation:

1. Read [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md).
2. Read [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md).
3. Read [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md).
4. Read [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md).
5. Read [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md).
6. Inspect current source and deployed state before assuming a binding, API, route, credential or capability exists.

When implementation starts, create and maintain `brvin-teachers`' own README, architecture decision records, runtime data model, threat model, integration contract, operator runbook and release process. Keep this document as the architecture handoff until the new repository has its own canonical source of truth.

### 15.1 Review of the supplied multi-tenant monorepo blueprint

The supplied four-page *Architectural Specification Manual — Multi-Tenant Enterprise Monorepo Blueprint* is a design reference, not a replacement for this approved architecture. Retain its useful ideas: separate ingress/channel adapters from channel-neutral AI execution, validated shared contracts, tenant-aware session keys, one shared application database initially and reusable feature packages.

Do **not** adopt the following parts of that proposal:

- Do not create a `brvin_knowledge_registry` table that stores document payloads, copied Markdown/OCR text, or a second searchable knowledge catalog. BRVIN remains the only knowledge registry and retrieval authority. BRVIN Teachers may store a tenant-to-BRVIN-project reference and its own authorized user/tenant mapping, but not a second copy of source content or source grants.
- Do not store raw channel/provider tokens in a generic `credentials_json` field. Implement the reviewed encrypted credential design, narrow decryption path, rotation/revocation and log redaction before enabling multiple live bots.
- Do not create a separate Worker for every adapter or teacher merely because the code has separate folders. Start with one runtime Worker; split deployments only for justified security, provider, release or measured scaling boundaries.
- Do not treat the PDF's 200–500 ms routing figure, zero-cost claim or instant context-cache behavior as verified performance/cost facts. Measure actual end-to-end p50/p95, provider time, retrieval time and spend. Context caching is optional and never replaces BRVIN authorization or per-request source/project checks.

The new platform's application D1 database is separate from BRVIN's existing database. Its tables are for tenant profiles, channel registrations, application identities, students, sessions, entitlements, feature configuration, usage and audit references. A BRVIN project ID is a selector/reference only; every retrieval still goes through the private v2 contract and its grants/readiness/quota checks.

**Continuation instruction:** Build **BRVIN Teachers** as a separate, managed, multi-tenant downstream consumer in `ashini-x/brvin-teachers`. Preserve the existing Parmar AI product and BRVIN production. Do not transfer Parmar AI into the new repository as part of initial implementation. Start with one real pilot teacher, one approved BRVIN project and one channel. Use configuration for ordinary teacher differences, reusable modules for repeatable capabilities, and bespoke deployments only when justified. One Operator Console manages all BRVIN Teachers tenants and channels; do not create one admin panel per bot. Do not duplicate BRVIN knowledge, grants or ingestion. Do not create infrastructure for hypothetical scale; measure the first real workflow and evolve from evidence.
