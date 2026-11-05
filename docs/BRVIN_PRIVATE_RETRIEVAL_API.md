# BRVIN Private Retrieval API

**Contract status:** legacy v1 compatibility contract; still implemented for existing consumers  

**Implementation:** `src/brvin/service-worker.ts`, `src/brvin/service-core.ts`, `src/brvin/retrieval.ts`

This document describes the internal WorkerEntrypoint RPC contract. It is not a public HTTP API specification.

> **Version boundary:** This is the legacy v1 contract for existing consumers only. New consumer integrations must use v2. This page documents the implemented v1 methods. The additional v2 methods are now also implemented and deployed; see [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md) for their trusted application/environment identity and project-grant contract. Parmar AI's live health check exercises both versions, but Fatman end-user retrieval remains on v1 until connector/consumer migration.

Do not use this document as the onboarding contract for a new application. New integrations start from [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md) and [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md).

For the complete system design, see [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md). For onboarding a consumer Worker, see [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md). For admin and production procedures, see [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md).

## 1. Service identity and deployment boundary

The private Worker is named `brvin-service`. It is deployed with `wrangler.brvin.jsonc`, `workers_dev: false`, and no public route. Its default `fetch()` handler returns HTTP 404.

Consumers in the same Cloudflare account call the named RPC entrypoint through a Service Binding:

- Service name: `brvin-service`
- Entrypoint: `BrvinRetrievalApi`
- Binding name in the consumer: `BRVIN_SERVICE`
- Trusted property: `props.clientId`

Example consumer binding:

~~~jsonc
{
  "services": [
    {
      "binding": "BRVIN_SERVICE",
      "service": "brvin-service",
      "entrypoint": "BrvinRetrievalApi",
      "props": {
        "clientId": "fatman"
      }
    }
  ]
}
~~~

The example uses Fatman's current identity. Replace it with the slug generated for the consumer project.

Cloudflare Service Binding RPC is an internal same-account Worker-to-Worker mechanism. See the official [Service Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) and [RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/) documentation.

## 2. Trust model

The entrypoint extends `WorkerEntrypoint`. The v1 methods documented on this page read the caller identity from `this.ctx.props.clientId`; the separately versioned v2 methods read only `this.ctx.props.applicationEnvironmentId`. Neither path accepts caller identity from request data.

The caller cannot choose a v1 project by including a client ID or project ID in the method input. The v1 identity is supplied by the consumer Worker's deployed Service Binding configuration and mapped through D1 table `brvin_service_clients`. V2's application identity and multi-project authorization are specified separately in the v2 contract.

This value is a trusted configuration identity, not an API key or bearer secret. Its trust comes from who can modify/deploy the Worker configuration. Do not expose a consumer-controlled public proxy that allows arbitrary clients to choose this property.

Resolution requires:
1. syntactically valid client ID;
2. registered client mapping;
3. active mapped project.

Failure to resolve returns `CLIENT_NOT_REGISTERED`. It does not perform a search.

## 3. Method: `getProjectStatus()`

### Purpose

Check the caller's registered project identity and calculate the number of currently authorised ready sources.

### Input

No parameters.

### Success response

~~~ts
{
  ok: true;
  ready: boolean;
  authorizedSourceCount: number;
}
~~~

Example:

~~~json
{
  "ok": true,
  "ready": true,
  "authorizedSourceCount": 1
}
~~~

### Failure response

~~~ts
{
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  userMessage?: string;
}
~~~

Expected failure codes include:
- `CLIENT_NOT_REGISTERED`: identity is unknown, invalid or belongs to an inactive project.
- `BRVIN_UNAVAILABLE`: the service could not safely complete the status lookup.

### Semantics

- Status is project-level connection/readiness information.
- It does not return document text.
- `ready: false` with `authorizedSourceCount: 0` means the caller may be registered but currently has no eligible source.
- A positive source count does not guarantee a particular query will produce passages.
- It does not consume a retrieval query allowance.

Use it for health checks and connection onboarding. A consumer does not need to call it before every retrieval request.

## 4. Method: `retrieveProjectContext(input)`

### Purpose

Retrieve relevant passages and optional exact-page images from the set of books currently authorised for the caller's project.

### Input

~~~ts
{
  queries?: unknown;
  pageNumbers?: unknown;
}
~~~

The TypeScript consumer binding should use the stricter shape:

~~~ts
{
  queries: string[];
  pageNumbers?: number[];
}
~~~

Validation and normalization:
- at least one non-empty query or valid page number is required;
- up to 3 unique queries are accepted;
- each query is normalized and bounded to 2,000 characters;
- up to 3 unique positive integer page numbers are accepted;
- page numbers must be no greater than 100,000;
- invalid/empty content is rejected rather than sent as an unrestricted search.

### Success response

~~~ts
{
  ok: true;
  passages: BrvinRemotePassage[];
  pageImages?: BrvinRemotePageImage[];
  searchedSources: number;
  searchCount: number;
}
~~~

Passage shape:

~~~ts
interface BrvinRemotePassage {
  id: string;
  bookId: string;
  bookTitle: string;
  pdfPage: number;
  printedPage?: string;
  section?: string;
  text: string;
  score: number;
}
~~~

Optional image shape:

~~~ts
interface BrvinRemotePageImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;       // base64
  byteLength: number;
}
~~~

Example:

~~~json
{
  "ok": true,
  "passages": [
    {
      "id": "item-17",
      "bookId": "book-uuid",
      "bookTitle": "Example reference",
      "pdfPage": 17,
      "printedPage": "12",
      "section": "Site selection",
      "text": "Retrieved and bounded passage...",
      "score": 0.74
    }
  ],
  "searchedSources": 1,
  "searchCount": 1
}
~~~

