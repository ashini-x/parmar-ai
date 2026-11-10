# BRVIN M14 Physics pilot — source-grounded chunk qrels v0.1

**Date:** 10 November 2026  
**Corpus:** `brvin_m14_physics_pilot_v1`  
**Source:** `Force and Laws of Motion - Class IX pilot handout`  
**Source SHA-256:** `062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c`  
**Scope:** Seven immutable Qdrant chunks, ten positive query-suite cases and two reviewed no-match cases.

## Why this file exists

The previous staging receipt exposed full stored chunk text and point IDs. The original three-page PDF was read page by page and compared with those exact chunk texts. This document records a **source-grounded model adjudication** of relevance; it is not a claim that an independent human annotator reviewed the labels. It is intended to replace a blank qrels requirement with a reproducible first-pass benchmark that can be used directly in the pilot and later revised if contradictory source evidence is found.

The labels are based on whether the chunk itself contains the information needed for the query, not merely whether it shares a page number or a keyword. Physical page labels remain separate from chunk relevance.

## Grading rubric

| Grade | Meaning |
|---:|---|
| 3 | Direct answer or primary evidence. The chunk contains the requested worked example, rule, answer or exact formula. |
| 2 | Strong supporting evidence. It explains an essential part of the answer but is not the best standalone passage. |
| 1 | Related context. Useful background, but insufficient to answer the query on its own. |
| 0 | Not relevant to the query, or the requested item is absent. |

For the two no-match prompts, every corpus chunk is grade 0 by design. A non-zero retrieval score is not relevance and does not authorize an answer.

## Immutable chunk inventory

| Key | Point ID | Physical page | Stored content role |
|---|---|---:|---|
| P1-overview | `6bb2552e-417c-5169-822f-93c91a8b752f` | 1 | Force definition; balanced/unbalanced forces; introductory concepts |
| P1-inertia | `c601e70a-8570-5122-ab56-4d23b9f334c9` | 1 | Inertia and bus starting/braking explanation |
| P2-laws | `057bcdfa-b2bb-535f-8dc4-f47f1c1229df` | 2 | Newton's laws; second-law explanation; friction and force context |
| P2-tail | `020b9743-4a6f-5211-8836-b044137502f7` | 2 | Formula tail, net-force misconception and third-law material |
| P3-worked | `be24fe40-ee0d-5324-8f77-3baab3322c69` | 3 | 4 kg rough-floor example: 20 N pull, 8 N friction, 12 N net force, 3 m/s² |
| P3-answer | `2971ad8d-59c4-5a97-8779-15a5c874b132` | 3 | Answer key for learner practice, including bus-braking explanation |
| P3-attribution | `0a2a4f69-be34-5482-b861-4cdf2c8c94f7` | 3 | Source attribution and license details |

## Query-to-chunk relevance matrix

Values are graded relevance, not probabilities or confidence scores.

| Query-suite case | P1-overview | P1-inertia | P2-laws | P2-tail | P3-worked | P3-answer | P3-attribution |
|---|---:|---:|---:|---:|---:|---:|---:|
| newtons-second-law-concept | 1 | 0 | 3 | 2 | 1 | 0 | 0 |
| newtons-second-law-exact-formula | 0 | 0 | 3 | 3 | 1 | 0 | 0 |
| net-force-paraphrase | 2 | 0 | 3 | 2 | 1 | 0 | 0 |
| force-mass-acceleration-equivalent-notation | 1 | 0 | 3 | 3 | 2 | 1 | 0 |
| uppercase-force-symbol | 0 | 0 | 3 | 3 | 1 | 0 | 0 |
| four-kilogram-worked-example | 0 | 0 | 1 | 0 | 3 | 0 | 0 |
| numerical-force-setup | 0 | 0 | 1 | 0 | 3 | 0 | 0 |
| theory-plus-formula | 1 | 0 | 3 | 3 | 1 | 0 | 0 |
| friction-and-net-force | 1 | 1 | 2 | 1 | 3 | 0 | 0 |
| bus-braking-answer | 0 | 3 | 0 | 0 | 1 | 3 | 0 |
| lowercase-force-symbol-hard-negative | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| out-of-corpus-constant | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Evidence basis for the non-zero judgments

