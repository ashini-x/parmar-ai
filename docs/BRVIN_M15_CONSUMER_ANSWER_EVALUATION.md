# BRVIN M15 — Consumer answer and abstention evaluation

**Date:** 11 November 2026  
**Status:** Evaluation harness implemented on branch; live Gemini execution and answer-quality acceptance are pending.  
**Production status:** Cloudflare AI Search remains selected. No provider cutover or production deployment is authorized by this work.

## 1. Why this is a separate gate

The second-source M15 retrieval-only benchmark and the consumer answer-generation benchmark answer different questions.

The retrieval-only test checks whether each provider returns source-scoped candidate passages and expected physical PDF pages. It does not test whether a model answers those passages correctly, cites the right page, preserves mathematical notation, or abstains when retrieved text is irrelevant.

The existing BRVIN v2 RPC is a retrieval contract. It returns retrieved passages and provenance; it does not call Gemini or own answer generation. The consumer-owned Gemini generator is implemented in \`src/ai/gemini.ts\`. Its existing Fatman book-mode call path is separate from BRVIN v2. This evaluation reuses the same \`generateGeminiAnswer\` function and Vertex AI request/response validation. It does **not** claim that BRVIN v2 already has a live Gemini consumer integration.

An additive, optional \`GroundedGeminiSourceContext\` parameter allows an isolated consumer to give the existing generator generic source excerpts. Existing callers that omit it keep their previous behavior. The M15 staging adapter is the only new caller in this evaluation. It does not replace the consumer-owned generator or modify the BRVIN v2 RPC contract.

## 2. Fixed test inputs

Use only the already-indexed, fingerprint-pinned M15 source:

| Field | Value |
|---|---|
| Source | \`BRVIN_M15_Physics_Benchmark_Source_v1.pdf\` |
| SHA-256 | \`cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92\` |
| Physical PDF pages | 8 |
| Immutable generation | \`2dc9d4fae3afe7df16927fbf2510afd3\` |
| Cloudflare AI Search | \`brvin-m15-physics-staging-v1\` |
| Qdrant collection | \`brvin_m15_physics_benchmark_v1\` |
| Embedding model | \`gemini-embedding-001\`, 768 dimensions |
| Embedding region | \`asia-south1\` |

The evaluation uses the original \`M15_BENCHMARK_QUERY_SUITE\` without changing query text or expected retrieval page labels:

- **P01–P12:** positive Physics concepts and calculations.
- **N01–N04:** four out-of-corpus controls (capacitor, Ohm's-law circuit, Lorentz force, and ideal gas law).
- **H01:** exact-symbol near-miss asking for \`F_s = +k × x\`.

H01 retains \`expectedNoMatch: true\` in the retrieval suite because the exact positive-sign expression is not in the source. That retrieval label does **not** mean the answer should abstain. The source's page 8 supports a correction: \`F_s = −kx\`; the answer must identify the positive-sign restoring-force expression as incorrect for this source. Only N01–N04 are abstention controls.

## 3. Evaluation flow

The new staging-only operator is served at:

\`https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/benchmark/answers\`

The page exposes two authenticated endpoints:

- \`GET /admin/m15/benchmark/answers/source\`: read the one source row matching the pinned SHA-256 from the isolated M15 staging D1 registry.
- \`POST /admin/m15/benchmark/answers/run\`: evaluate one fixed query ID against both staging providers.

For each query ID, the worker:

1. Confirms \`ENVIRONMENT=staging\`, the M15 staging flag, the exact source SHA-256, the eight-page source state, and both completed staging indexes.
2. Queries the dedicated M15 AI Search instance using the same source folder filter, hybrid retrieval, BGE reranker and top-five candidate limit as the paired retrieval runner.
3. Queries the dedicated M15 Qdrant collection with the same project ID, exact authorized source ID, top-five limit and prefetch size as the paired retrieval runner. It explicitly sets \`ensureCollection: false\`.
4. Checks candidate provenance. A candidate with an invalid source key or physical page is reported as a provenance violation and its text is not sent to Gemini.
5. Feeds the two providers' respective retrieved excerpts into two independent calls to the existing \`generateGeminiAnswer\` function. Both calls use the same query text, source-only system instructions, response schema, staging Gemini model and location.
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
- P12: restoring-force equation \`F_s = −kx\`, restoring force −10 N for the given stretch, and elastic potential energy 0.25 J.

P01 checks Newton's second-law relationship and the roles of net force, mass and acceleration.

### Negative cases N01–N04

A negative case passes only when:

- The provider query succeeded.
- At least one unrelated in-corpus candidate was actually retrieved, so the test demonstrates abstention in the presence of irrelevant evidence rather than an empty-retrieval fallback.
- The generated answer explicitly says the indexed source does not provide sufficient evidence.
- The answer does not provide the unsupported result tested for that negative.
- No unrelated source-page citation is attached.

A failed provider query, a zero-candidate query, or a Gemini generation error is not a successful negative-control pass. It is an incomplete or failed test.

### Exact-symbol near-miss H01

H01 is graded as a source-supported correction. It passes only when the answer identifies \`F_s = −kx\`, rejects \`F_s = +kx\` as the restoring-force equation given by the source, preserves the sign, retrieves page 8 with valid provenance, and cites physical PDF page 8. It must not be scored as an abstention.

### Rubric limitation

The initial implementation is a transparent, deterministic first-pass rubric built around the fixed test suite. It is not an independent semantic judge and does not prove that every sentence in a generated answer is grounded. For any ambiguous or failed case, inspect the complete evidence and answer in the downloaded receipt. Human review of claim-to-passage support remains required before any migration acceptance decision.

## 5. Isolation and side-effect controls

The answer endpoints are available only when the Worker identifies itself as staging and the M15 staging flag is enabled. They authenticate with the staging operator bearer token.

For these two answer endpoints, the worker deliberately bypasses the existing staging schema-setup helper and uses D1 only for read-only \`SELECT\` operations. Evaluation results are held in page memory and downloaded by the operator. The evaluator does not persist results into D1.

It does not:

- Change \`BRVIN_RETRIEVAL_PROVIDER\` or any production provider selection.
- Modify the production worker, BRVIN v2 RPC, or consumer routing.
- Deploy production.
- Upload, re-OCR, replace, delete or mutate the M15 PDF, OCR output, manifests, AI Search items or Qdrant points.
- Run Qdrant collection creation or mutation; \`ensureCollection: false\` is mandatory.
- Change production D1, the production AI Search instance, Teachers, or any production binding.

The staging build workflow validates the branch with typecheck/tests and Wrangler dry-run. A manual \`workflow_dispatch\` from this feature branch deploys the M14/M15 staging Worker only. Do not merge this branch as part of the test run: the production release classifier treats \`src/ai/gemini.ts\` as a production runtime path, so merging it would enter the normal production release workflow.

## 6. Execution status on 11 November 2026

### Completed retrieval-only checkpoint (reported by the operator)

The user reported the completed \`brvin-m15-second-source-paired-shadow\` retrieval-only receipt with:

- 17 queries executed against both providers.
- 12/12 positive expected-page targets covered by both providers.
- Qdrant retrieval latency materially lower in this particular staging run.
- Qdrant returned candidates for all four out-of-corpus questions.
- H01 retrieved the corrective source page.
- Zero provenance violations.
- No indexing or production side effects.

These are recorded as the supplied retrieval checkpoint. They are not answer-generation results and do not imply answer correctness, source grounding, citations or abstention have passed.

### Consumer answer/abstention evaluator

**Implemented on branch:** \`feat/m15-consumer-answer-evaluation-2026-11-11\`.

The code adds the optional generic source context to \`generateGeminiAnswer\`, the paired M15 retrieval/generation adapter, the authenticated read-only staging routes, a browser report page, and initial grading regression tests. The staging workflow is configured to validate the changed Gemini source and permits manual staging-only deployment from the selected feature branch.

**Not yet executed:** this work session did not deploy the feature branch to the staging Worker or invoke Gemini. The 34 answer-generation calls (17 queries × 2 providers), generated answer payloads, generation latencies and answer pass/fail counts therefore remain pending. No result has been fabricated or inferred from the retrieval receipt.

To run it:
1. Open the GitHub Actions workflow \`M14 staging operator\` in the \`ashini-x/parmar-ai\` repository.
2. Select branch \`feat/m15-consumer-answer-evaluation-2026-11-11\` and use **Run workflow**. This workflow's dispatch deploys only \`parmar-ai-m14-staging\`; it does not deploy either production Worker.
3. Wait for the validation and staging deployment jobs to complete successfully. In particular, \`npm run check\`, the M15 tests and the Wrangler staging dry-run must pass.
4. Open \`https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/benchmark/answers\`.
5. Enter the staging operator token in the page, load the registered source read-only, then run all 17 paired queries.
6. Download and review both the JSON receipt and Markdown report. Keep the raw JSON with the milestone evidence.

Do not paste the staging operator token into chat, GitHub issues, source files or the generated report. It is used in the browser only.

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

M15 remains **IN PROGRESS**. The retrieval-only 17-query checkpoint is a completed subtest, not migration acceptance. Consumer answer correctness, claim-level source grounding, citation correctness, mathematical-symbol fidelity and N01–N04 abstention have not yet been demonstrated.

Do not mark the retrieval migration production-ready, alter production provider selection, or authorize a provider cutover until the live answer/abstention receipt has been executed, every failure case has been reviewed, relevant outputs have been human-checked, and the other M15 security, authorization/revocation, recovery, performance, cost and load gates have passed.
