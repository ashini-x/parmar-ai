# BRVIN Private Retrieval RPC v2 — Frozen Contract

**Contract status:** Designed for Milestone 2; not implemented  
**ADR:** [BRVIN 2 Architecture Decision Record](BRVIN_2_ARCHITECTURE_DECISIONS.md)  
**Existing contract:** [BRVIN Private Retrieval API v1](BRVIN_PRIVATE_RETRIEVAL_API.md)

This document specifies the versioned private WorkerEntrypoint contract approved for BRVIN 2. It does not replace the current v1 contract until Milestone 2 is implemented and deployed.

## 1. Transport and identity

- Private Worker: `brvin-service`.
- Wrangler config: `wrangler.brvin.jsonc`.
- WorkerEntrypoint: `BrvinRetrievalApi`.
- Consumer binding: `BRVIN_SERVICE`.
- Transport: same-account Cloudflare Service Binding RPC.
- Public route: none. `workers_dev` remains false and the default HTTP handler remains 404.

V2 caller identity comes only from trusted deployment props:

```ts
export interface BrvinServiceProps {
  /** Immutable D1 ID of one application deployment environment. */
  applicationEnvironmentId?: string;

  /** Legacy v1 identity, retained during migration only. */
  clientId?: string;
}
```

`applicationEnvironmentId` must be looked up in `brvin_application_environments`, joined to `brvin_applications`, and both records must be active. The caller does not send this value to an RPC method.

Identity selection is explicit:

1. If `applicationEnvironmentId` is present, only v2 identity resolution is permitted. Invalid/unknown/inactive identity returns a non-retryable identity failure. Do not fall back to `clientId`.
2. If `applicationEnvironmentId` is absent, only the explicitly legacy v1 methods may resolve `clientId` through `brvin_service_clients`.
3. Request input never overrides `ctx.props`. A project UUID is only a selector to be checked against an active application-project grant.

A consumer binding can temporarily contain both properties for controlled migration, but this does not make the two identities interchangeable.

## 2. Shared TypeScript types

The exact names can be adjusted to match repository conventions during implementation, but the semantics and trust boundary must not change.

```ts
export interface BrvinProjectSelector {
  /** Existing BRVIN project UUID; selector, not proof of permission. */
  projectId: string;
}

export interface BrvinAuthorizedProject {
  projectId: string;
  slug: string;
  name: string;
  description: string;
  ready: boolean;
  authorizedSourceCount: number;
}

export interface BrvinV2Passage {
  id: string;
  bookId: string;
  bookTitle: string;
  pdfPage: number;
  printedPage?: string;
  section?: string;
  text: string;
  score: number;
}

export interface BrvinV2PageImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
  byteLength: number;
}

export interface BrvinV2Success<T> {
  ok: true;
  data: T;
}

export interface BrvinV2Failure {
  ok: false;
  code:
    | "INVALID_REQUEST"
    | "APPLICATION_NOT_REGISTERED"
    | "APPLICATION_INACTIVE"
    | "ENVIRONMENT_NOT_REGISTERED"
    | "ENVIRONMENT_INACTIVE"
    | "PROJECT_NOT_AUTHORIZED"
    | "PROJECT_INACTIVE"
    | "MONTHLY_LIMIT_REACHED"
    | "RETRIEVAL_FAILED"
    | "BRVIN_UNAVAILABLE";
  message: string;
  retryable: boolean;
  userMessage?: string;
  requestId?: string;
}

export type BrvinV2Result<T> = BrvinV2Success<T> | BrvinV2Failure;

export interface BrvinV2RetrievalInput extends BrvinProjectSelector {
  queries: string[];
  pageNumbers?: number[];
  /** Optional consumer-generated correlation ID; never an identity or permission. */
  requestId?: string;
}

export interface BrvinV2RetrievalData {
  passages: BrvinV2Passage[];
  pageImages?: BrvinV2PageImage[];
  searchedSources: number;
  searchCount: number;
}
```

The connector must use its own strict input types and must not expose `unknown`-typed RPC inputs to application code.

## 3. RPC methods

### 3.1 `listAuthorizedProjectsV2()`

**Purpose:** Let the trusted application discover the active projects it has been granted.

Input: none.

Success data:

```ts
BrvinV2AuthorizedProject[]
```

Rules:

- Resolve and validate the trusted environment and parent application first.
- Return only projects with an active `brvin_application_project_grants` row and active project status.
- Calculate source readiness from current D1 book and collection grants. `ready` is true only when at least one fully indexed ready source is available.
- Return metadata and counts only. Do not return source text, OCR, PDF URLs, private storage paths or grants for any other application.
- Sort deterministically by project name then project ID.
- An application with no grants receives an empty successful list, not a global list.
- The method does not reserve retrieval quota.

