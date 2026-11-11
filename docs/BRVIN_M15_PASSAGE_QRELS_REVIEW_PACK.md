# BRVIN M15 passage relevance review pack

**State:** prepared for independent annotation; no grades have been assigned.  
**Prepared:** 11 November 2026  
**Core issue:** [#144 — M15 shadow benchmark relevance, math fidelity, security, load and cost](https://github.com/ashini-x/parmar-ai/issues/144)

## Purpose

The next open M15 quality gate is passage-level relevance. The second-source 17-query receipt establishes page coverage and provider behavior, but physical-page labels are not passage qrels. AI Search and Qdrant use different passage boundaries, so each returned passage must be judged independently or mapped to a normalized source span.

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

## Receipt context

- Both providers completed all 17 retrieval queries and covered 12/12 positive expected physical-page targets.
- AI Search returned no candidates for N01–N04. Qdrant returned 20 candidates across those four out-of-corpus queries; judge their actual text rather than treating candidate presence alone as relevance.
- Both providers returned candidates for H01 and reported zero page-provenance violations.
- Sequential staging retrieval p50/p95 was 2,524/10,477 ms for AI Search and 784/1,097 ms for Qdrant. These 17-sample observations are not representative load/SLO measurements.
- The separate answer run completed 17 query pairs / 34 Gemini generations. Calibrated offline first-pass grade is 16/17 for each provider; H01 symbol fidelity and independent claim-to-passage grounding remain open.

## Status boundary

This artifact prepares the first incomplete M15 task for independent review. It does **not** close human qrels, prove claim-level entailment, pass formula fidelity, demonstrate authorization isolation, or authorize production cutover. Production remains on Cloudflare AI Search.
