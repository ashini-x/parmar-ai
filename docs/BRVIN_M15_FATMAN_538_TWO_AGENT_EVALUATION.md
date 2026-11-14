# BRVIN M15 — full-corpus Fatman two-agent provider benchmark

**Status:** merged, staging Worker v108 deployed; corpus indexing paused at 280/538 Qdrant pages after a CPU-limit 503; paired evaluation pending  
**Scope:** complete Fatman 2nd Edition legacy corpus, 538 physical PDF pages  
**Decision owner:** project owner  
**Human-review policy:** explicitly waived for this staging decision; no manual passage labels, reviewer queue or human sign-off step

## Objective

Compare the existing Cloudflare AI Search retrieval path with Vertex AI embeddings + Qdrant dense/sparse hybrid retrieval on the same 538-page Fatman 2nd Edition source, the same frozen user-question suite, the same Core v2 authorization/quota resolver and the same Gemini answer-generation path.

Two separate AI assessors grade each provider's evidence and answer independently. A third AI adjudicator resolves material disagreements. The evaluation does not depend on human passage review.

## Pinned legacy source and safe reuse

The production D1 source record is `fatman-legacy-538` and is marked READY with 538/538 indexed pages. Its `brvin_books.source_sha256` field is blank; the source hash is taken from the completed original `fatman_import_jobs` row, not from that legacy BRVIN registry row. The staging benchmark now preserves that exact source ID and `fatman/pages/` item-key namespace rather than assigning a replacement UUID. The historical import's PDF SHA-256 is pinned as:

`8b183803fe8ee53087d731f7319519af9ac5bb62b39b2d3110acc3fe0ab59886`

The legacy index uses deterministic keys `fatman/pages/page-000001.txt` through `page-000538.txt`. The production AI Search instance is bound to staging only as a read-only export source. The benchmark inventories those completed page items, downloads their stored text, verifies the embedded physical-page marker, and writes immutable page/chunk manifests to the separate staging derived-corpus bucket.

No source PDF is uploaded. No Google Vision OCR request is submitted. The legacy production index items are never uploaded, deleted, replaced, or updated. The export is resumable through a D1 inventory and per-page checkpoint.

**Provenance:** the original completed import job is `6b94a848-c642-4be3-8718-3ae5a7d25b35`. Its D1 record contains the exact source object `fatman/imports/6b94a848-c642-4be3-8718-3ae5a7d25b35/source.pdf`, source SHA-256 above, expected size and uploaded bytes of 115,395,596, page count/indexed pages of 538, status `completed`, original Google Vision operation `projects/project-90db7be4-619f-4ed7-89b/operations/7358e7d1e97523c3`, and its completed workflow instance ID. The immutable staging manifests use that original SHA and Vision operation ID. This reuses the recorded import provenance; the staging export does not independently redownload or recompute the source PDF hash.

## Isolated resources

| Component | Staging resource |
|---|---|
| Worker | `parmar-ai-m14-staging` |
| D1 project | `c4ae7ce7-987f-4ae6-8bc4-6bf6d7a1c5f0` |
| Source ID | `fatman-legacy-538` (production legacy ID preserved in staging) |
| Derived corpus | existing M14/M15 private staging corpus bucket |
| Cloudflare AI Search | `brvin-m15-fatman-legacy-v1` |
| Qdrant collection | `brvin_m15_fatman_538_v1` |
| Embedding model | `gemini-embedding-001`, 768 dimensions, `asia-south1` |

The new Cloudflare staging instance is configured to match the live Fatman AI Search instance's retrieval configuration: Qwen3 embedding, vector + keyword indexing, 256 chunk size, 10 overlap, hybrid RRF, keyword OR, 0.3 score threshold, 16 candidate maximum, and the BGE reranker. The new instance is separately indexed; the original instance remains read-only.

Qdrant uses the deterministic BRVIN 256-token chunker with 26-token overlap, Vertex embeddings, BM25 sparse vectors and RRF. Cloudflare AI Search uses its native 256-token chunking with 10-token overlap, matching the live legacy index. Both receive the exact same 538 raw OCR pages and D1 project/source allowlist through Core v2, but the chunk boundaries are provider-pipeline-specific. This is an end-to-end system comparison, not a controlled experiment with identical chunk boundaries; the difference is part of the candidate architecture and must be considered when interpreting quality results.

## Resumable preparation stages

The protected operator is available at `/admin/m15/fatman` on the staging Worker. It uses the existing M14 staging operator token.

