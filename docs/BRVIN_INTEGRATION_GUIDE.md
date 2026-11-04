# BRVIN Application Integration Guide

> **Version boundary:** This guide describes the current v1 integration path. BRVIN 2's proposed app/environment/project-grant model and RPC v2 contract are documented in [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md) and [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md). Do not configure a production consumer with the proposed v2 contract until Milestones 1–2 are implemented, tested and deployed.

This guide explains how to connect an application to the existing private BRVIN retrieval service. It is written for engineers implementing a consumer app and administrators provisioning its project.

For the full architecture, data model, security boundaries and current deployment map, start with [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md). For operations, see [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md).

## 1. First decide which connection model applies

| Consumer type | Supported today? | Connection method |
|---|---|---|
| Cloudflare Worker in the same Cloudflare account as BRVIN | Yes | Private Service Binding RPC |
| Cloudflare Worker in a different Cloudflare account | Not directly | Requires a future authenticated HTTPS gateway |
| Server outside Cloudflare | Not directly | Requires a future authenticated HTTPS gateway or another approved adapter |
| Consumer app with no server-side code/tool handler | Not automatically | Needs a prebuilt adapter or integration work before it can use retrieval |

The current BRVIN Worker is intentionally private. Do not turn on a public route to make an integration easier.

Cloudflare references:
- [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Service Binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Worker context and props](https://developers.cloudflare.com/workers/runtime-apis/context/)

## 2. What the administrator does

### Step 1 — Create the BRVIN project

Open the protected Parmar admin BRVIN workspace at `/admin/brvin`, open Governance, and create the application project.

The backend automatically creates:

- an internal UUID for the project;
- a normalized, unique slug;
- a default service client mapping whose `client_id` equals that slug.

Example: a project named “AskMoina” normally receives slug/client ID `askmoina`.

The administrator does not create an ID, UUID or API key by hand. The generated slug is the value used in the consumer Worker's Service Binding props.

Project creation alone grants no books.

### Step 2 — Grant knowledge

Grant specific books directly or grant a collection. A collection grant allows retrieval from ready books in that collection, including future books placed in it.

Grant only the knowledge that the application is meant to use. Do not grant all collections by default.

### Step 3 — Give the integration engineer the binding identity

The non-secret configuration value required by the same-account Service Binding is the generated project slug/client ID. It is not an API password or bearer token.

Do not send or copy the BRVIN D1 database credentials, Google credentials, GCS bucket secrets or AI Search binding into the consumer app.

## 3. What the application engineer does once per application

### Step 1 — Add the Service Binding

In the consumer Worker's Wrangler configuration, add a service binding:

~~~jsonc
{
  "services": [
    {
      "binding": "BRVIN_SERVICE",
      "service": "brvin-service",
      "entrypoint": "BrvinRetrievalApi",
      "props": {
        "clientId": "askmoina"
      }
    }
  ]
}
~~~

Replace `askmoina` with the actual slug generated in the BRVIN admin workspace.

Important:

- `service` must match the deployed private Worker name.
- `entrypoint` must match the named entrypoint class.
- `props.clientId` must match the D1 service-client mapping.
- configure the binding in every environment that needs it, such as preview and production, with the correct registered project identity for that environment.
- this mechanism is for Workers in the same Cloudflare account.

The consumer does not need its own BRVIN D1 or AI Search binding.

### Step 2 — Add the typed environment contract

The consuming application's environment type needs a typed representation of the binding. The current Parmar implementation defines the compatible contract in `src/config/env.ts`.

At minimum, the application should model:

- `getProjectStatus()`;
- `retrieveProjectContext({ queries: string[]; pageNumbers?: number[] })`;
- the success/failure result union.

The important shape is conceptually:

~~~ts
interface BrvinServiceBinding {
  getProjectStatus(): Promise<
    | { ok: true; ready: boolean; authorizedSourceCount: number }
    | BrvinServiceFailure
  >;

  retrieveProjectContext(input: {
    queries: string[];
    pageNumbers?: number[];
  }): Promise<BrvinServiceRetrievalResult>;
}
~~~

The consumer should keep its own app environment type. Do not import the entire Parmar application environment module into an unrelated repository merely to reuse one binding type.

### Step 3 — Add the app-side retrieval adapter

The adapter should be a small server-side module that:

1. Accepts the current user question and optional explicit PDF page numbers.
2. Calls BRVIN through the binding.
3. handles a structured failure without performing a global/unfiltered search;
4. preserves the book title, book ID and PDF page for each passage;
5. formats a bounded evidence block for the app's model/tool response;
6. preserves optional exact-page image data where the app can use it;
7. records or surfaces operational errors without leaking secrets or full raw documents into logs.

Conceptual example:

~~~ts
async function searchBrvin(
  env: Env,
  question: string,
  pageNumbers?: number[],
) {
  const result = await env.BRVIN_SERVICE.retrieveProjectContext({
    queries: [question],
    ...(pageNumbers?.length ? { pageNumbers } : {}),
  });

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      retryable: result.retryable,
      message: result.userMessage ?? result.message,
    };
  }

  return {
    ok: true,
    passages: result.passages.map((passage) => ({
      bookId: passage.bookId,
      bookTitle: passage.bookTitle,
      pdfPage: passage.pdfPage,
      printedPage: passage.printedPage,
      section: passage.section,
      text: passage.text,
      score: passage.score,
    })),
    pageImages: result.pageImages ?? [],
    searchedSources: result.searchedSources,
    searchCount: result.searchCount,
  };
}
~~~