- **P1-overview:** PDF page 1 defines force and states that unequal opposite forces produce acceleration in the direction of the larger resultant force. It is useful general context for the paraphrase and mixed-concept questions, but it does not contain the second-law equation or the 4 kg example.
- **P1-inertia:** PDF page 1 defines inertia and explicitly explains why a passenger tends to keep moving forward when a bus brakes. That makes it direct evidence for the bus-braking case, not for the friction calculation.
- **P2-laws:** PDF page 2 explains Newton's first and second laws, acceleration in the direction of net force, the effect of increasing net force at fixed mass, the canonical `Fnet = m × a` equation and the football/friction example. This is primary evidence for conceptual, formula and force/friction queries.
- **P2-tail:** The stored tail chunk retains the `Fnet = ma` expression, the statement that net force is the resultant force, and the idea that a net force changes velocity. It is direct formula/symbol evidence and strong supporting evidence for the second-law explanation, but it is not the 4 kg worked example.
- **P3-worked:** PDF page 3 contains the 4 kg box, 20 N rightward pull, 8 N leftward friction, 12 N rightward resultant and 3 m/s² acceleration. It is the direct passage for the worked-example, numerical-setup and friction queries.
- **P3-answer:** PDF page 3's answer key gives the bus-braking inertia explanation and seat-belt stopping force. It is direct answer-key evidence for the bus-braking query; the separate worked-example chunk contains only the practice-question prompt.
- **P3-attribution:** This chunk contains attribution and license text, not physics content needed by any query, so it is grade 0 across the suite.

### No-match interpretation

The exact lowercase `f = ma` expression does not occur on any of the three source pages. The source prints uppercase `Fnet = m × a`. Therefore the uppercase formula chunks are not relevant answers to the lowercase-symbol request, even though they are topically similar.

The Planck constant and its SI value do not occur on any source page. All seven chunks are therefore grade 0 for the Planck query. Retrieval must not turn an unrelated high rank-fusion score into a numerical answer.

## Friction query: baseline replay and provisional weighted ordering

The v72 authenticated receipt contains three repeated equal-weight result orders with the same five-point set. Applying the grades above (relevance threshold grade 2) gives:

| Baseline repeat | Grades in retrieved order | First grade-2+ rank | nDCG@5 |
|---|---|---:|---:|
| 1 | 1, 2, 3, 1, 1 | 2 | 0.7062 |
| 2 | 3, 2, 1, 1, 1 | 1 | 1.0000 |
| 3 | 1, 3, 2, 1, 1 | 2 | 0.7575 |
| **Mean baseline** | — | **MRR 0.6667** | **0.8212** |

Replaying the same dense and sparse component lists with the semantic 70/30 policy produces the predicted order:

1. P3-worked — 0.4000000
2. P2-laws — 0.3333333
3. P1-overview — 0.2666667
4. P1-inertia — 0.2500000
5. P2-tail — 0.2000000

The resulting grades are `3, 2, 1, 1, 1`, giving predicted MRR 1.0000 and nDCG@5 1.0000 for this one friction query.

**Important limitation:** this is an in-sample, source-grounded replay of the same friction component ranks that motivated the weight choice. It demonstrates the expected score arithmetic and the relevance-aware direction of the change; it is not an independent benchmark or proof of general improvement. The full ten-positive suite has not yet been rerun on staging version 73. Compare all ten live result lists against this matrix before promoting the weights beyond the isolated pilot.

## Formula-intent routing policy

The staging fusion intent classifier must treat both literal mathematical notation and worded formula requests as symbolic. Worded cues include `equation`, `formula`, `expression`, `symbol`, `notation`, `uppercase`, `lowercase`, `case-sensitive`, and `multiplied by` / `divided by`. Natural-language conceptual, paraphrase, worked-example, friction and bus-braking prompts remain semantic unless they contain an explicit formula/symbol cue.