1. **Legacy inventory/export:** list the 538 completed AI Search items once; cache their exact page-to-item identities in staging D1; download stored OCR and build immutable manifests in batches of 18 pages.
2. **Qdrant:** embed and upsert in batches of six pages, with deterministic IDs and read-back validation for every Qdrant point.
3. **Cloudflare AI Search:** upload the same page text and metadata to the separately configured staging index in batches of eight. Queued/running items are polled by exact key; completed items are not duplicated.
4. **D1 READY gate:** register the source and project grant only after both indexes have completed and their exact source inventories/point counts have been read back.
5. **Paired evaluation:** run the 12 frozen cases through both provider modes, in parallel per case, through the actual Core v2 resolver.
6. **AI grading:** two independent assessors and, when required, a third adjudicator grade each provider's answer and evidence. Save every assessment and the paired receipt in staging D1.

A repeated preparation request resumes from the last durable page checkpoint. It does not restart export, embeddings, or indexing from page one.

## Frozen answer and retrieval cases

The evaluator reuses `fatman-real-user-qa-v4` from `src/fatman/release-qa.ts`:

- Exact fact: Battle of Plassey leadership
- Concept: President as an integral part of Parliament / Article 79
- Comparison: Fundamental Rights vs Directive Principles
- Page reference: Plassey page location
- Out-of-book: secret Cloudflare API token fingerprint
- Difficult multi-step: Plassey, Buxar, Allahabad and Diwani
- Short natural query: Article 79
- Shorthand comparison: FR vs DPSP
- Natural-language exact fact: Subsidiary Alliance
- Historical lookup: first Governor-General of Bengal
- Natural-language exact fact: Cornwallis land revenue system
- Causal explanation: why the British won Plassey

The suite's expected physical pages and fact groups are fixed and shared by both providers. Each provider generates its own answer from only its own retrieved source passages.

For the out-of-book case, retrieval candidate presence and answer abstention are assessed separately. A provider that returns unrelated passages does not get credit for clean retrieval abstention, even if Gemini correctly declines to invent a fingerprint.

## AI assessor policy

Each provider's evidence pack is independently evaluated by:

- **Agent A — evidence/retrieval assessor:** `gemini-4-argon`
- **Agent B — skeptical answer auditor:** `gemini-3.8-flash`
- **Adjudicator — disagreement resolution:** `gemini-4-argon`, invoked only on material disagreement

Both assessors receive the same blinded input for a provider case: original question, fixed expected pages/fact groups, actual retrieved OCR passages and generated answer. Provider name, retrieval score and rank are omitted from the assessor payload. Agent B does not see Agent A's output. The adjudicator sees both assessments only when required.

Each agent returns integer scores from 0–5 for:

| Dimension | Weight |
|---|---:|
| Retrieval relevance | 35% |
| Answer correctness | 30% |
| Source grounding | 25% |
| Citation accuracy | 10% |

The adjudicator is invoked if composite scores differ by at least 0.6 points, any individual scoring dimension differs by at least 2 points, or the agents disagree on critical-error or abstention flags. Otherwise the two scores are averaged and the conservative flags are retained. A critical unsupported claim is never cancelled by a high score elsewhere.

This is an **owner-authorized AI assessment**, not independent human qrels or human inter-rater agreement. Its authority is limited to the project owner's stated M15 staging decision. The owner has explicitly directed that human review is not a prerequisite.

## Automated decision rule

Qdrant is declared the staging winner only when all of the following are true:

1. Agent A's mean Qdrant composite score is strictly higher than Agent A's AI Search score.
2. Agent B's mean Qdrant composite score is strictly higher than Agent B's AI Search score.
3. Qdrant's mean adjudicated composite score exceeds AI Search by more than 0.001.
4. Its deterministic Fatman QA pass count is not lower than AI Search.
5. Its AI-assessed critical-error count is not higher than AI Search.
6. Its AI-assessed out-of-book abstention pass count is not lower than AI Search.

AI Search can win only when both agents independently score it higher, its adjudicated score is higher, and it is not worse on the mirrored guardrails. If the agents split, quality is tied, or guardrails conflict, the receipt says `no-clear-winner`; it does not force a provider switch.

This rule intentionally prevents a faster retrieval system from winning while materially reducing source-grounded accuracy or no-answer safety. The completed report includes each provider's individual A/B scores, adjudicated score, deterministic QA, missing facts, unsupported claims, citation results, candidate passages, answer text, token usage, query count, estimated answer cost, separate retrieval latency, separate Gemini answer-generation latency, separate assessor/adjudicator latency, and end-to-end case latency.

## Production boundary

This benchmark does **not** change production provider selectors, production D1, production AI Search items, production Qdrant data, production traffic, the Teachers repository or its runtime. `productionCutoverRecommended` is a recommendation field in the result, not a deployment action.