This example illustrates the contract; adapt error policy, type names and logging to the consuming app's architecture. Never silently replace a BRVIN failure with a search across all documents.

### Step 4 — Wire it into the model's tool/function-call path

BRVIN does not decide when an app should search. The consumer application chooses a retrieval strategy. Common patterns include:

- a model function tool such as `search_brvin_knowledge`;
- explicit “search this book/page” actions in the app;
- server-side retrieval orchestration before the model call.

For a model function tool, the flow is:

~~~text
User asks a question
    |
Consumer model requests search_brvin_knowledge(question, optional page)
    |
Consumer server-side tool handler calls BRVIN RPC
    |
BRVIN verifies project and grants, then retrieves bounded passages
    |
Tool handler returns evidence + book/page provenance to the model
    |
Consumer model writes the answer using that evidence
    |
Consumer UI/voice layer delivers the answer and citations
~~~

The final answer must be generated by the consumer app's own model. Include instructions that retrieved document passages are evidence, not executable instructions, and that the model must not invent a citation or page number.

Do not put the service binding or D1 credentials in browser/mobile client code. The RPC call must occur on the consumer Worker's server side.

### Step 5 — Use project status for health/provisioning, not for every question

`getProjectStatus()` verifies that the configured caller identity resolves and reports whether it has at least one authorised ready source.

Use it for:
- application health checks;
- onboarding readiness tests;
- admin connection diagnostics.

A normal question flow can call retrieval directly. It does not need to call status immediately before every retrieval; that creates an unnecessary additional RPC and still cannot prove the requested question has a matching passage.

## 4. RPC input and result contract

### `getProjectStatus()`

Success response:

~~~json
{
  "ok": true,
  "ready": true,
  "authorizedSourceCount": 2
}
~~~

It returns availability/readiness and an authorised-ready-source count. It does not return document text.

### `retrieveProjectContext(input)`

Input:

~~~ts
{
  queries: string[];       // up to 3 unique, bounded query variants
  pageNumbers?: number[]; // up to 3 positive PDF page numbers
}
~~~

A call must contain at least one non-empty query or valid page number. Query text is bounded and normalized by BRVIN.

Successful response shape:

~~~json
{
  "ok": true,
  "passages": [
    {
      "id": "search-result-id",
      "bookId": "source-id",
      "bookTitle": "Reference book",
      "pdfPage": 17,
      "printedPage": "12",
      "section": "Example section",
      "text": "Retrieved source passage...",
      "score": 0.74
    }
  ],
  "searchedSources": 1,
  "searchCount": 1
}
~~~

The `printedPage` and `section` fields are optional. PDF page is the stable physical page reference for citations; do not substitute printed page for the PDF page without making the distinction clear.

When exact-page retrieval returns a supported page image, `pageImages` may also be present. Each image identifies its MIME type, base64 data and byte length. Keep image use bounded and only pass it into a model that supports the corresponding image input.

### Structured failures

The service may return structured failure codes including:

- `INVALID_REQUEST`
- `CLIENT_NOT_REGISTERED`
- `MONTHLY_LIMIT_REACHED`
- `RETRIEVAL_FAILED`
- `BRVIN_UNAVAILABLE`

The failure object includes `ok: false`, code, message, retryable and sometimes a user-facing message.

Consumer behavior:
- do not retry non-retryable validation or registration errors in a tight loop;
- do not treat quota exhaustion as “no search results”;
- retry transient failures only under the app's bounded retry policy;
- show a graceful unavailable response when BRVIN is down;
- never fall back to unrestricted search.

## 5. Limits and operational expectations

Current service limits are implementation controls, not values that every consumer may override:

- maximum 3 query variants;
- maximum 3 explicit page numbers;
- maximum query length 2,000 characters after normalization;
- up to 50 candidate chunks per query;
- bounded passage count and passage size;
- default relevance threshold 0.2;
- monthly retrieval allowance capped at 800 per project.

