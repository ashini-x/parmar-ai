# BRVIN 2 — Architecture Decision Record

**ADR:** BRVIN2-001  
**Status:** Accepted baseline decisions; product-scope ADR-011 accepted 5 November 2026  
**Original date:** 4 November 2026  
**Scope:** BRVIN 2 identity, private retrieval and application integration through M0–M11  
**Owning repository:** `ashini-x/parmar-ai`  
**Active product scope:** [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md)

This ADR records the additive application/environment/project-grant model, private v2 retrieval contract, migration and compatibility decisions. Its original architecture decisions remain in force unless explicitly superseded by a later ADR. **ADR-011 records the current product boundary:** BRVIN manages teacher knowledge and application connections; ChatGPT remains responsible for consumer-application engineering through its separately authorized integrations. The autonomous Project Factory proposal is archived and is not an active requirement.

## 1. Decision summary

BRVIN 2 will introduce three additive D1 entities:

1. `brvin_applications` — the software product connected to BRVIN.
2. `brvin_application_environments` — a trusted deployment identity for one application environment.
3. `brvin_application_project_grants` — an explicit permission for an application to retrieve one project.

The private retrieval Worker will resolve its caller from the Service Binding's deployment-controlled `ctx.props.applicationEnvironmentId`. A request's `projectId` selects a requested project; it never authenticates or authorises that project. Every v2 request must resolve the environment, verify the application and environment are active, verify the exact application-project grant, verify the project is active, then resolve only that project's ready and fully indexed direct/collection-granted sources.

The existing `brvin_service_clients` mapping and v1 methods remain supported during migration. They are not reinterpreted as application records and are not deleted in Milestone 1. Existing project IDs remain unchanged: production Fatman currently uses the literal text ID `fatman`, while new projects are provisioned with UUIDs. V2 treats project IDs as opaque selectors and supports both. The Fatman `fatman_search_usage` counter, source rows, project grants, collections, page keys and shared AI Search resource remain intact.

## 2. Decisions

### ADR-001 — Separate applications from projects

An application is not a project and a project is not an application. One application can be granted multiple projects; one project can be shared with multiple applications. The application-project relationship is many-to-many and explicit.

An application's users/workspaces are outside BRVIN's trust boundary. For a multi-tenant consumer, the consumer app's authenticated server-side context selects the BRVIN project. A browser-supplied project selector must not be trusted as proof of entitlement.

### ADR-002 — One trusted identity per deployed environment

Each connected Worker environment receives a generated immutable environment identity. The Service Binding passes its UUID-shaped ID as `applicationEnvironmentId` in trusted binding `props`.

Environment labels are descriptive values such as `production`, `preview`, or `staging`; they are not credentials. An environment ID is not an API key: trust comes from control of the deployment configuration and the private same-account Service Binding.

An application can have multiple environment identities. Revoked identities are retained for audit and must not be reused. A replacement environment identity receives a new UUID.

Application-project grants are application-wide and apply to that application's active environments. Per-environment grants are not part of the first delivery; add them only through a separately reviewed design if a real requirement appears.

### ADR-003 — Keep retrieval private and same-account

Keep `brvin-service` as a private Worker with `workers_dev: false`, no public route and a default HTTP 404 response. Same-account Workers use Service Binding RPC. Do not make the internal retrieval Worker public to simplify onboarding.

Cross-account or non-Cloudflare consumers require the deferred Milestone 9 gateway. It must be a separate authenticated HTTPS boundary and must never weaken the internal Service Binding identity model.

### ADR-004 — Keep one D1 and one AI Search resource

All applications and projects continue to use `parmar-ai-admin-prod` and the existing shared AI Search namespace/instance. Do not create one D1 database or AI Search instance per project or app. Do not change AI Search metadata or re-index the Fatman corpus as part of this identity migration.

Project isolation is enforced by D1 grants, pre-search folder filters and post-search returned-key validation. Every source must be ready and fully indexed. A project with no effective source grants returns no passages and performs no search.

### ADR-005 — Keep ingestion centralised

