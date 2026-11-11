# BRVIN Core agent instructions

These instructions apply to all work in `ashini-x/parmar-ai`, including the Core Admin, ingestion plane and private `brvin-service` retrieval Worker.

## Required reading

For BRVIN work, read the current versions on `main` before coding:

1. `docs/BRVIN_2_MASTER_PLAN.md` — canonical state and continuation.
2. `docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md` — approved scope and milestone acceptance.
3. `docs/BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md` — M12–M17 architecture, rollout and rollback gates.
4. `docs/BRVIN_2_ARCHITECTURE_DECISIONS.md` — accepted decisions and superseded proposals.
5. `docs/BRVIN_SYSTEM_REFERENCE.md` — as-built implementation and trust boundaries.
6. `docs/BRVIN_2_RPC_V2_CONTRACT.md` — frozen private consumer contract.
7. The relevant Core admin, operations, ingestion, migration or benchmark runbook.
8. For coordinated consumer work, inspect `ashini-x/brvin-teachers` and its `AGENTS.md` / compatibility guide.

Read repository-local instructions in any nested `AGENTS.md` before editing that directory. When documents disagree, prefer live code/Cloudflare state for deployed facts, the frozen v2 contract for RPC behavior, the migration plan for provider acceptance, and the master plan for current task order. Record unresolved contradictions rather than silently reconciling them.

## Ownership and invariants

- Core owns indexing, durable derived corpus artifacts, Vertex AI embeddings, Qdrant, retrieval providers, source registry, quotas, grants and private retrieval.
- D1 is authoritative for application/environment identity, grants, project/source authorization, source readiness, quotas and audit. Vector payloads and provider filters are never authorization truth.
- Original PDFs, raw Vision OCR and rebuildable source-derived artifacts remain durable in private GCS. Qdrant must not be the only copy of chunk text or manifests.
- Preserve raw OCR unchanged. Store normalized searchable text separately and version it. Store formula/LaTeX and normalized formula-search representations only when extraction is reliable; retain original expression, OCR uncertainty and physical PDF page provenance. Never silently repair or normalize away sign, exponent, subscript, operator, fraction, vector or unit distinctions.
- Build one unified math-aware hybrid retrieval path (dense + sparse/BM25 + RRF) for explanation, definition, formula, worked example, numerical setup and mixed queries. Content-type tags are descriptive/ranking signals, not separate subject bots or hard routing that hides other evidence.
- Keep the existing five-stage ingestion lifecycle, physical PDF page map, retry/resume semantics, READY gating and both existing admin experiences intact.
- Keep the private BRVIN v2 request/response contract and trusted Service Binding identity semantics unchanged for provider modernization. v2 caller identity comes only from trusted `ctx.props.applicationEnvironmentId`; a request `projectId` is a selector, not permission.
- Teachers is a private v2 consumer. Never add Qdrant/Vertex credentials, SDKs, embeddings, direct database access or direct provider calls to `brvin-teachers`.
- Keep Cloudflare AI Search available as baseline/rollback until the explicit legacy-retirement review.

## Milestone and delivery discipline

- Inspect current `main`, recent commits, open issues, PRs and deployment state in BOTH repositories before deciding the next task.
- Follow the first incomplete task in the current GitHub issues. Do not revive superseded milestones or repeat completed benchmarks without a documented reason.
- M13 provider boundary / durable corpus is merged. M14 is complete only as a scoped non-production Vertex/Qdrant pilot. M15 #144 remains the active shadow acceptance milestone; M16 #145 / Teachers #18 is coordinated UI/consumer parity; M17 #146 is the controlled production canary and 14-day soak.
- M15 requires passage-level qrels/claim grounding, broader formula/mixed-content relevance, authorization isolation and revocation with vectors retained, throttling and deterministic recovery, repeatable latency/throughput/cost, concurrency/load and rollback rehearsal.
- Human qrels must be produced by independent human reviewers when the acceptance plan says human. Never label model-generated or assistant-generated grades as independent human qrels. Keep raw reviews, disagreements and adjudication separate.
- Staging receipts, page-coverage proxies, model-generated evaluations and small sequential timing samples are not production SLOs or independent human relevance judgments.
- Do not change `BRVIN_RETRIEVAL_PROVIDER` in production or cut over production before ALL acceptance gates in the migration plan are green and the explicit M17 process authorizes it.
- Separate implementation, tests, CI, staging deployment, production deployment and live production verification. A passing build is not deployment acceptance.
- Prefer small, reversible changes with regression tests. Do not broaden query filters, disable D1 checks, bypass the private v2 boundary or silently fall back to unrestricted search.
- Update the master plan, milestone ledger, migration plan, system reference and affected runbooks in the same change when their facts or status materially change. Synchronize Teachers documentation when a cross-repo fact or consumer requirement changes.

## Security and operational safety

- Never print, copy into chat, commit or add logs containing API keys, service-account private keys, OAuth secrets, bearer tokens, user data, raw questions, passage text or embeddings.
- Do not retrieve or reveal secret bindings. Ask the operator to enter existing staging secrets locally only when an authenticated manual action is strictly required.
- Benchmark routes must remain authenticated, staging-only, source-confirmed and query-only when specified. Verify exact project/source filters. Do not write/delete shared production AI Search items, Qdrant points, OCR objects or D1 rows during a shadow evaluation.
- Fail closed on missing grants, provider errors, malformed data, missing source provenance or unrecognized payload schemas.
- Never re-upload/re-OCR a source to retry chunking, embedding or indexing when immutable OCR/manifests can be replayed.
- Preserve rollback capability and the legacy index during canary/soak.

## Working style

Make the smallest change that advances the current issue. Do not ask the operator to repeat facts already in current docs/issues. Explain only genuine blockers requiring an external human action; continue with other safe implementation tasks only when they do not bypass the first acceptance gate.
