# BRVIN M15 owner-waived AI passage assessment

**Assessment date:** 12 November 2026  
**Core issue:** [#144 — M15 shadow benchmark relevance, math fidelity, security, load and cost](https://github.com/ashini-x/parmar-ai/issues/144)  
**Owner approval:** The project owner explicitly authorized an AI-assisted assessment in place of independent human review for this M15 staging gate.  
**Status:** Complete under owner waiver; **not independent human qrels**.

## Scope and method

The assessment covers all 109 source-provenanced candidates from the fixed 17-query paired staging receipt: 24 Cloudflare AI Search candidates and 85 Qdrant + Vertex candidates. The original eight-page synthetic Physics PDF was inspected against its exact source SHA-256:

`cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92`

Each candidate was graded 0–3 using the existing M15 rubric. Judgments use the complete query and passage text and source-PDF context; retrieval rank and score were not used as relevance evidence. Positive queries, four out-of-corpus negatives and the H01 exact-symbol near-miss were assessed separately.

The machine-readable artifact is `test/fixtures/brvin-m15-owner-waived-ai-passage-assessment.json`. It stores an `ownerApprovedAiAssessment` grade and rationale on every passage. The original human-review fields (`reviewerA`, `reviewerB`, `adjudicatedGrade`) remain blank. A test verifies all 109 annotations and recomputes the stored metrics.

## Results on the 12 positive queries

| Metric | Cloudflare AI Search | Qdrant + Vertex |
|---|---:|---:|
| Queries with at least one grade-2+ result in top five | 12/12 | 12/12 |
| Returned candidates | 22 | 60 |
| Grade-2+ candidates | 19 | 22 |
| Precision among returned candidates | 86.4% | 36.7% |
| Fixed-depth precision@5 (60 possible slots) | 31.7% | 36.7% |
| Mean nDCG@5 | 0.9977 | 0.9905 |
| Mean reciprocal rank of first grade-2+ result | 1.0000 | 1.0000 |

Both providers retrieved a directly relevant result at rank 1 for every positive query. Cloudflare AI Search is much more selective across the returned candidate pool. Qdrant returns five passages for every positive query, which adds lower-ranked noise; however, it has one additional grade-2+ candidate overall and therefore slightly higher fixed-depth P@5. The nDCG/MRR results are close because both providers consistently place a directly relevant passage first.

## Negative controls and exact-symbol near-miss

| Measure | Cloudflare AI Search | Qdrant + Vertex |
|---|---:|---:|
| Out-of-corpus queries with returned candidates | 0/4 | 4/4 |
| Out-of-corpus candidates returned | 0 | 20 |
| Out-of-corpus candidates graded 2+ | 0 | 0 |
| Out-of-corpus candidates graded 0 | 0 | 15 |
| Out-of-corpus candidates graded 1 (related context only) | 0 | 5 |
| H01 grade-3 evidence rank | 1 | 1 |

For N01–N04, AI Search returned no candidates. Qdrant returned 20 candidates, none answer-bearing: 15 were irrelevant and five were only broad mechanical-force context. This is a measurable retrieval-noise/abstention burden for the consumer, even though the saved Gemini run abstained correctly on all four no-answer prompts with Qdrant evidence present.

For H01, both providers rank the page-8 passage first. It explicitly identifies the true source equation as `F_s = −k × x` and rejects `F_s = +k × x`; this is directly relevant evidence for the false-premise query. Qdrant's other four H01 candidates are unrelated.

## Interpretation and decision

The owner-waived assessment supports this staging conclusion:

- Qdrant + Vertex has a clear measured retrieval-latency advantage in the saved 17-query sequential staging run (p50 784 ms / p95 1,097 ms versus AI Search 2,524 ms / 10,477 ms).
- Both providers have the same top-rank positive-query hit rate (12/12) and the same MRR (1.0) under these AI-assigned labels.
- AI Search has substantially higher precision among returned candidates; Qdrant supplies more lower-ranked noise and all 20 candidates on the four out-of-corpus prompts.
- Neither system has demonstrated a production load/SLO result. The latency observations are 17 sequential staging samples, not a concurrency benchmark.

**Recommendation:** keep Qdrant as the leading performance candidate in staging, but do not declare it a quality winner or cut over production. Continue M15 with live authorization/revocation, broader multi-document and formula fidelity, recovery, representative concurrency/load, repeatable latency/throughput/cost and rollback. Query filtering/reranking/limit tuning should be measured against this fixed graded pool rather than guessed.

## Limitations

1. This is one AI assessor acting under the explicit project-owner waiver. It replaces the need to wait for human review for this internal staging decision, but it does not create independent human qrels or inter-rater agreement.
2. The pool contains only the saved top-five-or-fewer results for 17 queries. Recall over all corpus passages cannot be calculated from this truncated candidate pool.
3. The suite is a small controlled eight-page Physics corpus. Metrics are descriptive for this fixed suite, not population estimates.
4. Positive precision among returned candidates has a variable denominator because AI Search sometimes returned fewer than five candidates. Fixed-depth P@5 is also provided to make the comparison visible at a constant denominator.
5. These passage grades do not alter the original PDF, raw OCR, normalized corpus, GCS manifests, AI Search items or Qdrant points. They do not fix OCR glyph defects.
6. This artifact does not itself prove live D1-to-Qdrant authorization/revocation, system load, production latency, cost, retry/recovery or rollback.

The owner-waived passage assessment may be used to continue M15 staging work. It is not permission to change the production provider or skip the remaining M15/M16/M17 release gates.