BRVIN continues to own source registration, private GCS source PDFs, Vision OCR, Workflow indexing/recovery/QA, page keys, readiness, archive and deletion. Consumers do not upload, OCR or index the same book again.

The existing legacy `src/fatman/import.ts` and `src/fatman/workflow.ts` module names are implementation history, not a requirement to rename or rebuild them in BRVIN 2.

### ADR-006 — Keep generation and user state in the consumer

BRVIN returns bounded evidence and provenance only. The consumer application retains its own model, prompts, model tool/function handling, authentication, user/workspace mapping, conversation history, memory, voice/video sessions, quota and final answer delivery.

For AskMoina Voice, the existing Gemini Live function/tool path will call the new typed connector server-side. Retrieved passages, book titles and physical PDF page numbers become evidence supplied to Gemini Live; Gemini Live remains responsible for the final response and spoken delivery. AskMoina must not bind BRVIN's D1, AI Search, GCS or ingestion Workflow.

### ADR-007 — Add schema; do not rewrite legacy tables

Milestone 1 adds the application registry, environment identities and application-project grants. It does not rename, rebuild or delete existing BRVIN tables. The `brvin_service_clients` mapping remains the v1 compatibility path and is still populated for legacy clients as the current compatibility code expects.

The migration seeds a `Parmar AI` application and its production environment, with an explicit grant to the existing Fatman project. This records the actual current production consumer. AskMoina is registered when its connection is provisioned in Milestone 4; no unconnected or ungranted AskMoina project is fabricated in production.

### ADR-008 — Preserve existing quota semantics

Fatman's usage continues to be charged to `fatman_search_usage`. Other projects continue to use `brvin_project_search_usage`. A project's monthly allowance is shared across all applications that have been explicitly granted that project. Thus sharing a project does not multiply its monthly allowance.

BRVIN's project-level quota is distinct from every consumer app's own user/workspace quota, rate limits and billing. Do not copy the Fatman 20-question/day Telegram limit into the BRVIN retrieval allowance.

### ADR-009 — Fail closed during dual-version operation

The v1 path resolves only `ctx.props.clientId` through `brvin_service_clients`. The v2 path resolves only `ctx.props.applicationEnvironmentId` through the application/environment registry.

Protocol version is selected by the explicit RPC method name, not by request data or automatic identity fallback: v1 methods resolve only `ctx.props.clientId`; v2 methods resolve only `ctx.props.applicationEnvironmentId`. A v2 method with a missing, malformed, revoked, unknown or inactive environment ID fails closed and never falls back to a co-present `clientId`. A v1 method remains an explicit legacy call and resolves only its configured `clientId`. There is no request-body override for either identity.

### ADR-010 — Do not silently alter a consumer's production deployment

First-time app onboarding is a reviewed integration workflow: explicit GitHub and Cloudflare authorisation, repository/branch and Worker discovery, same-account check, proposed binding and typed adapter changes, a GitHub PR, checks, admin review/approval, then the app's existing deployment mechanism. No silent merge, production push or deployment. Additional projects under an already-connected app are BRVIN D1/admin operations and do not create app PRs or redeploy the consumer.

## 3. D1 data model — exact target schema

The following DDL is the Milestone 1 target. It is intentionally additive and uses the existing D1 database. IDs are generated by the BRVIN server with `crypto.randomUUID()`, except the three deterministic seed IDs reserved by the one-time compatibility migration below.

