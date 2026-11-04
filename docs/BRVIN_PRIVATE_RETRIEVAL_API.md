# BRVIN Private Retrieval Service

## Decision

BRVIN remains in the ashini-x/parmar-ai monorepo but is deployed as a separate Cloudflare Worker named brvin-service. Applications call it through private Cloudflare Service Binding RPC. The retrieval Worker has no public route and has workers_dev disabled.

The first migration moves live project-scoped retrieval behind this service. The existing /admin/brvin workspace, PDF ingestion gateway, Google Vision/GCS orchestration, and release-QA tooling remain in the existing parmar-ai Worker for this stage. They continue to use the same D1 database, AI Search namespace, and background Workflow. This avoids a risky ingestion/admin rewrite while making the application retrieval boundary central and reusable.

## Trust and project resolution

- The caller's identity is delivered as ctx.props.clientId by the Service Binding configuration.
- ctx.props is platform-controlled deployment configuration, not request data. The RPC methods do not accept a project slug or project ID from the caller.
- D1 table brvin_service_clients maps the trusted client ID to one project.
- Existing projects receive a default client ID matching their slug. Creating a project also creates this mapping atomically.
- A project must be active. Books must be ready and fully indexed, and must be reachable through a direct book grant or a collection grant.
- The service filters AI Search by the authorised folders before retrieval, then validates each returned key against the D1-authorised source list again.
- Unknown callers, inactive projects, invalid prefixes, and retrieval failures never fall back to an unfiltered search.

## RPC contract

The named WorkerEntrypoint is BrvinRetrievalApi.

- getProjectStatus() returns connection/availability information and the count of authorised ready sources. It does not return document text.
- retrieveProjectContext({ queries }) accepts one to three bounded query variants. It resolves the project from ctx.props.clientId, enforces a per-project monthly query allowance, searches only authorised folders, and returns up to 12 validated passages with book IDs, titles, PDF page numbers and scores.
- The caller handles its own model prompt, answer generation, conversation memory and user delivery.

The parmar-ai Worker is registered with clientId "parmar-ai", which resolves to the existing fatman project. It retains the existing Fatman query expansion, queue/retry, answer generation and citation formatting. The live answer path makes one RPC retrieval request rather than a separate readiness check followed by a retrieval call.

## Search and index

- All projects use the existing AI Search instance fatman-2026-8b183803 in the existing default namespace.
- No PDFs, OCR results, pages or search indexes are copied.
- D1 brvin_books.search_prefix is the authoritative mapping from an allowed book to its indexed folder.
- AI Search's built-in folder filter is applied with $in before retrieval. Every returned page key is then checked against the authorised prefix set and parsed page key.
- The fatman_search_usage table is retained for Fatman's existing monthly allowance. Other projects use brvin_project_search_usage with a per-project/month key.
- The service receives only D1 and AI Search bindings. It does not receive Telegram, Gemini/Vertex, Google Vision or GCS credentials.

## Deployment

The two Worker configs are:

- wrangler.jsonc — parmar-ai.
- wrangler.brvin.jsonc — brvin-service.

The GitHub Actions workflow dry-runs both configurations. Production deploys brvin-service first, then parmar-ai, then runs the existing production health check. The health check now verifies that the trusted parmar-ai client can reach BRVIN. If that fails, the existing parmar-ai deployment rolls back. The private BRVIN Worker is additive and the previous parmar-ai version does not depend on it.

No new Cloudflare variables or application secrets are required when the existing GitHub Actions deployment credentials can deploy a Worker with D1, AI Search and Service Bindings. Existing repository settings remain:

- GitHub Actions secret CLOUDFLARE_API_TOKEN.
- GitHub Actions variable or secret CLOUDFLARE_ACCOUNT_ID.

The deployment token must have Workers Scripts edit permission and access to the existing account resources. No Telegram, GCP, Gemini or GCS secret is copied into brvin-service.

## Connecting another application

After creating an application project in BRVIN, the default client ID is the project's slug. For a project named AskMoina this is normally askmoina. Grant books directly or grant their collection in the admin console.

In the AskMoina Worker's Wrangler configuration, add:

~~~jsonc
"services": [
  {
    "binding": "BRVIN_SERVICE",
    "service": "brvin-service",
    "entrypoint": "BrvinRetrievalApi",
    "props": { "clientId": "askmoina" }
  }
]
~~~

No project ID, API key, database binding, AI Search binding, or PDF storage credential is needed in AskMoina. The app calls env.BRVIN_SERVICE.retrieveProjectContext({ queries: [question] }). The project mapping and current grants remain authoritative in BRVIN's D1 registry.

## Production acceptance criteria

1. brvin-service has no public Worker URL or public route.
2. The parmar-ai Service Binding uses clientId "parmar-ai" and resolves to active project fatman.
3. An unregistered client ID fails closed without searching.
4. A project with no ready, granted sources returns no passages and performs no search.
5. Search calls include only D1-authorised folder prefixes.
6. Returned chunk keys are verified against D1 grants after search.
7. Collection and direct grants both work, and revoked grants stop appearing in retrieval.
8. Fatman citations preserve the existing book title and PDF page fields.
9. The existing Telegram queue, retries, Durable Object continuity and Gemini answer flow remain unchanged.
10. Both Worker bundles type-check and dry-run; production health confirms the private RPC is connected.
