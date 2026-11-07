# BRVIN Private Retrieval RPC v2 — Frozen Contract

**Contract status:** Implemented and deployed; current contract for new consumers  
**ADR:** [BRVIN 2 Architecture Decision Record](BRVIN_2_ARCHITECTURE_DECISIONS.md)  
**Existing contract:** [BRVIN Private Retrieval API v1](BRVIN_PRIVATE_RETRIEVAL_API.md)

This document specifies the versioned private WorkerEntrypoint v2 contract implemented in `src/brvin/service-worker.ts` and `src/brvin/service-core.ts`. Retrieval methods preserve v1 compatibility and use only `ctx.props.applicationEnvironmentId` for v2. The live connection-verification extension adds the probe-only `proveConnectionV2` method; it is not a retrieval method and is not part of the consumer retrieval connector.

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

Identity selection is explicit and method-versioned:

1. The v2 methods resolve only `ctx.props.applicationEnvironmentId` through the application/environment registry. A missing, malformed, unknown or inactive environment ID returns a non-retryable v2 identity failure. A v2 failure never falls back to `clientId`.
2. The legacy v1 methods resolve only `ctx.props.clientId` through `brvin_service_clients`. They remain available for consumers that still call the v1 methods.
3. The method name selects the protocol version. If both props are temporarily present during a controlled migration, a v1 method still resolves only `clientId`, while a v2 method resolves only `applicationEnvironmentId`; neither method silently switches versions.
4. Request input never overrides `ctx.props`. A project ID is only a selector to be checked against an active application-project grant.

## 2. Shared TypeScript types

The names and semantics below are the frozen target contract for Milestone 2.