### 3.2 `getProjectStatusV2({ projectId })`

**Purpose:** Check whether one requested project is active and currently has ready authorised sources for this application.

Input:

```ts
{ projectId: string }
```

Success data:

```ts
{
  projectId: string;
  ready: boolean;
  authorizedSourceCount: number;
}
```

Rules:

- Validate the project UUID format and length.
- Resolve the environment/application.
- Verify the active application-project grant and active project.
- Return `PROJECT_NOT_AUTHORIZED` for an unknown project or missing/revoked grant; do not allow this method to enumerate other applications' project IDs.
- A valid authorised project with no ready source returns success with `ready: false` and zero count.
- Does not reserve retrieval quota.

### 3.3 `retrieveProjectContextV2(input)`

**Purpose:** Return bounded evidence for one project, with the existing BRVIN source and page validation semantics.

Input:

```ts
{
  projectId: string;
  queries: string[];
  pageNumbers?: number[];
  requestId?: string;
}
```

Success data:

```ts
{
  passages: BrvinV2Passage[];
  pageImages?: BrvinV2PageImage[];
  searchedSources: number;
  searchCount: number;
}
```

Validation and bounds:

- `projectId` must be a valid UUID-shaped BRVIN project identifier.
- At least one usable query or valid page number is required.
- Accept at most 3 unique query variants, each normalized and bounded to 2,000 characters.
- Accept at most 3 unique positive integer page numbers.
- Keep current bounded result count, passage length and image byte limits; do not loosen them during the RPC identity change.
- Reject malformed input rather than interpreting it as an empty query or unrestricted search.
- Keep PDF page as the stable physical PDF page reference. Preserve optional printed page and section separately.

Processing order is mandatory:

1. Validate input shape and bounds.
2. Resolve trusted environment identity from `ctx.props.applicationEnvironmentId`.
3. Confirm environment and application are active.
4. Resolve `projectId` and verify the active application-project grant and active project.
5. Resolve ready, fully indexed books from the existing direct-book and collection grants.
6. If no sources are authorised, return successful empty evidence and do not reserve quota or search.
7. Reserve the existing project-level quota. Fatman continues to use `fatman_search_usage`; other projects use `brvin_project_search_usage`.
8. Validate D1-derived search prefixes.
9. Apply only those prefixes to AI Search folder filters.
10. Validate every returned result key and parsed page against the same authorised source list.
11. Return bounded evidence with book and PDF page provenance.

Do not reserve quota for an unknown application, inactive environment, denied project or empty source set. A valid authorised retrieval attempt continues to consume quota under the existing policy, including a valid exact-page request that returns no item, consistent with current v1 semantics.

### 3.4 Exact-page retrieval

Exact-page retrieval remains part of `retrieveProjectContext` through `pageNumbers`; it does not need a separate public method for the initial delivery.

- Resolve only the project's current ready source list.
- Construct candidate item keys only beneath D1-authorised source prefixes.
- Validate the exact returned key, source, page number, item state and bounded download size.
- Preserve `pdfPage`, book ID/title, and optional printed-page/section metadata.
- If the exact page is absent and a textual query exists, semantic retrieval may run within the same already-authorised source set.
- A page-only request with no exact indexed item returns successful empty results.
- Never search arbitrary keys or folders based on request input.

## 4. Failure contract

All v2 failures use:

```ts
{
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  userMessage?: string;
  requestId?: string;
}
```

| Code | Condition | Retryable | Required behavior |
|---|---|---:|---|
| `INVALID_REQUEST` | Invalid shape, malformed project selector or no usable query/page | No | Caller corrects input |
| `APPLICATION_NOT_REGISTERED` | Environment identity cannot be resolved to an application | No | Fail closed; operator fixes deployment registration |
| `APPLICATION_INACTIVE` | Application is suspended or revoked | No | Stop retrieval |
| `ENVIRONMENT_NOT_REGISTERED` | Trusted environment ID does not exist | No | Fail closed |
| `ENVIRONMENT_INACTIVE` | Environment is disabled or revoked | No | Stop retrieval |
| `PROJECT_NOT_AUTHORIZED` | Project unknown to this app or no active grant | No | Do not search; do not expose whether another app owns it |
| `PROJECT_INACTIVE` | App grant exists but project is inactive | No | Stop retrieval |
| `MONTHLY_LIMIT_REACHED` | Existing per-project allowance exhausted | No | Show quota-aware response |
| `RETRIEVAL_FAILED` | AI Search or exact-page retrieval failed | As classified | Bounded retry only when true |
| `BRVIN_UNAVAILABLE` | D1/service dependency unavailable | Yes | Graceful fallback in consumer; never global search |

Return the same externally visible `PROJECT_NOT_AUTHORIZED` response for an unknown project and a missing/revoked app grant, preventing a project-ID enumeration oracle. Keep internal logs structured and avoid logging passage text.