The two reviewed no-match prompts remain retrieval-only cases. These chunk labels do not establish model abstention; the Teachers repository still has no deployed Gemini answer-generation route.

## Acceptance boundary

This matrix is a usable first-pass, source-grounded adjudication set for M14/M15 retrieval benchmarking. Preserve the original PDF SHA, point IDs, chunk IDs and query text when scoring it. Report nDCG@5, MRR@5, recall of grade-2+ chunks, formula/symbol exactness, no-match retrieval behavior and per-query regressions. Keep page-coverage metrics separate from chunk relevance. Do not tune the fusion weights on the friction case alone and then call the same case an independent validation.


## Live M14 version-74 authenticated diagnostic — 10 November 2026

The authenticated non-gating negative + rank-stability diagnostic returned `ok: true` for the same immutable project/source/collection and seven-point corpus. The source, point IDs and chunk IDs match the qrels inventory above; no re-index or OCR was performed.

### Friction repeatability and qrels score

The friction prompt was repeated three times. All three calls returned the same ordered five-point list:

| Rank | Chunk key | Point ID | qrels grade |
|---:|---|---|---:|
| 1 | P3-worked | `be24fe40-ee0d-5324-8f77-3baab3322c69` | 3 |
| 2 | P2-laws | `057bcdfa-b2bb-535f-8dc4-f47f1c1229df` | 2 |
| 3 | P1-overview | `6bb2552e-417c-5169-822f-93c91a8b752f` | 1 |
| 4 | P1-inertia | `c601e70a-8570-5122-ab56-4d23b9f334c9` | 1 |
| 5 | P2-tail | `020b9743-4a6f-5211-8836-b044137502f7` | 1 |

The retrieved grade sequence is `3, 2, 1, 1, 1`, matching the ideal ordering for this five-result set:

- **nDCG@5: 1.0000**
- **MRR@5 (first grade-2+ chunk): 1.0000**
- **Recall@5 of grade-2+ chunks: 2/2 = 1.0000**
- **First expected page rank: 1 in all three repeats**
- **Repeatability:** one distinct ordered sequence, one distinct top-five set; `rankStableAcrossRepeats: true`

This is a successful live staging result for one repeated friction prompt. It is not an independent multi-query benchmark and does not establish general retrieval quality or a latency/cost improvement.

The component traces for the friction prompt show dense ranks P3-worked 1, P2-laws 2, P1-inertia 3, P2-tail 4, P1-overview 5; sparse ranks P1-overview 1, P2-laws 2, P1-inertia 3, P2-tail 4, P3-worked 5. The intent-weighted fusion returned the direct worked example first and the supporting law explanation second. Raw dense and sparse scores remain on different scales and must not be compared as confidence.

### Live expected-no-match retrieval observations

Both reviewed negative prompts were marked `expectedNoMatch: true`, but the retrieval action returned five candidates for each:

| Case | Result count | Top RRF score | Qrels relevance of returned candidates | Interpretation |
|---|---:|---:|---|---|
| `lowercase-force-symbol-hard-negative` | 5 | 0.425 | All five grade 0 | No source chunk contains the requested lowercase `f = ma`; returned formula-adjacent chunks do not satisfy this case-sensitive request. |
| `out-of-corpus-constant` (Planck constant) | 5 | 0.5 | All five grade 0 | All five candidates are unrelated to the requested constant and its SI value. |

These results are expected-no-match **retrieval candidates**, not an answer-generation abstention test. The diagnostic explicitly states that it invokes no Teachers Gemini answer/abstention path. A non-zero RRF score is not a confidence probability and cannot authorize an answer. No abstention pass/fail is claimed.

### M14 follow-up

The authenticated ten-positive-query receipt has not yet been supplied. Run it on the same staging Worker and score every live result list against the complete qrels matrix before treating the initial 70/30 semantic and 30/70 symbolic weights as accepted. Preserve per-query regressions and formula/symbol exactness; keep the negative cases separate from answer-abstention acceptance. Two-component-call latency/cost, authorization isolation, revocation, retry/recovery, HNSW/resource tuning and load benchmarks also remain open.