```ts
export interface BrvinProjectSelector {
  /** Existing BRVIN project identifier; opaque selector, not proof of permission. */
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

- Validate that `projectId` is a non-empty string of at most 128 characters, has no NUL byte and is not padded with leading/trailing whitespace. Do not require UUID syntax; preserve legacy IDs such as `fatman`.
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

- `projectId` must be a non-empty BRVIN project identifier of at most 128 characters. Treat it as opaque: the existing Fatman project ID is the literal string `fatman`, while newly provisioned project IDs are UUIDs. Do not coerce, regenerate or validate it as UUID-only.
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

Exact-page retrieval remains part of `retrieveProjectContextV2` through `pageNumbers`; it does not need a separate public method for the initial delivery.

- Resolve only the project's current ready source list.
- Construct candidate item keys only beneath D1-authorised source prefixes.
- Validate the exact returned key, source, page number, item state and bounded download size.
- Preserve `pdfPage`, book ID/title, and optional printed-page/section metadata.
- If the exact page is absent and a textual query exists, semantic retrieval may run within the same already-authorised source set.
- A page-only request with no exact indexed item returns successful empty results.
- Never search arbitrary keys or folders based on request input.

### 3.5 `proveConnectionV2({ challengeId, nonce })`

**Purpose:** issue a one-time proof that the deployed consumer Worker reached the private BRVIN service using the trusted environment identity passed through its Service Binding.

Input:

```ts
{ challengeId: string; nonce: string }
```

Success data:

```ts
{
  challengeId: string;
  proof: string; // 32 random bytes encoded as 64 lowercase hex characters
  ready: boolean;
  authorizedSourceCount: number;
}
```

Rules:

- This method is only for the M9 connection-verification protocol. Do not expose it through the retrieval connector or a browser/mobile binding.
- The caller identity is resolved only from `ctx.props.applicationEnvironmentId`; no environment or application ID is accepted in the input.
- BRVIN admin creates a 2-minute challenge row with a cryptographically random nonce hash and one environment ID.
- The method requires that the caller's trusted environment matches the challenge's environment, and that the application, environment and pending challenge are active/unexpired.
- The nonce is SHA-256 checked. The method calculates current ready-authorised source counts through the same project discovery/status resolver.
- A proof is minted with cryptographically secure randomness. Only its SHA-256 hash is persisted. A conditional D1 update changes `pending` to `proof_issued`; a second call cannot issue another proof.
- The admin finalizer verifies the proof hash, verifies the environment is still active and consumes the challenge. Browser-supplied readiness/source-count fields are ignored.
- No passage, OCR, source ID, source title, file URL, credential or provider token is returned.

The consumer's public `POST /brvin/connection-probe` endpoint accepts only `challengeId` and `nonce`, invokes this private method, and returns only the proof. Its `OPTIONS` response supports browser CORS without cookies or credentials. The BRVIN retrieval Worker itself remains private and returns HTTP 404 to ordinary HTTP requests.

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

- Add the exact retrieval v2 methods `listAuthorizedProjectsV2()`, `getProjectStatusV2(input)` and `retrieveProjectContextV2(input)` to the existing `BrvinRetrievalApi` entrypoint; do not create a public URL.
- The probe-only `proveConnectionV2(input)` method may be called only from a consumer Worker using its trusted Service Binding. It does not return passages and is not exposed as HTTP on `brvin-service`.
- Preserve v1 `getProjectStatus()` and `retrieveProjectContext(input)` semantics for the legacy `clientId` identity during migration.
- Do not make v1 methods accept a project selector; v1 remains bound to one project.
- V2 methods require a project selector and perform an application-project grant check on every call.
- Do not remove `brvin_service_clients` or v1 methods until every consumer has migrated and a separately reviewed compatibility-removal milestone is approved.
- A v2 identity resolution failure is terminal for that call. No global search, v1 downgrade or alternate project lookup is allowed.

## 8. Required tests

### Identity resolution
- Active environment + active app resolves the correct app.
- Existing project identifier `fatman` remains valid as a v2 selector and maps to the same legacy project row.
- Unknown, malformed, disabled and revoked environment IDs fail closed.
- Suspended/revoked application fails closed.
- A co-present legacy `clientId` does not rescue an invalid v2 environment ID, and v2 methods never downgrade to v1.
- A request body containing `clientId`, `applicationEnvironmentId` or another project ID cannot change caller identity.

### Project authorisation
- Granted project succeeds.
- Same app with a second granted project succeeds.
- Project shared to a second app succeeds only for that second app after a separate grant.
- Unshared project, revoked grant, unknown project and inactive project fail before quota reservation and before AI Search.
- Opaque non-UUID project identifiers remain supported for existing legacy project rows; malformed/oversized values fail validation.
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

## 9. Implementation and production status

Implemented and deployed on 4 November 2026 through PR #62, merge commit `3b68aaecf3c78c712e1a1c978285ad1f166d15c4`.

- Release Validation run #596 passed TypeScript, unit tests, Node tests, and dry-runs for both private BRVIN and Parmar AI Worker bundles on the final implementation/test commit.
- Active production Worker versions: `brvin-service` `0adea40e-2a7f-4109-b534-c90a23c3a2fe` and `parmar-ai` `ed90e0be-0606-47f6-8d05-847f2596e03f`, each at 100% traffic.
- Parmar AI's production binding includes both the legacy `clientId` and the seeded `applicationEnvironmentId`. Health probes call both v1 and v2 status and require authorised source parity; production smoke acceptance uses the same check.
- The v2 implementation performs project grants and source filtering on every request. It does not introduce a public endpoint or unrestricted fallback.
- Consumer retrieval remains v1 until the connector and app-specific migration milestones. AskMoina has not yet been connected.
- The post-deployment D1 audit found no foreign-key violations and confirmed Fatman's original mapping, project, ready 538-page book, direct/collection grants, and November 2026 usage counter were preserved.



## 10. Separate BRVIN Teachers management capability (not part of v2)

Administrative project/collection/source lifecycle operations are deliberately **not** added to `BrvinRetrievalApi` or this frozen v2 contract. PR #107 added a separate named `BrvinTeachersManagementApi` WorkerEntrypoint on the existing `parmar-ai` Worker; it is deployed through Core release [#42171109140](https://github.com/ashini-x/parmar-ai/actions/runs/42171109140). It is consumed through an explicit same-account Service Binding and deployment-controlled `applicationEnvironmentId` props. It validates the active registered `brvin-teachers` application/environment and Worker name before management operations.

Its methods create/list teacher-owned projects and collections; share/revoke collections; list sources; and route PDF upload chunks and lifecycle through the existing private GCS, Vision OCR and Workflow pipeline. Core owns external tenant-reference metadata and hierarchical project/collection/source references. It does not duplicate ingestion or change v2 retrieval authorisation, grants, quota, request/response shapes or the `brvin-service` deployment.

The management entrypoint is not a public REST endpoint. It does not return GCS upload session URIs or provider credentials. BRVIN Teachers does not access Core D1, GCS or AI Search directly. Its `BRVIN_MANAGEMENT` and `BRVIN_SERVICE` consumer Service Bindings are deployed with the generated active Production environment identity. BRVIN Admin accepted the one-time private retrieval proof on 6 November 2026; the registry reports the environment active and the latest proof `connected`. The real Physics source has been created but is failed with 0/3 indexed pages because the first Vision output object is missing; retrieval and post-revocation acceptance remain open, and no student-facing runtime is implemented. See [ADR-014](BRVIN_2_ARCHITECTURE_DECISIONS.md#adr-014--separate-private-brvin-teachers-management-entrypoint) and [BRVIN Teachers architecture](BRVIN_TEACHERS_ARCHITECTURE.md#16-brvin-teachers-management-entrypoint--separate-from-retrieval-v2).