## 5. Quota and audit behavior

- The monthly quota key remains the BRVIN project, not the application. If two apps share one project, they share its monthly allowance.
- Fatman's legacy `fatman_search_usage` rows and counter semantics remain unchanged.
- Non-Fatman projects continue to use `brvin_project_search_usage`.
- The consumer app continues to enforce per-user and per-workspace limits.
- Every successful or denied v2 RPC should have structured correlation logging with application ID, environment ID, project ID if valid, method, outcome code, query count, source count and latency.
- Do not log raw user questions, retrieved text, access tokens, cookies, PDF data or OCR payloads.
- Use the existing `brvin_activity_events` audit/event mechanism for administrative grant, revoke, activation and deactivation operations. The implementation may add a structured application/environment reference to event detail JSON; do not overload the existing `project_id` column with an application ID.

## 6. Typed consumer binding shape

The connector's local Cloudflare binding interface is:

```ts
export interface BrvinServiceV2Binding {
  listAuthorizedProjectsV2(): Promise<BrvinV2Result<BrvinAuthorizedProject[]>>;
  getProjectStatusV2(
    input: BrvinProjectSelector,
  ): Promise<BrvinV2Result<{
    projectId: string;
    ready: boolean;
    authorizedSourceCount: number;
  }>>;
  retrieveProjectContextV2(
    input: BrvinV2RetrievalInput,
  ): Promise<BrvinV2Result<BrvinV2RetrievalData>>;
}
```

Keep the legacy v1 interface and methods during the staged migration. Consumer code should use the v2 connector type for new integrations and must not call the raw Worker binding from browser/mobile code.

Example binding props after the relevant milestone:

```jsonc
{
  "services": [
    {
      "binding": "BRVIN_SERVICE",
      "service": "brvin-service",
      "entrypoint": "BrvinRetrievalApi",
      "props": {
        "applicationEnvironmentId": "<generated-environment-uuid>"
      }
    }
  ]
}
```

The placeholder above is illustrative only; the admin must read the generated ID from BRVIN and the deployment configuration must be reviewed. Never copy a fabricated ID into a real Worker.

## 7. Versioning and compatibility

- Add v2 methods to the existing `BrvinRetrievalApi` entrypoint; do not create a public URL.
- Preserve v1 `getProjectStatus()` and `retrieveProjectContextV2(input)` semantics for the legacy `clientId` identity during migration. If a method-name collision occurs in TypeScript/RPC, use explicitly versioned method names such as `getProjectStatusV2`, `listAuthorizedProjectsV2`, and `retrieveProjectContextV2`; freeze the final method names in Milestone 2 code before consumer migration.
- Do not make v1 methods accept a project selector; v1 remains bound to one project.
- V2 methods require a project selector and perform an application-project grant check on every call.
- Do not remove `brvin_service_clients` or v1 methods until every consumer has migrated and a separately reviewed compatibility-removal milestone is approved.
- A v2 identity resolution failure is terminal for that call. No global search, v1 downgrade or alternate project lookup is allowed.

## 8. Required tests

### Identity resolution
- Active environment + active app resolves the correct app.
- Unknown, malformed, disabled and revoked environment IDs fail closed.
- Suspended/revoked application fails closed.
- A co-present legacy `clientId` does not rescue an invalid v2 environment ID.
- A request body containing `clientId`, `applicationEnvironmentId` or another project ID cannot change caller identity.

### Project authorisation
- Granted project succeeds.
- Same app with a second granted project succeeds.
- Project shared to a second app succeeds only for that second app after a separate grant.
- Unshared project, revoked grant, unknown project and inactive project fail before quota reservation and before AI Search.
- Revoking or deactivating a grant affects the next request; no permission cache may outlive the request.
- App with no grants lists an empty project collection.

### Source and retrieval
- Direct book and collection grants both work.
- Unready, partially indexed and archived sources are excluded.
- No sources returns an empty success with no search.
- Search prefilter contains only D1-authorised prefixes.
- Returned foreign/unknown item keys are rejected after search.
- Exact-page paths validate key, book and PDF page; scanned images remain bounded.
- No unrestricted fallback under any failure.

### Quotas and compatibility
- Fatman uses its original `fatman_search_usage` row and cannot reset through migration.
- Other projects use the existing project usage table.
- Two apps granted to one project share its project quota.
- Valid exact-page lookup uses quota under the existing v1 policy.
- Legacy Fatman v1 status and retrieval remain unchanged while v2 methods are added.

## 9. Implementation boundary

This is the frozen contract for Milestone 2. Milestone 0 only documents it. No D1 schema, Worker code, Service Binding, AI Search resource, secret or production deployment was changed while preparing this contract.
