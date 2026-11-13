# BRVIN M15 relevance-gate feasibility and ablation

**Checkpoint:** 14 November 2026  
**Status:** Exploratory offline feasibility check — **NO GATE SELECTED; NO RUNTIME POLICY CHANGE**

## Evaluation material

The post-PR-247 five-case paired Core v2 staging receipt `fa1b8076-9375-480b-bb4b-e22d1c13d9bb` verifies the MS03 page-2 score-boundary fix. It does not resolve Qdrant's no-match candidate noise: Qdrant returns three unrelated passages for the two-source MN01 Planck/photon-energy query, while AI Search returns none.

The existing owner-waived candidate pool contains 109 source-provenanced passages from 17 queries on one eight-page synthetic Physics source: 24 AI Search and 85 Qdrant candidates. It includes 12 positives, four out-of-corpus no-match controls and one exact-symbol near-miss (H01). Candidate grades are owner-approved AI assessments; independent reviewer fields and adjudicated human grades remain blank. These are not independent human qrels.

Qdrant returned 20 passages across N01–N04: 15 grade 0 and five grade 1; none was grade 2+. H01 is different: its top Qdrant passage is grade 3 because it correctly identifies the source's negative-sign equation and rejects the positive-sign premise. H01 must not be treated as a true no-evidence abstention case.

## Offline ablations

The test-only evaluation compares no gate, fixed RRF score cutoffs and a single-feature lexical-coverage proxy. The latter two use leave-one-query-out calibration: each complete query is held out, the threshold is selected on the remaining query groups, and candidate rows from the same query never appear in both sets. The simple calibration objective preserves at least one grade-2+ result for every positive training query, then maximizes cleared out-of-corpus training queries.

| Approach | Held-out positive queries retained | Held-out out-of-corpus queries cleared | Result |
|---|---:|---:|---|
| No gate | 12/12 | 0/4 | All 20 Qdrant negative candidates remain |
| Fixed RRF cutoff `>= 0.38` | 12/12 | 3/4 | N04 remains noisy |
| Fixed RRF cutoff `>= 0.42` | 11/12 | 4/4 | P02 is falsely abstained |
| LOQO lexical query-term coverage | 11/12 | 4/4 | P06 is falsely abstained |

Both single-feature gates retained H01's grade-3 correction passage, but neither meets the positive-recall requirement. RRF values are rank-fusion signals, not calibrated relevance probabilities. The lexical feature is distinct non-stopword query-token coverage; it is not a semantic model, exact-symbol verifier or complete evidence-sufficiency gate.

This is a feasibility diagnostic on one source/subject and owner-waived labels, not a calibrated production model. The new two-source MN01 result is an additional negative diagnostic; its candidates are not part of the 109-candidate labelled pool.

## Decision

**No relevance gate, RRF threshold, lexical cutoff or reranker is selected. Do not change runtime behavior.**

Keep the current Core Qdrant retrieval path unchanged in staging and production. Preserve the 0.2 score floor, RRF weights, prefetch/limit and the private v2 response contract. Keep the three MN01 candidates visible as a known quality limitation. Production remains on Cloudflare AI Search.

Running another model to grade the same 109 candidates would not create independent human evidence. A model-based reranker remains an optional later experiment, not an approved policy.

## Required next evidence

1. Complete or explicitly waive and record independent passage/span qrels for the existing M15 review pack; do not overwrite owner-waived labels.
2. Expand the evaluation to multiple documents and distinct subject/query families: conceptual paraphrases, formula/symbol variants, calculations with changed operands/units, mixed theory-plus-math and genuine out-of-corpus questions.
3. Split calibration and evaluation by source/query family, not candidate row. Hold out at least one source or subject family to measure domain transfer.
4. Run a read-only multi-feature ablation against the no-gate baseline using query/passage relevance, exact symbol/formula agreement, lexical evidence, candidate separation and dense/sparse agreement. Authorization and physical-page provenance remain hard checks outside all models.
5. Benchmark a named reranker only when a suitable model and candidate budget are selected. Compare both providers with and without the same reranker; report human-labelled nDCG/MRR/precision/recall, false abstention, negative false acceptance, formula/symbol recall, p50/p95 latency and per-query inference cost.
6. Select an operating point only on held-out evidence that preserves an explicit positive-recall floor and reduces unsupported/no-match acceptance. Keep H01 separate from no-evidence abstention controls.

M15 remains open for broader grounding, recovery/throttling, HNSW-aware representative peak load, repeatable latency/throughput/cost, shared quota redesign and rollback. M16 UI/consumer parity and M17 controlled canary/14-day AI Search rollback soak remain separate gates.

## Reproduction

The deterministic calculations are in `test/brvin-m15-owner-waived-ai-passage-assessment.test.ts` and run with the normal Core `npm test` suite. They consume the committed fixture and do not call external models/providers, reserve D1 quota or modify source/index/Worker state.
