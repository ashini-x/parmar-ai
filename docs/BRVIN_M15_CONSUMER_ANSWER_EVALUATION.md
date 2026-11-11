# BRVIN M15 — Consumer answer and abstention evaluation

**Date:** 11 November 2026  
**Status:** Evaluation harness implemented on branch; live Gemini execution and answer-quality acceptance are pending.  
**Production status:** Cloudflare AI Search remains selected. No provider cutover or production deployment is authorized by this work.

## 1. Why this is a separate gate

The second-source M15 retrieval-only benchmark and the consumer answer-generation benchmark answer different questions.

The retrieval-only test checks whether each provider returns source-scoped candidate passages and expected physical PDF pages. It does not test whether a model answers those passages correctly, cites the right page, preserves mathematical notation, or abstains when retrieved text is irrelevant.

The existing BRVIN v2 RPC is a retrieval contract. It returns retrieved passages and provenance; it does not call Gemini or own answer generation. The consumer-owned Gemini generator is implemented in `src/ai/gemini.ts`. Its existing Fatman book-mode call path is separate from BRVIN v2. This evaluation reuses the same `generateGeminiAnswer` function and Vertex AI request/response validation. It does **not** claim that BRVIN v2 already has a live Gemini consumer integration.

An additive, optional `GroundedGeminiSourceContext` parameter allows an isolated consumer to give the existing generator generic source excerpts. Existing callers that omit it keep their previous behavior. The M15 staging adapter is the only new caller in this evaluation. It does not replace the consumer-owned generator or modify the BRVIN v2 RPC contract.

## 2. Fixed test inputs

Use only the already-indexed, fingerprint-pinned M15 source:

| Field | Value |
|---|---|
| Source | `BRVIN_M15_Physics_Benchmark_Source_v1.pdf` |
| SHA-256 | `cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92` |
| Physical PDF pages | 8 |
| Immutable generation | `2dc9d4fae3afe7df16927fbf2510afd3` |
| Cloudflare AI Search | `brvin-m15-physics-staging-v1` |
| Qdrant collection | `brvin_m15_physics_benchmark_v1` |
| Embedding model | `gemini-embedding-001`, 768 dimensions |
| Embedding region | `asia-south1` |

The evaluation uses the original `M15_BENCHMARK_QUERY_SUITE` without changing query text or expected retrieval page labels:

