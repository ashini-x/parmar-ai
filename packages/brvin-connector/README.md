# @brvin/connector

A dependency-free, server-side TypeScript adapter for the private BRVIN v2 Worker Service Binding.

## Responsibilities

- Stable typed interface for all three v2 RPC methods.
- Validation and normalization of project IDs, query variants, PDF page numbers and request IDs.
- Per-call deadline and serialized response-size guard.
- Normalized transport/deadline failures and error-action guidance.
- Content-free diagnostic callbacks.
- Plain-text evidence/citation formatting using book and physical PDF-page provenance.

## Boundaries

This package does not own application authentication, user/workspace-to-project mapping, secrets, public gateways, D1, AI Search, prompts, model generation, Gemini Live function handling, voice/video state, or answer delivery. The consumer must choose the project from its own trusted server-side context.

Use only inside a trusted Worker. Never call the private Service Binding from browser/mobile code or accept the environment identity from an HTTP request.

The adapter does not cache permissions or automatically retry retrieval. Project grants must take effect on the next call. A timeout may occur after BRVIN has reserved quota, so automatically repeating a timed-out retrieval could charge twice.

## Delivery model

This is a versioned source package maintained in the BRVIN repository. It is intentionally not published to a public npm registry and requires no registry credential. A consumer onboarding PR vendors a pinned copy of this directory into the consumer Worker repository and records the upstream BRVIN commit SHA. The consumer imports the vendored package locally.

This keeps the implementation reviewable and supports private consumer repositories. The future Connect Application workflow can update a pinned copy through a reviewed PR. Adding another BRVIN project after the application is connected requires no connector edit or consumer redeployment.

## Example

~~~ts
import {
  createBrvinConnector,
  classifyBrvinFailure,
  formatBrvinEvidence,
} from "./brvin-connector/src";

const brvin = createBrvinConnector(env.BRVIN_SERVICE, {
  timeoutMs: 15_000,
  maxResponseBytes: 8 * 1024 * 1024,
  onDiagnostic(event) {
    logger.info("brvin_connector_call", event);
  },
});

// Select projectId from the consumer's trusted user/workspace mapping.
const result = await brvin.retrieveProjectContext({
  projectId,
  queries: [question],
});

if (!result.ok) {
  const guidance = classifyBrvinFailure(result);
  // Apply application-specific UX; do not automatically repeat retrieval.
  throw new Error(result.userMessage ?? guidance.action);
}

const evidence = formatBrvinEvidence(result.data.passages);
// Supply evidence to the consumer's own LLM/Gemini tool handler.
// BRVIN does not generate or deliver the final answer.
~~~

The service binding identity is configured in the trusted Worker deployment as
`props.applicationEnvironmentId`. Never accept it from a browser, request body, chat
message or untrusted application caller.

## Contract and limits

- Project IDs are opaque strings (including legacy `fatman`), length 1–128, with no NUL or outer whitespace.
- Up to 3 unique query variants, each at most 2,000 characters after whitespace normalization.
- Up to 3 unique positive PDF page numbers (maximum 100,000).
- Default RPC deadline: 15 seconds (configurable up to 120 seconds).
- Default serialized response cap: 8 MiB (configurable up to 16 MiB).
- The adapter performs one RPC attempt only. After a timeout/transport failure, the outcome may be unknown; do not automatically retry retrieval.
- Service-declared failures remain typed. Use `classifyBrvinFailure` for guidance, not as permission to retry automatically.

## Updating the package

Update this package in BRVIN, maintain its tests, and run the full repository validation. Update a consumer copy only through a separate reviewed PR. Record the upstream commit SHA in the consumer's package README or source header.