## Live M14 version-74 ten-positive-query receipt — 10 November 2026

The authenticated positive suite returned `ok: true` for all ten positive cases against the immutable seven-chunk Physics corpus. It returned 50 candidates in total and reported:

- Expected physical pages: **11/11 covered in top five (100%)**.
- Expected-page-labelled results: **20/50**.
- Strict expected-page-label precision proxy@5: **0.4000**.
- Mean reciprocal rank of the first expected physical page: **0.8333333**.
- All ten queries completed; the two expected-no-match cases were explicitly deferred to the separate negative diagnostic.

First expected-page ranks in the live receipt:

| Positive query | First expected-page rank | Additional expected-page rank |
|---|---:|---:|
| newtons-second-law-concept | 1 | — |
| newtons-second-law-exact-formula | 2 | — |
| net-force-paraphrase | 3 | — |
| force-mass-acceleration-equivalent-notation | 1 | — |
| uppercase-force-symbol | 2 | — |
| four-kilogram-worked-example | 1 | — |
| numerical-force-setup | 1 | — |
| theory-plus-formula | 1 | — |
| friction-and-net-force | 1 | — |
| bus-braking-answer | 1 | 3 (the second expected page) |

The earlier recorded equal-weight ten-query page-rank baseline was mean reciprocal expected-page rank **0.7833333** with the same 11/11 coverage and 0.4000 page-label precision proxy. The fresh v74 receipt is therefore +0.0500 on this page-level MRR proxy, with no change in page coverage or page-label precision proxy. This is a descriptive comparison of expected-page ranking only.

**Critical limitation:** the v74 positive receipt returned only physical page numbers/ranks and did not include point IDs, chunk IDs or stored text. It therefore cannot be joined to this seven-chunk relevance matrix. Do not claim that this run has chunk-level nDCG, chunk-level MRR, chunk recall, exact formula fidelity, or answer correctness. In particular, the exact-formula, paraphrase and uppercase-symbol cases find the expected page at ranks 2, 3 and 2, but the receipt cannot show which formula chunk was retrieved or whether the canonical `Fnet = m × a` passage ranked well.

Core PR #199 is adding ranked Qdrant point/chunk IDs, per-query intent weights and deduplicated full chunk text to the protected positive evaluation receipt. Once its checks pass and the updated staging Worker is deployed, rerun the same ten-query action and score each returned top-five chunk list against the matrix in this document. Qrels remain assistant-adjudicated, source-grounded labels rather than independent human gold judgments.


## Live M14 version-75 ten-query chunk-qrels evaluation — 10 November 2026

The authenticated version-75 positive evaluation receipt includes all seven unique Qdrant candidates, their deterministic chunk IDs, full stored text, and each query's top-five rank/score. Every returned point ID and chunk ID matched the seven-entry source-grounded qrels inventory above. The ten checks returned 50 candidates in total, with all grade-2+ chunks retrieved for every query.

### Aggregate chunk-level results

Scoring uses the source-grounded assistant-adjudicated matrix above. nDCG@5 uses graded gain (2^{rel}-1) with logarithmic rank discount and ideal DCG over the seven corpus chunks truncated at five. MRR@5 uses the first retrieved chunk with grade >=2. Recall@5 is the fraction of all grade-2+ qrels chunks returned in the top five. Precision@5 is the fraction of top-five results graded >=2. Macro averages give each of the ten queries equal weight; because every query returns five results, macro precision equals 20/50 here.

| Metric | Version-75 result |
|---|---:|
| Queries scored | 10/10 |
| Unique corpus points/chunks represented | 7/7 |
| Retrieved candidates | 50 |
| Grade-2+ relevant chunk occurrences retrieved | 20/20 |
| Macro nDCG@5 | **0.8556** |
| Macro MRR@5 (first grade >=2) | **0.8500** |
| Macro Recall@5 (grade >=2) | **1.0000** |
| Macro Precision@5 (grade >=2) | **0.4000** |
| Queries with a grade-2+ chunk at rank 1 | **7/10** |