A Qdrant win advances the provider decision; it does not bypass the production migration work. Before enabling the provider for the existing Fatman project, Core must verify that the production source registry and Qdrant allowlist can represent the legacy Fatman source identity/key format, every currently authorized source is fully indexed, grants/revocation and rollback continue to work, and the existing Teachers contract remains unchanged. The Qdrant v2 adapter now has an exact allow-list mapping for the legacy `fatman/pages/` prefix to `fatman-legacy-538`, while retaining the UUID-style `brvin/books/{uuid}/pages/` mapping for all other sources. The corpus manifest store and reader accept only that exact legacy ID as a narrowly scoped exception. The staging benchmark uses the real legacy ID/prefix to exercise this path. Production cutover must still verify that the source-specific Qdrant points, live grants, source readiness and rollback inventory have been populated and read back before a selector flip.

The project owner's direction is clear: do not wait for human reviewers. Use the two independent AI assessors and adjudication, complete the paired evaluation, and move promptly to production preparation if Qdrant wins the defined gates. Keep the production AI Search path available for immediate rollback.

## Operator execution — current verified state, 14 November 2026

The operator is deployed on `parmar-ai-m14-staging` **v108** at 100%:

[Open the Fatman 538-page staging operator](https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/fatman)

The source-export, destination AI Search, Qdrant collection and two distinct assessor model bindings are present. The existing `BRVIN_M14_ADMIN_TOKEN` secret is unchanged. No temporary automation token exists.

**Current persisted preparation checkpoint (read from staging D1):**
- OCR text exported: **538/538 pages**
- Immutable deterministic chunks: **1,606**
- Qdrant indexed: **280/538 pages, 854 points**
- Staging AI Search indexed: **0/538 pages**
- Source status: `qdrant_indexing`
- Paired evaluation runs: none

The subrequest-limit fix in PR #288 changes Qdrant to **one page per Worker invocation** and AI Search to **four pages per invocation**. The first 538-page OCR export and its immutable GCS manifests are already complete. Do not restart export, upload the PDF or rerun Vision OCR.

1. Refresh the operator page so it loads the currently deployed staging Worker v109.
2. Enter the existing `BRVIN_M14_ADMIN_TOKEN` in that page's password field only. Never paste it into chat or repository files.
3. **Do not click Build yet.** First confirm the account Workers plan and effective CPU limit for `parmar-ai-m14-staging` in Cloudflare Dashboard → Workers & Pages → Settings → CPU limits. Resolve a Free 10 ms cap (upgrade to Paid or redesign the staging operation to fit) or an incorrectly low Paid CPU cap, deploy/verify a safe staging CPU configuration, and only then resume. Once verified, Build resumes at Qdrant page 281, preserving all existing manifests and 854 completed points; each invocation indexes one Qdrant page and up to four AI Search pages.
4. Confirm READY and all counters at 538/538: exported, Qdrant indexed and AI Search indexed.
5. Click **Run the two-agent, 12-case Fatman comparison**. It runs both provider cases per frozen QA question, two independent assessors and adjudication only for material disagreements. The UI saves the full receipt to isolated staging D1.

No manual reviewer, PDF upload, Vision OCR rerun, terminal command or repository update is required. Human review is explicitly waived for this provider decision. Production remains on Cloudflare AI Search; no selector flip occurs automatically from the staging result.