```sql
CREATE TABLE IF NOT EXISTS brvin_applications (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  slug TEXT NOT NULL UNIQUE CHECK (
    length(slug) BETWEEN 1 AND 64
    AND slug = lower(slug)
    AND slug GLOB '[a-z0-9]*'
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND substr(slug, -1, 1) GLOB '[a-z0-9]'
  ),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brvin_applications_status
  ON brvin_applications(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS brvin_application_environments (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  application_id TEXT NOT NULL
    REFERENCES brvin_applications(id) ON DELETE RESTRICT,
  environment_key TEXT NOT NULL CHECK (
    length(environment_key) BETWEEN 1 AND 32
    AND environment_key = lower(environment_key)
    AND environment_key GLOB '[a-z0-9]*'
    AND environment_key NOT GLOB '*[^a-z0-9-]*'
    AND substr(environment_key, -1, 1) GLOB '[a-z0-9]'
  ),
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_brvin_app_env_application_status
  ON brvin_application_environments(application_id, status, environment_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brvin_app_env_one_active_key
  ON brvin_application_environments(application_id, environment_key)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS brvin_application_project_grants (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  application_id TEXT NOT NULL
    REFERENCES brvin_applications(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL
    REFERENCES brvin_projects(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  revoked_at INTEGER,
  revoked_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_brvin_app_project_grants_project_status
  ON brvin_application_project_grants(project_id, status, application_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brvin_app_project_one_active_grant
  ON brvin_application_project_grants(application_id, project_id)
  WHERE status = 'active';
```

### 3.1 Column semantics and invariants

| Entity | Field | Rule |
|---|---|---|
| Application | `id` | Server-generated UUID; stable for the lifetime of the app record |
| Application | `slug` | Unique lowercase URL-safe admin identifier; not a credential |
| Application | `status` | `active` can retrieve; `suspended` and `revoked` cannot |
| Environment | `id` | Server-generated UUID; this exact value is bound as `applicationEnvironmentId` |
| Environment | `application_id` | Parent application; never supplied by the caller |
| Environment | `environment_key` | Normalized deployment label, unique among active environments for one app |
| Environment | `status` | `active` can retrieve; `disabled` or `revoked` cannot |
| Grant | `application_id` + `project_id` | Exact permission edge; app-wide across its active environments |
| Grant | `status` | Only an active row authorises retrieval; revoked rows remain for history |
| Grant | `created_by`, `revoked_by` | Admin actor reference, never a secret |
| All | timestamps | Unix milliseconds, consistent with current BRVIN D1 rows |

Additional invariants:

- No cascade delete is used for applications, environments, grants or projects. Lifecycle is managed through status and revocation.
- The partial unique indexes allow old revoked rows to remain while permitting a replacement environment identity or a later re-grant.
- IDs and slugs are generated by BRVIN. The browser cannot choose the trusted environment ID.
- D1 foreign-key enforcement and migration behavior must be exercised in the migration tests before rollout.
- An application-project grant does not itself grant books to a project. Existing `brvin_project_books` and `brvin_project_collections` remain the independent source-level permission layer.
- The new tables do not contain API keys, access tokens, source text, OCR content or user conversation data.

### 3.2 Authorisation query contract

Resolve the environment only from the trusted Service Binding props:

```sql
SELECT
  e.id AS environment_id,
  e.environment_key,
  a.id AS application_id,
  a.slug AS application_slug
FROM brvin_application_environments e
JOIN brvin_applications a ON a.id = e.application_id
WHERE e.id = ?
  AND e.status = 'active'
  AND a.status = 'active'
LIMIT 1;
```

Then authorise the requested project independently:

```sql
SELECT p.id, p.name, p.slug, p.description, p.status
FROM brvin_application_project_grants g
JOIN brvin_projects p ON p.id = g.project_id
WHERE g.application_id = ?
  AND g.project_id = ?
  AND g.status = 'active'
  AND p.status = 'active'
LIMIT 1;
```

The first query resolves the caller. The second verifies a grant for the requested project. Do not combine them into a query that treats an untrusted `projectId` as caller identity.

After that, use the existing source resolver semantics: ready books, `indexed_pages = page_count`, and either a direct `brvin_project_books` grant or a `brvin_project_collections` grant. Keep safe-prefix validation, AI Search pre-filter and returned-key validation.

### 3.3 D1 migration mechanics

Milestone 1 must use the existing shared D1 binding and `brvin_migrations` marker mechanism; it must not create a second database or use a separate project-scoped registry. Apply the DDL with the existing `ensureAnalyticsSchema` initialization path after inspecting its current statement splitting and startup behavior.