These are chunk-level metrics now that candidate IDs were joined to qrels; they are still measured against assistant-adjudicated labels, not independent human gold judgments.

### Per-query results

Grades are listed in retrieved rank order.

| Query | Grades@5 | nDCG@5 | MRR@5 | Recall@5 |
|---|---|---:|---:|---:|
| newtons-second-law-concept | 2, 3, 1, 0, 1 | 0.8453 | 1.0000 | 100% (2/2) |
| newtons-second-law-exact-formula | 0, 3, 3, 0, 1 | 0.6968 | 0.5000 | 100% (2/2) |
| net-force-paraphrase | 2, 0, 3, 2, 1 | 0.7557 | 1.0000 | 100% (3/3) |
| force-mass-acceleration-equivalent-notation | 3, 1, 0, 3, 2 | 0.8596 | 1.0000 | 100% (3/3) |
| uppercase-force-symbol | 1, 3, 3, 0, 0 | 0.7482 | 0.5000 | 100% (2/2) |
| four-kilogram-worked-example | 3, 0, 1, 0, 0 | 0.9828 | 1.0000 | 100% (1/1) |
| numerical-force-setup | 3, 0, 1, 0, 0 | 0.9828 | 1.0000 | 100% (1/1) |
| theory-plus-formula | 3, 1, 3, 1, 0 | 0.9364 | 1.0000 | 100% (2/2) |
| friction-and-net-force | 3, 2, 1, 1, 1 | 1.0000 | 1.0000 | 100% (2/2) |
| bus-braking-answer | 1, 3, 3, 0, 0 | 0.7482 | 0.5000 | 100% (2/2) |

### Intent-routing and ranking observations

All ten queries received the expected broad intent split in the receipt: six semantic queries used dense/sparse 0.7/0.3; four formula/symbol/mixed-formula queries used 0.3/0.7. This confirms that the currently implemented worded cues are routing these reviewed prompts as intended; it does not prove optimal weights.

The four symbolic queries as a group scored mean nDCG@5 **0.8103**, MRR@5 **0.7500**, grade-2+ recall@5 **100%**, and precision@5 **0.4500**. The six semantic queries scored mean nDCG@5 **0.8858**, MRR@5 **0.9167**, grade-2+ recall@5 **100%**, and precision@5 **0.3667**. The subsets are very small and reflect this single seven-chunk corpus only.

**Formula/symbol ranking needs targeted follow-up:**
- Exact-formula query: page-1 overview (grade 0 for this exact-formula qrel) ranked first; the direct page-2 second-law chunk ranked second and the formula-tail chunk ranked third. MRR is 0.5.
- Uppercase-symbol query: the page-3 worked-example chunk (grade 1 related context) ranked first; direct page-2 formula evidence ranked second and third. MRR is 0.5.
- Equivalent-notation and theory-plus-formula queries each ranked the direct page-2 law chunk first.
- Bus-braking answer: the page-3 worked-example chunk (grade 1) ranked first, answer-key evidence ranked second and page-1 inertia evidence third. Both grade-3 passages are present in the top five.

All grade-2+ chunks are nevertheless present in the top five for every positive query. Do not raise the global symbolic sparse weight solely from this tiny sample. First inspect dense/sparse component ranks for the exact-formula and uppercase-symbol prompts, then consider a narrowly scoped formula-evidence ranking improvement and rerun the same qrels suite. Keep current weights provisional until broader multi-document validation, negatives, latency/cost and authorization/recovery/load gates pass.

The page-level 11/11 coverage, 0.4000 physical-page-label precision proxy and 0.8333333 expected-page MRR remain separate receipt metrics. The equality between page-label precision proxy 0.40 and chunk Precision@5 0.40 in this run is coincidental; their definitions and denominators differ. The two expected-no-match prompts are excluded from this positive scoring and remain retrieval-only; no answer-abstention pass/fail is asserted.
