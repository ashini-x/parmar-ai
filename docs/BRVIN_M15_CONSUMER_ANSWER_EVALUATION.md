# BRVIN M15 — Consumer answer and abstention evaluation

**Date:** 11 November 2026  
**Status (12 November 2026):** 17/17 paired OCR-only query cases (34 Gemini generations) and the separate original-PDF-assisted five-query audit (10 Gemini generations) are complete. The original OCR-only receipt calibrates to 16/17 for each provider; the targeted PDF-assisted audit passes 5/5 for each provider on answer correctness, source-grounding, citations and mathematical-symbol fidelity. This demonstrates bounded notation recovery when the exact original page is attached; it does not repair stored OCR/index text. Independent claim-level grounding and the remaining M15 acceptance gates are still open.  
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

The M14 staging workflow validates typecheck/tests, pinned Vertex/Qdrant configuration and Wrangler dry-run. After Core PR #223 merged, the normal push-to-main M14 workflow deployed the isolated M14/M15 staging Worker only. The Core Release workflow's production-scope classifier explicitly treated this exact change set as staging/docs-only (`deploy=false`); the paired production deployment and verification jobs were skipped. The additive PDF-source branch in `src/ai/gemini.ts` is invoked only by the M15 staging audit when `sourceDocument` is explicitly supplied; all existing production callers omit it.

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

