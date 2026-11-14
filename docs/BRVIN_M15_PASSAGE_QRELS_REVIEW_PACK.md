# BRVIN M15 passage relevance review pack

**State:** archived optional artifact; not a current M15 prerequisite. Human-review dependency explicitly waived by the project owner on 14 November 2026. The pack remains unchanged for historical/audit use; no grades are required to proceed with the Fatman AI comparison.  
**Prepared:** 11 November 2026  
**Core issue:** [#144 — M15 shadow benchmark relevance, math fidelity, security, load and cost](https://github.com/ashini-x/parmar-ai/issues/144)

## Purpose

This pack documents the historical 109-candidate Physics review exercise. It was prepared for two independent human reviewers, but the project owner explicitly waived that dependency on 14 November 2026. The active M15 comparative path is now the full 538-page Fatman benchmark with two independent AI assessors and a separate AI adjudicator on material disagreements; see [BRVIN_M15_FATMAN_538_TWO_AGENT_EVALUATION.md](BRVIN_M15_FATMAN_538_TWO_AGENT_EVALUATION.md).

This file and its blank fixture are retained unchanged for auditability. They are optional research material, not a blocker, not a task for the user, and not a production gate. The distinction remains important: page-target labels are not passage qrels, and AI assessments are not independent human qrels.

The machine-readable review pack is [`test/fixtures/brvin-m15-passage-qrels-review-pack.json`](../test/fixtures/brvin-m15-passage-qrels-review-pack.json). It contains **109 exact bounded evidence excerpts** from the completed paired answer-evaluation run, grouped by query and provider. These are the source-provenanced texts passed to the isolated Core staging answer evaluator; the pack does not rewrite, normalize or repair them.

## Source identity

| Field | Value |
|---|---|
| Source | `Physics Benchmark — M15 v1` |
| File | `BRVIN_M15_Physics_Benchmark_Source_v1.pdf` |
| Source ID | `3b4d116d-4c18-450f-9cba-cb2bec3da7ca` |
| Project ID | `890f6317-69f4-4391-aae6-556155ed0d12` |
| SHA-256 | `cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92` |
| Physical PDF pages | 8 |
| Immutable GCS generation | `2dc9d4fae3afe7df16927fbf2510afd3` |

Review against this exact original PDF. Page 8 confirms that the original restoring-force equation is `F_s = −k × x`; the OCR-derived `-k xx` form is not equivalent.

## Annotation rubric

| Grade | Meaning |
|---:|---|
| 3 | Directly answers the query using source-supported evidence |
| 2 | Useful supporting evidence, but not complete alone |
| 1 | Related context only |
| 0 | Irrelevant or contradicts the requested expression/fact |

Do not grade from physical page number, retrieval rank or score. RRF values are ranking signals, not confidence probabilities. Evaluate the AI Search and Qdrant passage schemes independently; do not assume chunk IDs or chunk boundaries correspond.

For H01, inspect the minus/plus sign and multiplication glyph literally. Keep retrieval relevance separate from whether the answer generator correctly explains that the requested positive-sign expression is not in the source.

## Independent-review protocol

1. Make two separate copies of the JSON review pack. Reviewer A and Reviewer B must grade independently and must not view the other reviewer's values before submitting.
2. For every candidate, assign an integer grade from 0 to 3 and add a short rationale. Optionally enter a normalized source-span reference when a passage maps to an identifiable source span.
3. Compare the completed copies. Record disagreements and an adjudicated grade; do not silently overwrite either original review.
4. Calculate per-query and macro metrics separately for AI Search and Qdrant. Include query-class slices for theory, numerical/worked examples, formula/symbol, mixed content, out-of-corpus negatives and H01.
5. Retain the source fingerprint and raw receipt alongside the completed labels.

The JSON pack has `reviewerA`, `reviewerB` and `adjudicatedGrade` fields intentionally left blank. It contains **no model-generated relevance labels** and is not an independent human qrels result.

## Validation and scoring

After independent annotation and adjudication, validate the completed file with:

```sh
node scripts/validate-brvin-m15-passage-qrels.mjs test/fixtures/brvin-m15-passage-qrels-review-pack.json
```

The validator checks the pack's SHA-256 field and requires both distinct pseudonymous reviewers to attest that they reviewed that same source fingerprint and submitted blindly. It also validates grades, rationales and disagreement adjudication. It does not re-read the PDF or independently verify who completed the annotations. It emits counts and metrics only; it does not emit query or passage text. The current unannotated pack is structurally valid but incomplete, so it produces no relevance scores.

For a complete pack, the script reports macro nDCG@5, MRR@5 and precision@5 (grade 2+) over each provider's returned judged candidates. These provider-local metrics do not estimate full-corpus recall, compare answer correctness, select a provider, choose a gate, or authorize production. Reviewer attestations are self-reported and still require genuine independent human reviewers.

## Receipt context

- Both providers completed all 17 retrieval queries and covered 12/12 positive expected physical-page targets.
- AI Search returned no candidates for N01–N04. Qdrant returned 20 candidates across those four out-of-corpus queries; judge their actual text rather than treating candidate presence alone as relevance.
- Both providers returned candidates for H01 and reported zero page-provenance violations.
- Sequential staging retrieval p50/p95 was 2,524/10,477 ms for AI Search and 784/1,097 ms for Qdrant. These 17-sample observations are not representative load/SLO measurements.
- The separate answer run completed 17 query pairs / 34 Gemini generations. Calibrated offline first-pass grade is 16/17 for each provider; H01 symbol fidelity and independent claim-to-passage grounding remain open.

## Status boundary

This is an archived optional artifact. The project owner has waived human review as a prerequisite for the current M15 provider comparison. The two-agent Fatman assessment is owner-authorized AI evaluation, not independent human qrels. Neither this pack nor the AI assessment alone proves production capacity; the separate production migration must preserve D1 authorization, monitoring and the immediate Cloudflare AI Search rollback path. Production remains on Cloudflare AI Search until the paired Fatman result is reviewed.