- Create the three additive tables and their indexes using `CREATE TABLE/INDEX IF NOT EXISTS`.
- Use the stable migration key `brvin2-application-identities-v1`.
- Preflight the three reserved IDs, the `parmar-ai` application slug, the `production` active environment key and the Fatman app-project pair for conflicting rows.
- Seed the Parmar AI application, production environment and Fatman app-project grant in one D1 `batch()` transaction after the schema exists. Use the three reserved IDs in §4.1 and idempotent inserts. Make environment/grant inserts conditional on the exact expected parent application and existing Fatman project so a conflicting reserved ID cannot attach new rows to the wrong parent.
- Cloudflare documents that statements in a D1 `batch()` execute sequentially in one SQL transaction and that a failing statement aborts/rolls back the batch. See [D1 Database API — batch()](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- Read back each seeded row and verify the expected IDs, slug, names, parent app, project, environment label and active status. Also run `PRAGMA foreign_key_check`. A collision where a reserved ID or unique slug belongs to a different record is a hard migration error, not a successful no-op.
- Insert the `brvin_migrations` marker in a second batch only after read-back verification succeeds. If a Worker crashes after the seed batch but before the marker, a retry repeats the idempotent seed, verifies it, then writes the marker. If verification fails, leave the marker absent and require explicit reconciliation; do not delete data automatically.
- The v2 resolver must not use an incomplete registry. Milestone 1 keeps v2 consumers disabled; Milestone 2 must gate v2 readiness on successful schema/migration initialization.
- The migration must not update or delete `brvin_service_clients`, projects, books, collections, book grants, collection grants, search usage or activity history.

The current `ensureAnalyticsSchema` promise is isolate-local. The M1 migration therefore needs idempotent DDL, stable seed identifiers, unique constraints and a transactional D1 batch so simultaneous Worker cold starts cannot create duplicate app/environment/grant records. Add explicit repeated-start and concurrent-start tests before deployment.


## 4. Legacy-to-target mapping

| Current production state | Target state | Migration behavior |
|---|---|---|
| Project `fatman` | Same project row | No rename or new project |
| `brvin_service_clients(client_id='fatman', project_id='fatman')` | Legacy v1 compatibility mapping | Preserve unchanged |
| Current `parmar-ai` Worker with `props.clientId='fatman'` | Parmar AI application + production environment identity + grant to Fatman | Add registry rows; do not change caller behavior in Milestone 1 |
| `fatman_search_usage` | Same Fatman quota history | Preserve every row and counter |
| `brvin_project_search_usage` | Same non-Fatman project quota history | Preserve every row and counter |
| Books, collections, direct grants, collection grants | Same central knowledge/source permission layer | No data copy, re-index or grant widening |
| `brvin-service` private Worker | Same private Worker | Keep private; no public route |
| AskMoina Voice Worker | New application and environment identities during its integration milestone | Do not bind BRVIN D1 or AI Search directly |

### 4.1 One-time seed identities

Milestone 1 uses stable reserved IDs so that concurrent Worker initialisation cannot create duplicate seed applications:

- Parmar AI application: `00000000-0000-4000-8000-000000000101`
- Parmar AI production environment: `00000000-0000-4000-8000-000000000102`
- Parmar AI → Fatman grant: `00000000-0000-4000-8000-000000000103`

These identifiers are ordinary registry IDs, not secrets. The migration must use `INSERT OR IGNORE`, then read back and verify the exact slug/name/parent/status relationship. If an ID or slug already belongs to a different record, fail loudly and require reconciliation; do not silently adopt it.

Only the production environment is seeded because it is the confirmed live Parmar AI binding. Additional preview/staging environments are created when their deployed binding is verified and configured, not inferred from a branch name.

## 5. Compatibility and rollout plan

The release is deliberately staged so the existing consumer keeps working throughout:

| Stage | Milestone | Behavior |
|---|---|---|
| A | 0 | Documentation only. No D1 or Worker change |
| B | 1 | Add three tables, indexes and verified Parmar AI/Fatman seed rows. Keep `brvin_service_clients`, v1 methods and `props.clientId` behavior unchanged |
| C | 2 | Add v2 RPC methods. Keep v1 RPC methods. V2 resolves `applicationEnvironmentId`; v1 resolves `clientId`. Unknown v2 identity never downgrades to v1 |
| D | 3 | Package the typed connector against the v2 contract and test it without a production caller cutover |
| E | 4 | Register AskMoina application and its environments, explicitly grant its selected project, add the binding and connector, then enable the Gemini Live tool via a reviewed PR and normal deployment |
| F | 5–6 | Admin UI and connection wizard manage the same registry and prepare reviewed integration PRs |
| G | 7–8 | Run full multi-app permission, retrieval, quota, Fatman-preservation and production acceptance; publish handover |

### 5.1 Rollback

- Milestone 0 changes documentation only.
- Milestone 1 is additive. Roll back the Worker code if necessary; leave the three new tables and seed rows in place. Do not drop tables or delete grants as part of a code rollback.
- Milestone 2 can be rolled back to the previous private Worker version while the v1 methods and `brvin_service_clients` rows remain available. Do not route v2 failures to global search.
- A consumer migration is reversed by rolling back that consumer's normal Worker deployment and preserving the old binding props/method calls.
- Use the existing paired `brvin-service` then `parmar-ai` release validation and rollback workflow. Capture both previous Worker version IDs before a production deployment.
- Never roll back by deleting source PDFs, AI Search items, D1 project grants or usage counters.

## 6. RPC v2 contract decision

The normative TypeScript contract is in [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md). The v2 method surface is explicitly versioned to preserve the existing v1 method names:

- `listAuthorizedProjectsV2()` — list only active projects granted to the authenticated application.
- `getProjectStatusV2({ projectId })` — readiness for one project after application authorisation.
- `retrieveProjectContextV2({ projectId, queries, pageNumbers? })` — bounded semantic and exact-page retrieval from that project's ready sources.

No method accepts an application ID, environment ID, client ID, search prefix or source grant from the caller. No unrestricted search method is provided. The project list exposes metadata and counts, not document text.

## 7. AskMoina Voice integration decision

AskMoina Voice is the first new real consumer, not a special-case BRVIN fork.

1. Create one AskMoina Voice application record.
2. Create distinct production and preview environment identities only for the corresponding deployed Worker configurations.
3. Create the intended BRVIN project(s) and assign sources through existing book/collection grants.
4. Grant the AskMoina application only the project(s) required by the product.
5. Add `BRVIN_SERVICE` to AskMoina's server-side Wrangler config, with `props.applicationEnvironmentId` for the relevant environment. Do not add D1 or AI Search bindings.
6. Add the narrow connector type and server-side adapter.
7. Add a Gemini Live tool declaration that accepts a natural-language query and, only where needed, an explicit PDF page. The handler resolves the applicable project from AskMoina's authenticated server-side context, not from arbitrary browser input.
8. Return concise source-grounded evidence with book title and PDF page to Gemini Live.
9. Preserve existing user auth, AskMoina D1, conversation/memory, audio/video transport, session-resumption and response generation.
10. Test successful retrieval, no result, wrong project, no grant, revoked grant, inactive app/environment, quota, service outage and actual voice/camera response.

The AskMoina project selector belongs to the app's trusted server-side mapping. A user cannot gain access by inventing a BRVIN UUID.

## 8. Administrator and Connect Application workflow decision

### Recurring knowledge administration

After an application has passed its first connection check, the administrator can create additional knowledge projects, upload and organize sources, grant a project to an application, revoke a grant, inspect usage and suspend an application. IDs and environment identities are generated by BRVIN. Adding another project grant must not require a repository edit, Service Binding change or app deployment.

### First-time application connection

The application connection is an assisted handoff, not a BRVIN-owned repository factory:

1. Admin records the application profile, owner/teacher label, repository URL/default branch and target runtime metadata in BRVIN.
2. BRVIN creates the application and environment identity records.
3. BRVIN generates a repository-specific, non-secret ChatGPT integration brief.
4. The administrator ensures the target repository is enabled in ChatGPT's GitHub connection. BRVIN cannot grant OpenAI-side connector permission.
5. ChatGPT uses the user's connected GitHub/Cloudflare tools to inspect the repository, add the v2 connector and private Service Binding with `props.applicationEnvironmentId`, wire the call into the existing model/tool path, test and deploy.
6. The deployed consumer runtime proves its v2 identity and private binding through an authenticated minimal health/verification contract.
7. BRVIN marks the environment Connected only after live verification, then the administrator assigns/revokes knowledge-project grants.

The handoff must contain no provider secret. The consumer application owns its model, user/session/authentication, conversation state, final answer generation and delivery. BRVIN returns bounded evidence and provenance only. Same-account private Service Binding remains the supported path; cross-account/external integrations require a future authenticated gateway.

Do not implement broad provider-admin credential provisioning, repository creation, CI/CD or an autonomous coding agent as BRVIN requirements.


## ADR-011 — BRVIN is a knowledge platform and application connection manager, not a software factory

**Decision date:** 5 November 2026  
**Status:** Accepted product-scope decision

The user clarified that the primary value of BRVIN is to manage teacher-specific digital brains and connect independent applications to them. The user already uses ChatGPT with separately authorized GitHub and Cloudflare connections to build, test and deploy application code. BRVIN should not duplicate that engineering agent.

**Consequences:**
1. BRVIN owns knowledge ingestion/OCR/indexing, projects, collections, source grants, application/environment identities, app-project grants, private retrieval, quota, activity/audit and connection verification.
2. ChatGPT and the consumer application own repository creation/maintenance, application design/code, model/provider selection, app-side user auth/session/conversation, connector implementation, CI/CD and deployment.
3. BRVIN's Connect Application wizard records repository/runtime references, creates application/environment registry records and generates a non-secret, repository-specific ChatGPT integration handoff.
4. ChatGPT must separately have access to the target private repository. BRVIN cannot authorize or modify OpenAI's GitHub connector.
5. The consumer Worker in the same Cloudflare account adds the `BRVIN_SERVICE` binding to private `brvin-service`, entrypoint `BrvinRetrievalApi`, and trusted `props.applicationEnvironmentId`. The exact live-verification contract must be separately designed and tested.
6. Creating another knowledge project or granting it to an already-connected application must not require another application code integration or deployment.
7. The current app-project grant is application-wide. Multi-teacher consumer apps must enforce their own authenticated user-to-project mapping.
8. The previous autonomous Project Factory proposal is retained as historical documentation but superseded. Do not implement its repository creation, coding agent, provider token vault or BRVIN-owned CI/CD milestones.
9. Same-account private Service Binding is the required initial scope. Cross-account/external gateway remains deferred.

This decision does not change the already deployed D1 identity model, v2 RPC contract, private retrieval transport, shared ingestion pipeline, legacy Fatman compatibility or existing consumer runtime behavior.

## 9. Acceptance and threat checklist

### Data model and migration

- [ ] One application can have multiple active environment identities.
- [ ] One application can have multiple active project grants.
- [ ] One project can have multiple active application grants.
- [ ] Duplicate active app/environment labels are rejected.
- [ ] Duplicate active application/project grants are rejected.
- [ ] Revoked environment identities and grants remain auditable.
- [ ] Re-granting does not duplicate an active permission edge.
- [ ] Unknown, conflicting or partially seeded migration state fails visibly.
- [ ] Existing Fatman project, book, collection, direct and collection grants remain unchanged.
- [ ] Existing Fatman monthly usage rows remain unchanged.
- [ ] Existing non-Fatman project usage rows remain unchanged.
- [ ] Existing v1 client mapping continues to resolve.

### Runtime security

- [ ] Identity is read only from trusted `ctx.props.applicationEnvironmentId`.
- [ ] No request-body field can override application or environment identity.
- [ ] An invalid v2 environment identity does not fall back to a co-present v1 identity.
- [ ] Inactive/revoked app or environment is denied.
- [ ] A project ID without an active application-project grant is denied before search and quota reservation.
- [ ] A project inactive at request time is denied.
- [ ] Source-level direct and collection grants still apply after app-level permission.
- [ ] Search is filtered to D1-derived safe prefixes before retrieval.
- [ ] Every returned key is checked against the authorised source list.
- [ ] No cross-project/global fallback exists.

### Fatman and consumer isolation

- [ ] Parmar AI v1 continues to work during M1.
- [ ] Fatman's `fatman_search_usage` history is preserved.
- [ ] Fatman's original 538-page book and grants remain intact.
- [ ] Rain Gardens or any other ungranted test book is not exposed to Fatman.
- [ ] AskMoina retains its own D1, auth, model generation, voice/video continuity and user memory.
- [ ] AskMoina receives only BRVIN passages and provenance through its server-side tool handler.

### Production and rollback

- [ ] `brvin-service` remains private with no public route and `workers_dev: false`.
- [ ] Shared AI Search namespace and instance remain unchanged.
- [ ] Both Worker configs dry-run before deployment.
- [ ] Existing paired deployment captures both rollback version IDs.
- [ ] Deployment manifest records source SHA and both Worker versions.
- [ ] Synthetic permission and end-user acceptance passes before release completion.

## 10. Explicit non-decisions / deferred scope

- No public or cross-account API gateway in Milestones 0–8.
- No per-project D1 database or AI Search instance.
- No per-app ingestion pipeline.
- No universal arbitrary-repository code injection.
- No BRVIN-owned Gemini/LLM response generation.
- No consumer access to BRVIN D1, GCS or AI Search directly.
- No schema cleanup of legacy `brvin_service_clients` until all legacy consumers are migrated and a later removal milestone is explicitly approved.
- No rename of legacy Fatman importer modules merely for aesthetics.
- No per-environment project permission model in the first delivery.

## 11. Current evidence baseline used to make these decisions

Read-only evidence inspected on 4 November 2026:

- `main` was at `a16a9273d581d9dd5acfc3c53c3cc1f2cba819fd`, four commits ahead of planning baseline `939a6046f2a6fa461898f2479e6ed22923e3f3f9`. Those commits add the plan and navigation links; they do not implement the new registry.
- Current D1 schema contains `brvin_projects`, `brvin_service_clients`, book/collection grant tables and usage tables; it does not yet contain application/environment/app-project tables.
- Current production projects and service-client mapping contain the Fatman project and `fatman → fatman` client only.
- Current source inventory contains the ready 538-page Fatman book and a ready three-page Rain Gardens test PDF. The only direct book grant is Fatman → the built-in 538-page Fatman source; the only collection grant is Fatman → Fatman Core. Rain Gardens is ready but unassigned, so Fatman cannot retrieve it.
- The shared AI Search stats endpoint reported 541 completed items and 50 errors whose provider message was `page_limit_reached: Free AI Search image processing is unavailable`. This is a pre-existing index diagnostic, not a BRVIN 2 change. Later end-to-end acceptance must reconcile the errors against expected text/page keys; do not infer that a source is complete solely from the instance-wide statistics.
- November 2026 Fatman usage contains 20 queries in `fatman_search_usage`; the new design does not migrate or reset it.
- Live `parmar-ai` has a `BRVIN_SERVICE` Service Binding to `brvin-service`; its config uses `props.clientId='fatman'`.
- Live `brvin-service` has the same D1 binding and the shared `default` AI Search namespace/instance `fatman-2026-8b183803`. The instance has existing indexed content; do not re-create or reconfigure it for BRVIN 2.
- The current private service code resolves a project from `brvin_service_clients` and does not yet resolve application/environment/project grants.
- AskMoina's Wrangler config uses its own `askmoina-prod` and `askmoina-preview` D1 databases and does not yet contain `BRVIN_SERVICE`. Its production Worker is separate and must be integrated through the private binding only.

This ADR does not claim production acceptance or implementation. It freezes the target design for review before Milestone 1 changes D1.


## ADR-012 — One-time private proof for live application connection verification

**Status:** Accepted for M9 implementation; PR validation passed; production acceptance pending. PR #98 GitHub Release Validation #726 passed typecheck, unit/Node tests and both Worker bundle dry-runs. A separate Cloudflare Workers Builds preview check failed on the account Free-plan 100 Durable Object namespace limit (code 10067); no preview deployment or production deployment succeeded.  
**Date:** 5 November 2026.  
**Scope:** M9 same-account Cloudflare Worker connection proof only.

### Context

A registered application/environment row and a successful status request made by another Worker do not prove that the registered consumer deployment has the expected trusted Service Binding identity. M9 needs a verifiable success/failure result without exposing source text, making `brvin-service` public, trusting a browser boolean or placing a shared master credential in the consumer.

### Decision

Use an administrator-authorized, short-lived, single-use challenge with a proof minted only inside the private BRVIN service.

1. The existing protected `/admin/brvin` UI asks the main Worker to create a challenge for one active application environment. The challenge stores the environment ID, a SHA-256 nonce hash, status, creation time and a two-minute expiry in additive D1 table `brvin_connection_checks`.
2. The admin UI posts only the challenge ID and raw random nonce to the registered consumer Worker at `POST /brvin/connection-probe`. `OPTIONS` supports browser CORS with no cookies or credentials. This endpoint is content-free and exists on the consumer Worker, never on `brvin-service`.
3. The consumer endpoint validates the input shape and invokes `BRVIN_SERVICE.proveConnectionV2({ challengeId, nonce })`.
4. The private `BrvinRetrievalApi` resolves identity only from `this.ctx.props.applicationEnvironmentId`. It checks that the challenge belongs to this exact active environment and application, is pending and unexpired, and that the nonce hash matches.
5. The service computes the current ready-source count from the app's authorized project list, mints 32 random bytes as a proof, persists only the proof hash and readiness snapshot, and conditionally transitions the challenge from `pending` to `proof_issued`.
6. The consumer endpoint returns only the proof. The admin browser relays it to the authenticated, same-origin finalization endpoint. The finalizer verifies the stored proof hash, checks that the application/environment did not change or become inactive, and atomically consumes the proof as `connected`.
7. Failures are recorded with bounded codes only. The UI distinguishes `Pending`, `Connected`, `Connected — no ready knowledge`, `Verification failed`, `Disabled` and `Revoked`.

### Security properties

- No environment ID, application ID, project ID or source scope is trusted from the consumer request. The consumer's v2 identity comes from Service Binding props.
- The admin API that creates/finalizes a challenge remains behind the existing administrator session and same-origin POST check.
- A random 256-bit nonce expires in two minutes and is accepted only for its one environment. Proof issuance uses a conditional status transition; a replay cannot mint a second proof.
- A random 256-bit proof is generated by the private service. Only its SHA-256 hash is stored. The administrator finalizer uses constant-time hash comparison and a conditional one-use finalization.
- The browser cannot submit readiness or source count. The private service stores these values when it issues the proof.
- The consumer probe uses no cookies, shared master secret, BRVIN D1 binding, AI Search binding, provider API token or source access. It returns only a one-time proof.
- The probe is not a retrieval endpoint. It never exposes passages, OCR, page images or project/source identifiers.
- `brvin-service` remains private, with `workers_dev: false`, no public route and an HTTP 404 default handler.

### Consequences and limitations

- The admin browser must be able to reach the consumer Worker's saved HTTPS origin; the admin UI requires this non-secret metadata to be present.
- A CORS preflight is required for cross-origin consumers. The probe response does not use credentialed CORS; the random challenge is the scoped one-time capability and the private service still validates identity.
- This verifies the private Service Binding and its trusted environment identity, not the consumer's end-user login, model/tool wiring, or per-teacher user-to-project policy. Those remain M10/M11 acceptance items.
- The first release must prove the flow against a real deployed consumer Worker before M9 is marked complete.