The printed page and section fields are optional. The PDF page is the stable page index in the original PDF and should be retained for citations. Do not silently replace it with a printed page number.

### Exact-page behavior

When page numbers are supplied, the service first attempts direct item lookup under the D1-authorised source prefixes. The candidate key, returned key, source prefix and parsed page number are validated.

If exact-page retrieval succeeds, it returns the page result without running semantic search. Therefore `searchCount` may be zero. If the exact-page path cannot find an item and a textual query is also supplied, the service may fall back to semantic retrieval within the same authorised source set. A page-only request without an exact result returns no passage.

Where a supported page image is present and within the byte limit, `pageImages` may be returned. Consumers should not assume that every exact page has an image.

## 5. Retrieval authorization and filtering

The service computes the effective source list from D1. A source must:

- belong to an active project;
- have `status = 'ready'`;
- have `indexed_pages = page_count`;
- have either a direct row in `brvin_project_books` or a collection grant in `brvin_project_collections`.

For each request the service then:

1. validates each D1-derived `search_prefix`;
2. applies an AI Search folder filter with only the authorised prefixes;
3. validates each returned key against the authorised prefix set;
4. parses the page key and checks the book identity/page fields;
5. applies the relevance threshold and bounded evidence selection.

No request parameter can supply an arbitrary folder prefix. No unknown or unauthorised source can be searched as a fallback.

## 6. Result limits and cost controls

Current implementation limits include:

| Control | Current behavior |
|---|---|
| Unique query variants | Maximum 3 |
| Explicit PDF page numbers | Maximum 3 |
| Query length | Maximum 2,000 characters after normalization |
| Candidate chunks | Up to 50 per query |
| Returned passages | Bounded to 8 |
| Passage text | Bounded excerpt size |
| Default minimum score | 0.2 |
| Monthly project query allowance | Configured at 800; code caps maximum at 800 |

A valid retrieval request reserves monthly usage in D1 before the retrieval operation. Fatman retains the legacy `fatman_search_usage` counter; other projects use `brvin_project_search_usage`.

The 800 allowance is not a per-user quota. Each consumer must enforce its own application/user quota and abuse controls.

## 7. Failure contract

All failures use the discriminated object:

~~~ts
interface BrvinServiceFailure {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  userMessage?: string;
}
~~~

Known codes include:

| Code | Meaning | Consumer behavior |
|---|---|---|
| `INVALID_REQUEST` | No usable query/page or invalid input shape | Fix the request; do not retry unchanged |
| `CLIENT_NOT_REGISTERED` | Trusted binding identity does not resolve to an active project | Fix BRVIN project/client mapping or props |
| `MONTHLY_LIMIT_REACHED` | Project monthly retrieval allowance is exhausted | Stop retrieval and show a quota-aware message |
| `RETRIEVAL_FAILED` | Retrieval failed; retryability indicates whether retry may help | Use bounded retry only when retryable |
| `BRVIN_UNAVAILABLE` | Service/D1/retrieval dependency could not be used | Degrade gracefully; no global search fallback |

Never interpret a failure as an empty successful search. Preserve the distinction between:
- successful retrieval with zero passages;
- access/registration denial;
- monthly quota exhaustion;
- transient service failure.

## 8. Type contract in the current consumer

The canonical TypeScript result and binding interfaces currently live in `src/config/env.ts`:

- `BrvinRemotePassage`
- `BrvinRemotePageImage`
- `BrvinServiceFailure`
- `BrvinServiceStatusResult`
- `BrvinServiceRetrievalResult`
- `BrvinServiceBinding`

A separate repository should reproduce the narrow public interface rather than depend on importing the full Parmar application environment.

## 9. Consumer responsibilities

BRVIN does not:
- decide when an application should retrieve;
- create the app's model tool declaration;
- call Gemini or another LLM;
- append passages to the app's conversation context;
- generate the final response;
- manage end-user application authentication, quotas or billing;
- render UI, audio or citations on the consumer's behalf.

The app must call the binding from server-side code, pass the returned evidence to its own model, preserve the book/page provenance, and handle service failures safely. Retrieved source text is evidence, not trusted executable instructions.

## 10. Current deployment and test references

- Private service config: `wrangler.brvin.jsonc`.
- Consumer config: `wrangler.jsonc`.
- Entry point: `src/brvin/service-worker.ts`.
- Core authorization/quota: `src/brvin/service-core.ts`.
- Source filtering and retrieval: `src/brvin/retrieval.ts`.
- Service tests: `test/brvin-service.test.ts`.
- Retrieval tests: `test/brvin.test.ts`.
- Release validation and deployment: `.github/workflows/release-validation.yml`.

The private service is deployed before `parmar-ai`; the existing release workflow captures both prior deployment versions, runs a BRVIN-backed production health check and maintains rollback paths.

## 11. Production acceptance criteria

1. `brvin-service` has no public route and `workers_dev` remains disabled.
2. The Fatman Service Binding uses the `fatman` client identity and resolves to active project Fatman.
3. An unknown caller fails closed without searching.
4. An inactive project fails closed.
5. A project with no ready/granted sources returns no passages and performs no search.
6. Search filters contain only D1-authorised folder prefixes.
7. Returned item keys are checked again against the D1-authorised set.
8. Direct book grants work.
9. Collection grants work.
10. Revoked grants stop appearing in later retrievals.
11. Exact-page retrieval preserves correct book and PDF page provenance.
12. Monthly quota exhaustion returns `MONTHLY_LIMIT_REACHED`.
13. Consumer service failures never fall back to unrestricted search.
14. Fatman's existing answer generation, Telegram queue/retry, Durable Object continuity and citation behavior remain unchanged.
15. Both Worker configs type-check/dry-run and production release manifests record both deployed versions.