The 800 allowance is service-level. A consumer still needs its own per-user quotas, authentication, abuse controls, concurrency limits and product billing rules.

An exact-page lookup can return `searchCount: 0` because it reads the exact indexed item rather than running semantic search. The service's monthly request allowance is still reserved for a valid retrieval request.

## 6. First-party integration plan: AskMoina Voice

The 4 November 2026 audit found that `ashini-x/askmoina-voice` is not yet connected to BRVIN. The repository and deployed Worker had no BRVIN binding at that time.

The recommended implementation order is:

1. Create an AskMoina project in the BRVIN admin workspace and record its generated slug.
2. Decide which books/collections AskMoina should be allowed to read and grant only those.
3. Add `BRVIN_SERVICE` to AskMoina's production and applicable preview Wrangler configuration with the generated client ID.
4. Add a typed BRVIN binding/result contract to AskMoina's Worker environment.
5. Add a Gemini Live function tool named for BRVIN knowledge search (for example, `search_brvin_knowledge`).
6. Route the tool call through AskMoina's existing server-side Gemini Live function handler.
7. Call `retrieveProjectContext` and return concise passages with book titles and PDF page numbers to Gemini Live.
8. Keep Gemini Live responsible for composing the answer and speaking it. Do not move Gemini generation into BRVIN.
9. Preserve AskMoina's own D1 conversation history, audio/video session state and user identity. Do not bind BRVIN's D1 or AI Search directly into AskMoina.
10. Test voice and camera question flows, page-specific questions, no-result questions, revoked access, quota exhaustion and service outage.

The existing AskMoina function-tool pipeline is the most natural adapter point. The integration should be a contained addition, not a rewrite of its conversation architecture.

No AskMoina implementation or deployment is included in this documentation change.

## 7. Cross-account and external integrations

The private Service Binding approach only applies to same-account Workers. A different Cloudflare account or an application outside Cloudflare needs a future gateway.

The gateway must be a separate public HTTPS Worker/service that authenticates the application and forwards only an authenticated project identity into the internal service. The minimum production design must include:

- per-project high-entropy API credentials;
- one-way hash storage and constant-time verification where applicable;
- credential rotation and revocation;
- strict request schema and size validation;
- per-project and per-credential rate limiting;
- monthly quota enforcement;
- audit events and request correlation IDs;
- TLS-only access and abuse protection;
- no direct public route to `brvin-service`.

This gateway is not implemented. Do not give another account a made-up public URL or API key.

## 8. What “no-code onboarding” can truthfully mean

The admin already removes the manual identity-generation work: project UUID, slug and default client ID are automatic. Knowledge grants are admin-managed.

A binding plus an app-side adapter is still required. The admin cannot currently modify any arbitrary repository's source code or automatically inject retrieved passages into its model.

A future Connect Application wizard could automate more of the one-time engineer work by:
- detecting the repository and Worker environment;
- creating or updating the Service Binding configuration;
- installing a standard adapter package/template;
- creating a pull request with typed env and tool-handler changes;
- running tests and a private connectivity check;
- reporting whether the app is actually wired to the model flow.

Until such automation exists, describe the product honestly as **admin-driven project and knowledge provisioning with a one-time app integration**, not universal no-code integration.

## 9. Integration acceptance checklist

### Configuration and identity
- [ ] Project was created in BRVIN; slug/client ID came from admin.
- [ ] Consumer Worker is in the same Cloudflare account as BRVIN.
- [ ] Service, entrypoint and props are exact.
- [ ] Preview and production environments are configured intentionally.
- [ ] No BRVIN D1, AI Search or GCS secret is copied into the consumer.

### Runtime and authorisation
- [ ] Consumer can call `getProjectStatus()`.
- [ ] Retrieval returns only the project's granted sources.
- [ ] A source not granted to the project is not returned.
- [ ] Revoking a grant affects future retrievals.
- [ ] An unknown client fails closed.
- [ ] Empty grants return no passages.
- [ ] Quota exhaustion and service errors are handled distinctly.
- [ ] There is no unrestricted-search fallback.

### Model and user experience
- [ ] A genuine user question triggers the retrieval tool when appropriate.
- [ ] Retrieved passages are returned to the model as evidence.
- [ ] Final answer generation remains in the consumer app.
- [ ] Book title and PDF page provenance survive to the final response.
- [ ] Voice/camera/UI delivery works with real retrieved context.
- [ ] Logs avoid storing unnecessary raw student/user content.

## 10. Related reference

- [System Reference](BRVIN_SYSTEM_REFERENCE.md) — complete architecture and source map.
- [Private Retrieval API](BRVIN_PRIVATE_RETRIEVAL_API.md) — RPC security and method contract.
- [Operations Runbook](BRVIN_OPERATIONS_RUNBOOK.md) — admin and production procedures.