- **P01–P12:** positive Physics concepts and calculations.
- **N01–N04:** four out-of-corpus controls (capacitor, Ohm's-law circuit, Lorentz force, and ideal gas law).
- **H01:** exact-symbol near-miss asking for `F_s = +k × x`.

H01 retains `expectedNoMatch: true` in the retrieval suite because the exact positive-sign expression is not in the source. That retrieval label does **not** mean the answer should abstain. The source's page 8 supports a correction: `F_s = −kx`; the answer must identify the positive-sign restoring-force expression as incorrect for this source. Only N01–N04 are abstention controls.

## 3. Evaluation flow

The new staging-only operator is served at:

`https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/benchmark/answers`

The page exposes two authenticated endpoints:

- `GET /admin/m15/benchmark/answers/source`: read the one source row matching the pinned SHA-256 from the isolated M15 staging D1 registry.
- `POST /admin/m15/benchmark/answers/run`: evaluate one fixed query ID against both staging providers.

For each query ID, the worker:

1. Confirms `ENVIRONMENT=staging`, the M15 staging flag, the exact source SHA-256, the eight-page source state, and both completed staging indexes.
2. Queries the dedicated M15 AI Search instance using the same source folder filter, hybrid retrieval, BGE reranker and top-five candidate limit as the paired retrieval runner.
3. Queries the dedicated M15 Qdrant collection with the same project ID, exact authorized source ID, top-five limit and prefetch size as the paired retrieval runner. It explicitly sets `ensureCollection: false`.
4. Checks candidate provenance. A candidate with an invalid source key or physical page is reported as a provenance violation and its text is not sent to Gemini.
5. Feeds the two providers' respective retrieved excerpts into two independent calls to the existing `generateGeminiAnswer` function. Both calls use the same query text, source-only system instructions, response schema, staging Gemini model and location.
6. Records full text for each valid retrieved candidate, its rank, physical page, score, item key and provenance status; then records the generated answer, app-generated citation, generation latency, model/location and grading result.
7. Returns the complete pair to the browser. The UI loops through P01–P12, N01–N04 and H01, then offers JSON and Markdown downloads.

The Gemini source mode is deliberately restrictive: retrieved passages are data, not instructions; the generator must not use general knowledge, model memory, prior conversation or Google Search to fill gaps. Empty evidence is an explicit no-evidence state. The prompt instructs the model to preserve equation symbols, variable case, signs, units and directions, and to abstain when the source does not support an answer.

The Gemini answer itself is not asked to invent a page number. The evaluator appends a physical-page citation only when the expected source page is present in that provider's provenance-verified evidence and the answer is not an abstention. N01–N04 must have no citation. H01 is cited to PDF page 8 when that page is present in the retrieved evidence.

### Identical conditions and measured latency

For one query, the two retrieval operations run concurrently, followed by two Gemini generations using the same configured model and location. The model/location are read from the staging Worker environment; the code does not pin a second model or change the deployed production model. The answer latency is timed around the generator call only. Retrieval latency is reported separately and is not added to generation latency.

The comparison is paired by query ID and uses a single generation per provider/query. It is a small deterministic acceptance suite, not a repeatability, load, concurrency, or production latency benchmark. Gemini sampling may vary between runs.

## 4. Acceptance rubric

The report records, separately for Cloudflare AI Search and Qdrant + Vertex, for each of the 17 query IDs:

- Query ID, category and query text.
- Each retrieved candidate's rank, complete returned evidence text, physical PDF page, score, item key and provenance-valid flag.
- Generated answer and source citation.
- Answer correctness and its individual deterministic checks.
- Source-grounding correctness.
- Citation correctness.
- Mathematical-symbol fidelity (or N/A for non-mathematical controls).
- Abstention correctness (or N/A for positive queries and H01).
- Retrieval latency and Gemini generation latency.
- Overall pass/fail and exact failure-case labels.

### Positive cases P01–P12

The first-pass deterministic rubric checks the expected answer facts, including numerical result, units, sign and direction where the query requires them. The expected source page must be present in the evidence, every candidate must pass provenance validation, and the app-generated citation must cite exactly the expected physical page.

Important math checks include:

- P02: net force 6 N east; acceleration 3 m/s² east.
- P03: acceleration 3 m/s² forward.
- P04: net force 10 N.
- P05: weight 19.6 N.
- P06: mass remains constant while weight depends on local gravity.
- P07: kinetic friction 9.8 N and friction opposes motion.
- P08: static friction adjusts up to its maximum limit; it is not always at its maximum.
- P09: downslope component 19.6 N and normal force about 34 N.
- P10: final speed 4 m/s with the work–energy relationship.
- P11: change in momentum −4.5 kg·m/s and average force −90 N, preserving the negative direction.
- P12: restoring-force equation `F_s = −kx`, restoring force −10 N for the given stretch, and elastic potential energy 0.25 J.

P01 checks Newton's second-law relationship and the roles of net force, mass and acceleration.

### Negative cases N01–N04

Negative cases now report two distinct outcomes:

- **Abstention correctness:** the provider query succeeded; the answer explicitly says the indexed source does not provide sufficient evidence; it does not supply the unsupported result tested for that negative; and it attaches no source-page citation. This can pass with either empty evidence or irrelevant evidence.
- **Irrelevant-evidence resistance demonstrated:** abstention correctness passes **and** at least one provenance-valid, in-corpus passage was actually retrieved and supplied to Gemini. This separate field is false/not exercised when retrieval returns no candidate.

A failed provider query or Gemini generation error is not a pass. A successful zero-candidate query can pass no-evidence abstention, but it does not demonstrate that the generator ignored unrelated passages. Do not conflate the two outcomes.

### Exact-symbol near-miss H01

H01 is a source-supported correction, not an abstention. The original source PDF page 8 has now been visually inspected: it clearly prints `F_s = −k × x` and explicitly states that `F_s = +k × x` is not the restoring-force equation. The indexed OCR evidence and both generated answers instead render the expression as `F_s = -k xx`, losing the multiplication glyph/variable boundary. Both answers correctly reject the positive-sign premise and explain the negative sign, but they do not preserve the exact canonical notation. H01 therefore remains a genuine symbol-fidelity failure in the OCR-to-answer path, not merely a grading false negative. The original PDF, OCR output, manifests, and indexed items were not changed.

### Rubric limitation

The rubric is a transparent, deterministic first-pass check, not an independent semantic judge. The initial 11 November grade was over-strict on P07, P09 and P11: the generated answers satisfy the actual requested numerical tasks, but the initial rules demanded an unasked friction-direction sentence, assumed a particular order for the P09 label/value, and demanded verbal direction wording despite correct signed P11 results. The rubric has been calibrated in the feature branch and regression tests added; the original downloaded JSON remains immutable and retains its original counters.

Also, `sourceGroundingCorrectness` in this harness is a page-presence plus answer-rubric proxy, not independent claim-by-claim entailment. `citationCorrectness` checks the expected physical-page citation appended by the application and any model-written page references; it does not prove that every claim is supported by the cited passage. Human review of claim-to-passage support remains required before any migration acceptance decision.

## 5. Isolation and side-effect controls

The answer endpoints are available only when the Worker identifies itself as staging and the M15 staging flag is enabled. They authenticate with the staging operator bearer token.

For these two answer endpoints, the worker deliberately bypasses the existing staging schema-setup helper and uses D1 only for read-only `SELECT` operations. Evaluation results are held in page memory and downloaded by the operator. The evaluator does not persist results into D1.

It does not:

- Change `BRVIN_RETRIEVAL_PROVIDER` or any production provider selection.
- Modify the production worker, BRVIN v2 RPC, or consumer routing.
- Deploy production.
- Upload, re-OCR, replace, delete or mutate the M15 PDF, OCR output, manifests, AI Search items or Qdrant points.
- Run Qdrant collection creation or mutation; `ensureCollection: false` is mandatory.
- Change production D1, the production AI Search instance, Teachers, or any production binding.

The staging build workflow validates the branch with typecheck/tests and Wrangler dry-run. A manual `workflow_dispatch` from this feature branch deploys the M14/M15 staging Worker only. Do not merge this branch as part of the test run: the production release classifier treats `src/ai/gemini.ts` as a production runtime path, so merging it would enter the normal production release workflow.

## 6. Execution status on 11 November 2026

### Completed retrieval-only checkpoint (reported by the operator)

The user reported the completed `brvin-m15-second-source-paired-shadow` retrieval-only receipt with:

- 17 queries executed against both providers.
- 12/12 positive expected-page targets covered by both providers.
- Qdrant retrieval latency materially lower in this particular staging run.
- Qdrant returned candidates for all four out-of-corpus questions.
- H01 retrieved the corrective source page.
- Zero provenance violations.
- No indexing or production side effects.

These are recorded as the supplied retrieval checkpoint. They are not answer-generation results and do not imply answer correctness, source grounding, citations or abstention have passed.

### Consumer answer/abstention evaluator

**Implemented on branch:** `feat/m15-consumer-answer-evaluation-2026-11-11` (draft PR [#223](https://github.com/ashini-x/parmar-ai/pull/223)).

The code adds the optional generic source context to `generateGeminiAnswer`, the paired M15 retrieval/generation adapter, the authenticated read-only staging routes, a browser report page, and initial grading regression tests. The staging workflow is configured to validate the changed Gemini source and permits manual staging-only deployment from the selected feature branch.

**Code validation passed on 11 November 2026:** M14 staging workflow [#133](https://github.com/ashini-x/parmar-ai/actions/runs/43053029554) passed on the current PR head, including typecheck, all M14/M15 tests, Vertex/Qdrant config verification and Wrangler staging dry-run. Release validation [#1136](https://github.com/ashini-x/parmar-ai/actions/runs/43053029466) also passed on the current PR head (typecheck/test/build). Deployment and production verification jobs were skipped. Earlier, the calibrated code/test commit also passed M14 workflow #124 and Release validation #1133.

### Completed consumer answer/abstention run — 11 November 2026

The operator executed all 17 query pairs successfully. The raw JSON and Markdown report were attached to the conversation.

| Run field | Value |
|---|---|
| Run timestamp | 2026-11-11 15:32:24 UTC (21:02:24 IST) |
| Source ID | `3b4d116d-4c18-450f-9cba-cb2bec3da7ca` |
| Model / location | `gemini-3.8-flash` / `global` |
| Completed pairs | 17/17 |
| Generation calls | 34 |
| Request failure | None |

**Original automated counters from the downloaded receipt (before rubric calibration):**

| Metric | Cloudflare AI Search | Qdrant + Vertex |
|---|---:|---:|
| Overall pass | 9/17 | 13/17 |
| Failed IDs | P07, P09, P11, N01–N04, H01 | P07, P09, P11, H01 |
| Answer correctness | 9/17 | 13/17 |
| Source-grounding proxy | 9/17 | 13/17 |
| Appended page-citation check | 17/17 | 17/17 |
| Math-symbol check | 8/12 | 8/12 |
| Abstention correctness (original strict definition) | 0/4 | 4/4 |
| Mean Gemini generation latency | 7,430.06 ms | 6,011.24 ms |
| Median Gemini generation latency | 5,580 ms | 5,560 ms |

**Manual review of the actual answers and supplied evidence found:**

- **P07:** both providers calculate the requested kinetic-friction magnitude as 9.8 N. The original grader additionally required a friction-direction statement that the query did not request and that cannot be specified without a motion direction.
- **P09:** both providers give 19.6 N for the downslope component and 33.95 N for the normal force. The original grader missed the correct answer because its regular expression coupled the word “downslope” to a narrow position around the number.
- **P11:** both providers give `Δp = −4.5 kg·m/s` and `F_avg = −90 N`. The negative signs preserve the direction. The original grader incorrectly required a verbal phrase such as “negative direction” or “opposite direction.”
- **N01–N04:** both providers generated explicit source abstentions for all four queries. Cloudflare AI Search returned no candidates on all four, so this demonstrates no-evidence abstention (4/4), but does not exercise resistance to irrelevant passages (0/4). Qdrant returned unrelated in-corpus candidates and Gemini abstained in all four cases (4/4), which does demonstrate irrelevant-evidence resistance.
- **H01:** the original PDF page 8 visibly prints `F_s = −k × x` and states that `F_s = +k × x` is not the restoring-force equation. Both generated answers reject the positive-sign premise and explain the negative sign, but repeat the indexed OCR rendering `F_s = -k xx`. This is a real exact-symbol-preservation failure caused by the indexed OCR representation reaching Gemini; the original source PDF is correct. The original grading rule also falsely failed the semantic rejection check because its regular expression did not cover both answer phrasings.

The three P07/P09/P11 failures are rubric false negatives, not answer calculation failures. With the calibrated answer rules applied offline to the same saved answers, the mechanical outcome would be **16/17 for each provider**, with H01 the remaining exact-notation failure. This is a rubric re-grade, not a second Gemini run. The raw attached receipt is not rewritten.

**Latency interpretation:** per-query retrieval averaged 1,993.65 ms (median 1,652 ms) for AI Search and 788.29 ms (median 792 ms) for Qdrant. Qdrant was materially faster in this one staging sample. Gemini generation medians were effectively identical (5,580 vs 5,560 ms); the AI Search mean is pulled upward by P08 (20,880 ms) and N02 (18,782 ms). The result does not establish a production SLO or repeatable generation-speed advantage.

**Citation and grounding caveat:** the 17/17 citation count is the expected physical-page citation check. It is not independent proof that every answer claim is entailed by its cited passage. The reported source-grounding counter also depends on expected-page presence and the deterministic answer checks. Claim-level grounding remains a human-review gate.

### Rubric calibration after the run

The feature branch now:
- Removes the unasked P07 direction requirement.
- Makes P09's result/downslope checks independent of answer ordering.
- Accepts signed P11 numerical results as direction preservation.
- Separates abstention correctness from whether the irrelevant-evidence challenge was actually exercised.
- Requires canonical H01 notation separately from sign-correction semantics.

Regression tests were added for these cases. These changes affect future staging evaluator executions/reports; they do not alter the downloaded run output or trigger more Gemini calls. Revalidate the updated branch before any further staging deployment.

**Execution status:** the 34 Gemini generations are complete. The answer review is partially accepted, with H01 exact notation and independent claim-level grounding still open. Do not rerun the 17-query generation suite merely to apply rubric corrections.

Do not paste the staging operator token into chat, GitHub issues, source files or the generated report.

## 7. Relevance gating and reranking — recommendations only

No permanent RRF confidence threshold is introduced or recommended from this 17-query benchmark. RRF scores and hybrid ranking values are ordering signals, not calibrated probabilities.

### Relevance-gating strategy to benchmark separately

Benchmark a two-stage gate rather than using one fixed RRF score cutoff:

1. **Candidate retrieval:** preserve high recall by retrieving a broader candidate set (for example, top 10–20) from dense and lexical retrieval, retaining each candidate's source/page provenance and component ranks.
2. **Evidence sufficiency gate:** evaluate multiple features together: source authorization, page provenance, query-to-passage relevance, lexical/symbol agreement for formula queries, top-candidate separation, independent dense/lexical agreement, and calibrated reranker relevance where available. A low-evidence decision should abstain, not erase a correct answer.
3. **Calibration:** collect independently labelled in-source relevant/irrelevant passages and out-of-corpus queries across several subjects and query styles. Calibrate the gate on held-out examples and select an operating point that meets a defined positive-answer recall floor while limiting unsupported answers. Report false abstention and unsupported-answer rates separately.
4. **Ablation:** compare no gate, feature-based gate and calibrated model-based gate on the same held-out set. Report recall, precision, false-abstention rate, unsupported-answer rate, per-query latency and cost. Keep authorization/provenance as hard constraints, never probabilistic features.

The first experiment should compare page-label evidence with human passage-level judgments, because the current expected-page targets are not passage qrels. Formula, case-sensitive symbol, numerical setup, paraphrase and negative-control strata should be reported separately. A single subject/single source benchmark is not enough for a production threshold.

### Optional reranking strategy to benchmark separately

The current AI Search baseline has built-in reranking, while the Qdrant hybrid path uses dense+sparse retrieval and RRF. That is not a controlled reranker comparison. If reranking is evaluated, apply the same cross-encoder/reranker model and candidate budget to both providers after initial retrieval (for example, rerank top 10–20 and retain top 5), while keeping source authorization and provenance outside the model.

Run a measured ablation: each provider without reranking, each with the same reranker, and (if justified) the same reranker plus relevance gate. Compare human-labelled nDCG@5, MRR@5, precision@5, grade-2+ recall, exact-symbol/math retrieval recall, negative abstention quality, p50/p95 latency, per-query inference cost and failure behavior. Reranking must never change the source/page provenance attached to a candidate. Adopt it only if the quality improvement justifies the added latency and cost and does not reduce critical symbol/math recall.

## 8. Release decision

M15 remains **IN PROGRESS**. The retrieval-only and 34-generation staging subtests are complete. Manual review supports the numerical answers P01–P12 for both providers and confirms 4/4 explicit abstentions for both providers; Qdrant additionally demonstrated 4/4 abstentions while irrelevant passages were present. H01 is a confirmed exact-symbol-preservation failure: the original PDF prints `F_s = −k × x`, while the indexed OCR and generated answers render `F_s = -k xx`. The source PDF is correct; the OCR/index-to-answer path loses the multiplication glyph boundary. Independent claim-level grounding is also not yet demonstrated.

Do not mark the retrieval migration production-ready, alter production provider selection, or authorize a provider cutover until the OCR-to-answer symbol-fidelity failure is remediated without mutating the original source artifact, claim-to-passage grounding is reviewed, the calibrated evaluator passes CI, and the other M15 security, authorization/revocation, recovery, performance, cost and load gates have passed.
