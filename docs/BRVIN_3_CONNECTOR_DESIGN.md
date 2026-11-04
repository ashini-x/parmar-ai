# BRVIN 2 — Milestone 3 Connector Design

**Status:** Implementing  
**Milestone:** M3 — reusable BRVIN application connector  
**Date:** 4 November 2026  
**Canonical source:** `packages/brvin-connector`

## 1. Purpose

Provide a single typed server-side adapter for consumer Workers to call the private BRVIN v2 RPC. Application integrations should not each invent their own request validation, timeout behavior, permission-error handling, evidence citation formatting or observability contract.

The connector is an adapter around the existing v2 WorkerEntrypoint. It is not another retrieval service, gateway, database or indexing pipeline.

## 2. Source and distribution decision

The canonical source lives in the private `ashini-x/parmar-ai` repository at `packages/brvin-connector`.

For the initial delivery, consumers vendor a pinned copy of this package into their own Worker repository through a reviewed GitHub PR. The consumer records the upstream BRVIN commit SHA in its local package metadata/README.

Reasons:
- BRVIN and AskMoina are private repositories; no public npm publication is appropriate.
- This avoids adding a package-registry token or a second package-publishing service to the first integration.
- The connector has no runtime dependencies and can be bundled by the existing Wrangler/TypeScript toolchain.
- The future Connect Application wizard can add or update the vendored package through the same reviewed PR it already creates for the consumer's Service Binding and tool-handler code.
- Once connected, creating additional BRVIN projects is a D1/admin operation and does not change or redeploy the consumer's connector.

This is an initial source-distribution choice, not a claim of an automatically synchronized multi-repository dependency. Package updates are explicit, pinned and reviewed.

## 2.1 Isolated Parmar AI Worker Preview

The Cloudflare preview build initially failed because the production Wrangler file had no `previews` block. The account has no existing Parmar AI preview D1 database; using `parmar-ai-admin-prod`, `sawalnewton-db`, or another application's preview database would be unsafe.

A dedicated D1 database was created: `parmar-ai-admin-preview` (`4061b8b7-aeae-4f83-a650-922c68e6f42d`). The `previews` block in `wrangler.jsonc` sets `ENVIRONMENT=preview`, `FATMAN_ENABLED=false`, and binds only this preview DB plus a preview-scoped `JOB_DEDUPE` namespace.

The preview deliberately omits the production BRVIN Service Binding, AI Search namespace, Fatman import Workflow, and production question Queue. Cloudflare Worker Previews would route a Service Binding call to the downstream Worker's production deployment, so omitting it prevents branch previews from reaching the live Fatman corpus/quota. The resulting non-production Preview is not intended to run the full Fatman or BRVIN workflow.

Cloudflare Workers Builds preview for branch `brvin-2/m3-connector` completed successfully on commit `92e45cd54c8e5ae84dd5bb8007ae3802559a18c0`, build `ae509117-e816-4934-a3d0-7c975c5b9c21`. Cloudflare warned that the omitted production-only bindings are unavailable in Preview; this is expected and documented, not a failed build.
## 3. Public connector interface

The package exports:
- `createBrvinConnector(binding, options)`
- `BrvinV2RpcBinding` and the typed project/retrieval/result contracts
- `classifyBrvinFailure(error)`
- `formatBrvinCitation(passage)`
- `formatBrvinEvidence(passages)`

The returned connector provides:
- `listAuthorizedProjects()`
- `getProjectStatus({ projectId })`
- `retrieveProjectContext({ projectId, queries, pageNumbers?, requestId? })`

The application environment identity is not accepted by any connector method. It remains exclusively in the Service Binding's trusted deployment props and is resolved inside the private Worker.

## 4. Safety and operational behavior

- **Server-side only:** never expose a BRVIN Service Binding to browser/mobile clients.
- **Consumer-owned project selection:** the authenticated consumer app maps its own user/workspace to a project in trusted server-side logic. A request's project ID is still checked against the application's active D1 grant by BRVIN.
- **Fail closed:** no v1 fallback, global search, arbitrary prefix, source grant or direct D1/AI Search access.
- **No permission cache:** every method calls the RPC so app/environment/project revocation applies on the next request.
- **No automatic retry:** retrieval may reserve project quota before its result returns. A timeout or transport failure may therefore leave the outcome unknown; the connector reports a non-retryable ambiguous failure rather than silently issuing a second quota-bearing call.
- **Bounded inputs:** project ID 1–128 characters; up to 3 normalized unique queries of at most 2,000 characters each; up to 3 unique PDF page numbers in the permitted range.
- **Bounded execution/response:** default 15-second call deadline and 8 MiB serialized response cap, configurable within fixed upper bounds.
- **Structured failures:** preserve service failure codes, retryability and user guidance; supply a suggested consumer action but never authorize an automatic retry.
- **Content-free diagnostics:** method, request ID, outcome, latency and response bytes only. Do not emit query or passage content.
- **Provenance:** format citations from book title, physical PDF page, optional printed page and section. The raw typed passages remain available to the consumer.
- **Model ownership:** the connector returns evidence. It never builds a Gemini prompt, generates an answer, speaks audio or manages conversation/session memory.

## 5. AskMoina integration target (M4)

In M4, AskMoina Voice will vendor a pinned version of this module and call it from its existing server-side Gemini Live function/tool handler. AskMoina retains its own:
- authentication and user/workspace-to-project mapping;
- Gemini Live model/session and audio/video state;
- D1 conversation history, memory and continuity checkpoints;
- user quota, rate limiting, prompts, answer generation and spoken delivery.

The browser sends a user question to AskMoina; it does not send BRVIN identity or call the private BRVIN service directly. The server derives the authorized project from trusted app context, calls the connector and passes retrieved passages/citations to Gemini Live as tool evidence.

## 6. M3 completion tests

- TypeScript checks and connector unit tests pass.
- Project discovery/readiness and semantic/exact-page calls preserve the v2 contract.
- Invalid selectors, overlong queries, excessive variants/pages and malformed request IDs are rejected before RPC.
- Server authorization failures are preserved and mapped to suggested actions.
- Thrown RPC errors and timeouts are normalized; no automatic repeat occurs.
- A timeout is documented as an unknown outcome because quota may have been reserved.
- Oversized responses fail closed.
- Diagnostics do not expose query or passage text.
- Citation formatting preserves physical PDF page and optional printed page.
- Both Worker bundles remain buildable and the existing Fatman v1 path remains unchanged.