**Implemented and merged:** Core PR [#223](https://github.com/ashini-x/parmar-ai/pull/223), merge commit `3c4e7b815bb4f5c21318b083712b2d138b882475`.

The code adds the optional generic source context to `generateGeminiAnswer`, the paired M15 retrieval/generation adapter, the authenticated read-only staging routes, a browser report page, and initial grading regression tests. The staging workflow is configured to validate the changed Gemini source and permits manual staging-only deployment from the selected feature branch.

**Code validation and staging deployment passed on 11 November 2026:** final PR-head M14 validation [#43076308815](https://github.com/ashini-x/parmar-ai/actions/runs/43076308815) passed typecheck, the focused M14/M15 tests, pinned Vertex/Qdrant config verification and Wrangler dry-run. Final PR-head Release validation [#43076309218](https://github.com/ashini-x/parmar-ai/actions/runs/43076309218) passed TypeScript, full Vitest, Node tests and both Worker bundle validations. After merge, push-triggered M14 workflow [#43076503307](https://github.com/ashini-x/parmar-ai/actions/runs/43076503307) passed validation and deployed only the isolated staging Worker. Cloudflare deployment read-back confirms Worker `parmar-ai-m14-staging` deployment `9eaac13a-38a9-4823-9d16-c31ff97c9eab`, version `ed239c04-3d71-4194-88c0-d08c8948929c`, created 2026-11-11 18:19:13 UTC, at 100%. Paired Release validation [#43076503215](https://github.com/ashini-x/parmar-ai/actions/runs/43076503215) passed full validation; its production-scope classifier reported staging/docs-only and the production deployment/verification jobs were skipped.

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

### Supplemental manual formula-symbol audit — 11 November 2026

A second inspection of the saved answer strings against the original eight-page PDF found additional notation defects that the original deterministic math flag did not reliably detect:

- **P01 / AI Search:** the answer includes the malformed fragment `ΣF = m xa`, although it later gives the correct `F_net = m × a` relationship. The valid later equation does not make the earlier fragment good instructional output.
- **P08 / Qdrant:** the answer prints `O ≤ f_s ≤ μ_s × N` with a capital letter O where the source has the digit zero: `0 ≤ f_s ≤ μ_s × N`. AI Search rendered the zero correctly in this run.
- **P12 / AI Search:** the answer gives the correct numerical results (−10 N and 0.25 J), but its displayed equations include `F_s = -k xx` and `U_s = ½ x k x x²`. Qdrant rendered both equations in the correct form: `F_s = -k × x` and `U_s = ½ × k × x²`.
- **H01 / both providers:** both answers reproduce `F_s = -k xx` rather than the source's `F_s = −k × x`.

Both providers returned the expected physical page for all 12 positive cases, with zero provenance violations. Manual review of the requested conceptual/numerical conclusions found them supported by the expected source pages. This is a useful manual review, but it is not yet a separately recorded claim-by-claim entailment annotation and does not close the independent grounding gate.

The original `mathematicalSymbolFidelity` field should not be interpreted as a complete typographic audit: some malformed formula fragments passed its broad checks. The 16/17 calibrated offline result is a deterministic first-pass re-grade of the saved answers, not a proof of exact math notation or a second Gemini execution. A stricter evaluator and regression cases are required before another answer-quality acceptance decision.

**Provider comparison:** Qdrant retrieval latency averaged 788.29 ms (median 792 ms) versus 1,993.65 ms (median 1,652 ms) for AI Search in this single 17-query run. That is a substantial retrieval-speed signal. Gemini generation medians were effectively equal (5,560 ms Qdrant; 5,580 ms AI Search). Both providers had the same calibrated 16/17 first-pass result; Qdrant demonstrated 4/4 abstentions with irrelevant passages, while AI Search demonstrated 4/4 no-evidence abstentions because it returned no candidates for those controls. Qdrant is the stronger migration candidate from this run, but the run does not yet demonstrate a general production answer-accuracy or reliability win.

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

M15 remains **IN PROGRESS**. The retrieval-only, 34-generation OCR-only answer, and separate ten-generation original-PDF-assisted formula subtests are complete. Manual review supports the original P01–P12 numerical/conceptual answers for both providers and confirms 4/4 N01–N04 abstentions for each; Qdrant additionally demonstrated 4/4 resistance to irrelevant in-corpus passages. The OCR-only receipt still contains real notation defects (P01 / AI Search, P08 / Qdrant, P12 / AI Search, and H01 / both providers). The targeted PDF-assisted audit then passed all five cases for both providers, including exact notation on P01, P08, P11 and P12 and correct rejection of H01's positive-sign near-miss. This proves the current Gemini generator can recover the audited notation when the exact original page is supplied; it does **not** repair the stored OCR or index representations, nor establish that normal OCR-only answers are now faithful. Independent claim-level grounding remains unproven.

Do not mark the retrieval migration production-ready, alter production provider selection, or authorize a provider cutover until the production-appropriate symbol-fidelity strategy is selected and validated beyond this five-query PDF-assisted sample, claim-to-passage grounding is reviewed, the calibrated evaluator passes CI, and the other M15 security, authorization/revocation, recovery, repeatability, performance, cost and load gates have passed.


## 9. Targeted original-PDF formula-symbol audit — 11 November 2026

**Implementation and execution status:** the audit was added to the same authenticated isolated-staging operator and was completed on 11 November 2026. It generated a separate five-query / ten-generation receipt; the completed 34-generation OCR-only receipt above remains unchanged. The new experiment did not rerun the full P01–P12 / N01–N04 / H01 suite.

The root cause is that the page OCR text already changes some mathematical glyphs before the existing Gemini generator receives the excerpts. Prompt-only instructions cannot restore a multiplication sign that is absent from the evidence. This targeted experiment tests whether the source-of-record visual representation can preserve the notation without changing OCR or any index.

### Fixed query subset and page isolation

The separate **Run five-query formula-fidelity audit · original PDF** action adds five query pairs / ten Gemini generations:

| Query | Original physical PDF page attached |
|---|---:|
| P01 — Newton's second-law notation | 1 |
| P08 — static-friction lower bound and zero glyph | 4 |
| P11 — signed momentum and impulse notation | 7 |
| P12 — spring force and elastic energy | 8 |
| H01 — minus sign and multiplication operator | 8 |

The route is `POST /admin/m15/benchmark/answers/formula-audit/run`. It accepts only those five fixed query IDs. It does not replace the existing OCR-only `/answers/run` route.

Before any Gemini call, Core verifies the registered staging source ID, expected PDF filename, exact immutable source object path, source SHA-256, GCS object size, and immutable GCS object generation. It reads the exact original object generation and checks the complete byte-level SHA-256 against `cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92`.

Core then uses `pdf-lib` to copy **only the one permitted original physical PDF page** into a transient one-page PDF. The helper verifies that the original has exactly eight physical pages, that the requested page is valid, and that the extracted attachment has exactly one page. The report records both the original source SHA-256 and the extracted one-page PDF SHA-256. The other seven pages are not sent to Gemini. This is a transient in-memory derivative; it is not written to GCS, D1, or either index.

The source-only Gemini prompt treats the attached page as untrusted source data and uses it only to inspect literal mathematical notation on that single original page. Retrieved excerpts remain the evidence for conceptual/numerical claims; the visual page must not introduce unsupported facts. When the printed glyph is not clearly legible, the answer must state uncertainty rather than reconstructing the expected equation.

### No-mutation boundary

The experiment is read-only with respect to the registered source and retrieval system. It does not change the original PDF, stored Vision OCR JSON, raw OCR strings, normalized text, formula-candidate metadata, immutable GCS manifests, Qdrant points, AI Search items, D1 records, provider settings, production Workers, the BRVIN v2 request/response contract, or BRVIN Teachers. The PDF bytes are fetched using the recorded immutable GCS generation; the extracted one-page attachment exists only in Worker memory for the paired generation calls.

The original OCR-only answers and the new PDF-assisted answers are separate receipts. Do not overwrite the earlier receipt or present the new result as a rerun of the original conditions. Compare answers against the visually inspected original physical page and report, per query/provider, whether exact variable boundaries, multiplication glyphs, zero, signs, subscripts and superscripts are preserved. A successful PDF-assisted answer is evidence for a bounded visual-grounding path, not proof that the OCR/indexing pipeline itself has been repaired.

### Validation and acceptance status

Regression tests cover:
- the fixed query-to-physical-page allowlist;
- rejection of queries outside the formula audit subset;
- complete original-source SHA-256 verification;
- extraction of exactly one page from an eight-page PDF;
- rejection of an invalid source hash, page selector, non-PDF input, or wrong original page count;
- presence of the separate staging-only operator action.

Core PR #223 is merged as `3c4e7b815bb4f5c21318b083712b2d138b882475`. The final M14 staging validation and full Core Release validation both passed; after merge, the push-to-main workflow deployed staging Worker version `ed239c04-3d71-4194-88c0-d08c8948929c` (deployment `9eaac13a-38a9-4823-9d16-c31ff97c9eab`) at 100%. The Release workflow explicitly classified the change set as staging/docs-only, so production deployment and verification jobs were skipped. The deployed operator is `https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/benchmark/answers`; the five-query action required the existing staging `BRVIN_M14_ADMIN_TOKEN`, which was entered locally and was not shared in chat or stored in the report.

**Execution receipt — 11 November 2026, 18:39:12 UTC:** all five query pairs completed (`P01`, `P08`, `P11`, `P12`, `H01`) against source `3b4d116d-4c18-450f-9cba-cb2bec3da7ca`, using `gemini-3.8-flash` / `global`. The report's original source SHA-256 exactly matches the pinned eight-page PDF (`cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92`). Each request attached exactly one extracted original physical page (1, 4, 7, 8, 8 respectively); the JSON records the SHA-256 of each transient one-page PDF. No request failure occurred.

| Metric | Cloudflare AI Search | Qdrant + Vertex |
|---|---:|---:|
| Overall / answer correctness | 5/5 | 5/5 |
| Source-grounding check | 5/5 | 5/5 |
| Citation check | 5/5 | 5/5 |
| Mathematical-symbol fidelity | 5/5 | 5/5 |
| Provenance violations | 0 | 0 |
| Mean retrieval latency | 3,848 ms | 913.2 ms |
| Median retrieval latency | 3,599 ms | 895 ms |
| Mean Gemini generation latency | 8,435.6 ms | 14,278 ms |
| Median Gemini generation latency | 7,442 ms | 5,749 ms |

Both providers returned the expected support page at rank 1 for every case and cited the correct physical page. The generated answers preserve the audited equation boundaries, multiplication signs, zero/inequality, signs and numerical results. Qdrant was faster on retrieval in all five samples (mean 913.2 ms versus 3,848 ms). Its generation median was lower, but its mean was higher because P11 took 50,041 ms; this five-query staging sample does not establish an end-to-end latency winner or an SLO.

**H01 interpretation:** H01 asks for `F_s = +k × x`. Both providers retrieve page 8 and correctly explain that the source equation is `F_s = −k × x` and that the positive-sign expression is explicitly rejected. Although the receipt retains `retrievalExpectedNoMatch: true` for the exact positive-sign formula, this is not a no-evidence abstention case: page 8 contains the positive-sign expression as a negated near-miss and is useful corrective evidence. Abstention and irrelevant-evidence counters are therefore not applicable in this five-query audit (0 applicable queries).

This is a **successful bounded PDF-assisted notation audit**, not an OCR/index repair. The original PDF, Vision OCR, normalized text, manifests, D1 records and both indexes were not modified. The original OCR-only formula defects documented above remain defects in that path until separately remediated or replaced by a production-appropriate visual-evidence strategy. Independent claim-by-claim entailment, passage qrels, authorization/revocation, recovery, repeatable latency/cost, load and rollback remain open. Production remains on Cloudflare AI Search; no provider cutover or Teachers-side provider access is authorized.


## 12 November 2026 — independent passage-review handoff

The paired OCR-only answer evaluation and the bounded original-PDF-assisted notation audit are complete, but neither creates independent passage qrels. The source-fingerprinted [M15 passage-review pack](BRVIN_M15_PASSAGE_QRELS_REVIEW_PACK.md) contains 109 exact provider evidence excerpts from the same pinned eight-page Physics source; its machine-readable copy is [brvin-m15-passage-qrels-review-pack.json](../test/fixtures/brvin-m15-passage-qrels-review-pack.json).

Two reviewers must grade separate copies independently using the 0–3 relevance rubric and add a short source-grounded rationale; disagreements must be preserved and adjudicated separately. The fixture's Reviewer A, Reviewer B and adjudicated fields are blank. No model/assistant-produced labels may be reported as human qrels. Evaluate provider passages independently because AI Search auto-chunk boundaries and Qdrant custom chunk boundaries differ.

This review is the first incomplete M15 quality gate. The PDF-assisted audit passing 5/5 is evidence for a bounded visual-evidence path only; it does not fix the stored OCR/index notation defects. Production remains on Cloudflare AI Search and no cutover is authorized.

