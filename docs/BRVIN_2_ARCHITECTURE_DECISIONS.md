# BRVIN 2 — Architecture Decision Record

**ADR:** BRVIN2-001  
**Status:** Proposed for review  
**Date:** 4 November 2026  
**Scope:** Milestones 0–8  
**Owning repository:** `ashini-x/parmar-ai`  
**First additional consumer:** `ashini-x/askmoina-voice`

This ADR freezes the target model for BRVIN 2. It is a design decision document, not evidence that the schema, RPC v2 or consumer integrations have been implemented. Production remains on the current legacy contract until the later implementation milestones.

## 1. Decision summary

BRVIN 2 will introduce three additive D1 entities:

1. `brvin_applications` — the software product connected to BRVIN.
2. `brvin_application_environments` — a trusted deployment identity for one application environment.
3. `brvin_application_project_grants` — an explicit permission for an application to retrieve one project.

The private retrieval Worker will resolve its caller from the Service Binding's deployment-controlled `ctx.props.applicationEnvironmentId`. A request's `projectId` selects a requested project; it never authenticates or authorises that project. Every v2 request must resolve the environment, verify the application and environment are active, verify the exact application-project grant, verify the project is active, then resolve only that project's ready and fully indexed direct/collection-granted sources.

The existing `brvin_service_clients` mapping and v1 methods remain supported during migration. They are not reinterpreted as application records and are not deleted in Milestone 1. The Fatman `fatman_search_usage` counter, source rows, project grants, collections, page keys and shared AI Search resource remain intact.

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

If an environment ID is present but malformed, revoked, unknown or inactive, the request fails closed. It must not fall back to a simultaneously present legacy `clientId`. The legacy path is used only when the environment ID is absent and the caller invokes the explicitly legacy v1 method. There is no request-body override for either identity.

### ADR-010 — Do not silently alter a consumer's production deployment

First-time app onboarding is a reviewed integration workflow: explicit GitHub and Cloudflare authorisation, repository/branch and Worker discovery, same-account check, proposed binding and typed adapter changes, a GitHub PR, checks, admin review/approval, then the app's existing deployment mechanism. No silent merge, production push or deployment. Additional projects under an already-connected app are BRVIN D1/admin operations and do not create app PRs or redeploy the consumer.

## 3. D1 data model — exact target schema

The following DDL is the Milestone 1 target. It is intentionally additive and uses the existing D1 database. IDs are generated by the BRVIN server with `crypto.randomUUID()`, except the three deterministic seed IDs reserved by the one-time compatibility migration below.

```sql
CREATE TABLE IF NOT EXISTS brvin_applications (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
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
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL
    REFERENCES brvin_applications(id) ON DELETE RESTRICT,
  environment_key TEXT NOT NULL,
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
  id TEXT PRIMARY KEY,
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

The normative TypeScript contract is in [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md). The public method surface is:

- `listAuthorizedProjects()` — list only active projects granted to the authenticated application.
- `getProjectStatus({ projectId })` — readiness for one project after application authorisation.
- `retrieveProjectContext({ projectId, queries, pageNumbers? })` — bounded semantic and exact-page retrieval from that project's ready sources.

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

### Recurring project administration

After an application is connected, a BRVIN administrator can create a project, select an already-connected application, grant the application access, upload and organise PDFs, assign book/collection source permissions, test retrieval, then activate or revoke access. IDs and slugs are generated by BRVIN.

Creating another project must not create a new Service Binding, edit Wrangler, open a GitHub PR or redeploy the connected app.

### First-time application connection

The first connection is a controlled developer workflow:

1. Admin explicitly authorises GitHub and selects repository and branch.
2. Admin explicitly authorises Cloudflare.
3. BRVIN discovers the Cloudflare account, target Worker and deployment environment, then verifies that the target Worker and private BRVIN service are in the same account.
4. BRVIN creates the application and environment identity.
5. A supported adapter template prepares the Service Binding and application-side tool integration.
6. BRVIN creates a branch and pull request with the generated source/config changes and tests.
7. Existing CI validates the PR. The administrator/maintainer reviews and approves it.
8. The application's existing production pipeline performs deployment.
9. BRVIN verifies the actual live Service Binding/RPC connection and displays connection health.

Use least-privilege OAuth scopes, short-lived access, secure server-side token handling and audit events. Do not ask for tokens in chat or commit secrets. Do not claim arbitrary repositories can be integrated automatically; support known templates and report unsupported architectures clearly. The wizard never silently merges or deploys.

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
- Current source inventory contains the ready 538-page Fatman book and a ready three-page Rain Gardens test PDF. Existing grant counts and source resolver behavior preserve project-level separation; the Rain Gardens book is not granted to Fatman.
- November 2026 Fatman usage contains 20 queries in `fatman_search_usage`; the new design does not migrate or reset it.
- Live `parmar-ai` has a `BRVIN_SERVICE` Service Binding to `brvin-service`; its config uses `props.clientId='fatman'`.
- Live `brvin-service` has the same D1 binding and the shared `default` AI Search namespace/instance `fatman-2026-8b183803`. The instance has existing indexed content; do not re-create or reconfigure it for BRVIN 2.
- The current private service code resolves a project from `brvin_service_clients` and does not yet resolve application/environment/project grants.
- AskMoina's Wrangler config uses its own `askmoina-prod` and `askmoina-preview` D1 databases and does not yet contain `BRVIN_SERVICE`. Its production Worker is separate and must be integrated through the private binding only.

This ADR does not claim production acceptance or implementation. It freezes the target design for review before Milestone 1 changes D1.