Latest live read-back on 15 November 2026: staging v109; production `parmar-ai` v817 and `brvin-service` v171; Teachers v12, all at 100%. Core Release Validation [#43632139823](https://github.com/ashini-x/parmar-ai/actions/runs/43632139823) and staging workflow [#43632139797](https://github.com/ashini-x/parmar-ai/actions/runs/43632139797) passed. Both production Core selectors remain `cloudflare-ai-search`, the Fatman production monthly query limit is 800, and corpus-manifest writes are disabled. The latest v109 staging deployment did not change the CPU configuration. The production source index and D1 were not modified by the staging benchmark implementation.

## 14 November 2026 — first operator attempt and diagnostic update

The owner attempted the first corpus-build action. The browser reported an HTML-as-JSON parse error (`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`). The precise interception/error layer has not been identified yet.

PR #287 merged as `44571ae900687c2a4bbf836657f91eed929ea20b`; it changes the page API client to expose response status, content type, redirect state, final URL and a bounded body preview for non-JSON results, and adds `Accept: application/json` plus `cache: no-store`. The updated staging operator is deployed as v107 at 100%. The staging D1 still has no Fatman state tables, and no source export or paired evaluation has been confirmed.

Retry by refreshing the operator URL above to load v107, entering the existing staging admin token locally and clicking Build once. If it fails, capture the improved diagnostic text. Do not send the token. Production selectors and quota remain unchanged.

## 14 November 2026 — subrequest-limit failure and v108 remedy

The first full corpus build reached 538/538 OCR-exported pages and 1,606 chunks, then exceeded Cloudflare's per-Worker subrequest budget during Qdrant indexing. The initial failure checkpoint was `qdrant_indexing`, Qdrant 11/538 pages and 29 points, staging AI Search 0/538. This is the first-failure snapshot only; later v108 activity has advanced further as described in the latest progress section below. All OCR export work is retained in immutable GCS manifests; no PDF upload or Vision OCR rerun is needed.

PR #288 merged as `0992af5cfe85539c9a2f589309ab40ffed4a7a01`. It reduces Qdrant to one page per invocation and the AI Search destination batch to four pages per invocation. Each D1 page checkpoint advances only after Qdrant's deterministic point upsert/read-back succeeds; a retry of an interrupted page uses the same deterministic IDs. The M14 staging workflow and full Release Validation passed.

The updated operator is deployed as staging Worker v108 at 100% (deployment `56e01ad6-2803-4144-8ece-2ad8cb8de3c3`). Historical production read-back at the first v108 deployment: `parmar-ai` v807, `brvin-service` v166, Teachers v12. Production provider selectors and quota are unchanged.

**Historical resume instruction at the first post-fix checkpoint:** this began at Qdrant page 12. The operator has since progressed further; follow the latest progress section below. Human review remains waived.


## 14 November 2026 — latest live progress after continued v108 indexing

Cloudflare read-back still shows staging Worker `parmar-ai-m14-staging` v108 at 100%. The latest staging D1 query reports:
- OCR text export: **538/538 pages**
- Immutable deterministic chunks: **1,606**
- Qdrant: **280/538 pages, 854 points**
- Staging AI Search: **0/538 pages**
- Source state: `qdrant_indexing`
- Paired Fatman benchmark runs: **none**

The per-invocation limits remain one Qdrant page and four AI Search pages. However, a subsequent authenticated Build continuation returned HTTP 503 because the Worker exceeded its CPU time limit. The checkpoint is still Qdrant 280/538 (854 points), so the next page is 281. Do not retry Build until the effective CPU budget is confirmed and raised or the work is redesigned to fit that budget. See the CPU incident section below.

Latest production read-back: `parmar-ai` v815 (version `cf909f05-f111-42e4-b734-c21134d41ef9`, deployment `55bd7f54-fd5e-49e3-9783-6a01a3a39689`) and `brvin-service` v170 (version `2752700f-2eb7-4c7b-874b-48f8f1893123`, deployment `18bb72d6-686d-40ab-aa5a-2ee5d4eba944`), each 100%. Production selectors remain Cloudflare AI Search; Fatman quota remains 800/month; corpus-manifest writes remain disabled; Teachers remains v12. Release Validation run [#43626659528](https://github.com/ashini-x/parmar-ai/actions/runs/43626659528) passed production smoke and release acceptance.

Human review remains waived. No paired AI assessment receipt has been created yet.


## 14 November 2026 — staging continuation stopped by CPU limit

Cloudflare Workers Observability captured the failed `POST /admin/m15/fatman/prepare` at **2026-11-14 18:05:21.768 UTC** (request ID `52925b6fc91bb86d7193ab5f69b08c9c`, Ray ID `a5a7f1939a19fd14`). The Worker returned **HTTP 503** with `outcome=exceededCpu`; the associated exception was `Worker exceeded CPU time limit.` Reported CPU time was **11 ms** and wall time was 2,476 ms. The preceding prepare continuations returned HTTP 200. This is a Worker CPU-budget termination, not an invalid token, source-hash mismatch, OCR failure or evidence that the production Fatman index was modified.

The failed request did not advance the durable D1 checkpoint. The verified state remains: 538/538 OCR pages exported; 1,606 chunks; Qdrant 280/538 pages (854 points); AI Search 0/538; source state `qdrant_indexing`; no paired benchmark run. Resume remains after Qdrant page 280 (physical page 281), but **do not click Build again until the effective staging Worker CPU limit is resolved**.

The v108 and current v109 staging deployments use `wrangler.m14-staging.jsonc`, which has no explicit `limits.cpu_ms` setting; v109 is not a CPU-limit fix. Cloudflare script settings report `usage_model=standard`, but the connected OAuth identity cannot read account subscriptions: the subscription endpoint returns 403 because Billing Read permission is unavailable. Therefore the actual account plan / effective configured CPU cap is not conclusively visible from this connection. Cloudflare's current [Workers CPU limits documentation](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) states a 10 ms per-request limit on Workers Free, while Workers Paid defaults to 30 seconds and can be configured up to 300,000 ms. The observed 11 ms termination is consistent with a 10 ms effective cap, but the plan still needs confirmation.

**Required operator resolution:** in Cloudflare Dashboard, inspect Workers & Pages → `parmar-ai-m14-staging` → Settings → CPU limits and confirm the account's Workers plan. If the account is Free, the 10 ms ceiling cannot be raised through Wrangler; use Workers Paid or redesign the staging page operation to stay within the Free limit. If Workers Paid is already active but the script has a low custom CPU cap, set a suitable value (30,000 ms is the normal paid default) in the staging Worker configuration using [Wrangler `limits.cpu_ms`](https://developers.cloudflare.com/workers/wrangler/configuration/#limits), then deploy and verify a new staging version. Do not change production Workers, provider selectors, monthly quotas, corpus manifests or Teachers. Once the new effective limit is verified, refresh the operator and resume at page 281; do not upload the PDF or rerun Vision OCR.


## 15 November 2026 — current live read-back and M15 continuation gate

GitHub Core main is `05398fbbde195e1c806ba6590769ccfa96092f1b`. Release Validation run [#43632139823](https://github.com/ashini-x/parmar-ai/actions/runs/43632139823) completed successfully, including typecheck/tests/build, paired Core production deployment, root/BRVIN connectivity and Fatman source-readiness smoke acceptance. The paired M14 staging workflow [#43632139797](https://github.com/ashini-x/parmar-ai/actions/runs/43632139797) also passed validation and deployed the isolated staging operator. The merged Core code change in PR #293 is unrelated Telegram answer formatting; it does not resolve the CPU incident or advance the Fatman index.

Cloudflare's current 100%-traffic read-back is:

| Worker | Environment | Version | Version ID | Deployment ID |
|---|---|---:|---|---|
| `parmar-ai` | production | v817 | `e7546e07-c0a6-45f0-b3d5-be1f2098620f` | `0111c946-c34a-4130-b356-b95b2c2a86bc` |
| `brvin-service` | production | v171 | `6f18206b-599b-44be-8294-1bacb69fe874` | `fb20db5e-43bd-4ce2-bede-428f2c916d22` |
| `parmar-ai-m14-staging` | isolated staging | v109 | `753462ad-adba-485c-946a-60bc62314580` | `319f13bc-d61e-431b-9b77-f40d351c6f46` |
| `brvin-teachers` | production | v12 | `68d6694c-6371-4cae-8a25-4af40ca15706` | `31ff2a01-b0f4-4be8-92d3-63e2d91adddf` |

Live version variables confirm both production selectors remain `cloudflare-ai-search`; `parmar-ai` has `BRVIN_CORPUS_MANIFEST_ENABLED=false` and `FATMAN_MONTHLY_QUERY_LIMIT=800`; `brvin-service` has `BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT=800`. Production has no Qdrant/Vertex retrieval binding. Teachers still has only `BRVIN_MANAGEMENT` and `BRVIN_SERVICE` Core service bindings plus its own D1; it has no provider credentials, SDKs or direct provider route.

The staging D1 remains unchanged: source `fatman-legacy-538`, 538/538 OCR exports, 1,606 chunks, Qdrant 280/538 pages (854 points), staging AI Search 0/538, status `qdrant_indexing`; the next physical page is 281. The legacy page inventory has 538 rows (pages 1–538). The paired Fatman run table is empty. No PDF upload or Vision OCR rerun is needed.

The active v109 staging config still has no explicit `limits.cpu_ms`; its version metadata does not expose an effective CPU limit. The Worker settings read-back reports `usage_model=standard`, which is not sufficient evidence of the account billing plan. The Cloudflare account-subscription endpoint still returns 403 because the connected OAuth identity lacks Billing Read. The effective CPU ceiling is therefore **unconfirmed**. The observed 11 ms `exceededCpu` response is consistent with the documented Workers Free 10 ms request ceiling, but do not infer the plan from that alone. **Do not call `POST /admin/m15/fatman/prepare` or click Build again** until the account plan and deployed staging CPU limit have been verified and the effective budget is resolved. Then resume at page 281 without re-exporting or re-OCRing.

M15 human review remains explicitly waived. After both staging indexes reach 538/538, run the frozen 12-case paired benchmark with Agent A `gemini-4-argon`, Agent B `gemini-3.8-flash`, and Argon adjudication on material disagreement. No provider winner, production cutover or capacity proof exists yet.
