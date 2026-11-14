# BRVIN M15 — full-corpus Fatman two-agent provider benchmark

**Status:** implementation branch; staging-only validation and execution pending  
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
