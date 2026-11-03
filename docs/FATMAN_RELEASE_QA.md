# Fatman real-user release QA

Fatman book mode has two distinct readiness layers:

1. **Index readiness** — all 538 source pages are present as completed AI Search text items.
2. **Answer readiness** — a six-case end-to-end regression suite proves that retrieval, answer generation, citations and abstention work for representative questions.

Book mode must not be considered release-ready on index completion alone.

## QA roles

The roles are separate, deterministic Workflow steps with bounded responsibilities. They share the same durable Cloudflare Workflow and D1 audit history; they are not unconstrained agents that can mutate production arbitrarily.

- **Release coordinator** runs the versioned suite and records its run ID, document version, cost estimate and results.
- **Retrieval specialist** tries the primary page-grounded query and a small, fixed set of repair queries. It uses the same hybrid AI Search instance as a student, but does not consume student monthly search quota.
- **Answer QA specialist** sends retrieved evidence through the production Gemini book-answer path. It checks required facts and verified page citations.
- **Repair specialist** may make one stricter answer-generation attempt when a required fact or citation is missing. Retrieval repair is limited to the declared alternate queries.
- **Release supervisor** enables book mode only when every case passes. Any failed or interrupted regression fails closed by disabling book mode while preserving the completed 538-page import record.

## Golden test cases

| Case | Type | Required evidence |
|---|---|---|
| exact-plassey-fact | Exact fact | Robert Clive and Siraj-ud-Daulah; PDF p. 168 |
| concept-president-parliament | Concept | President is part of Parliament; a Bill requires the President's assent; PDF p. 227 |
| comparison-fundamental-rights-dpsp | Comparison | Justiciable Part III material and non-justiciable Part IV material from PDF pp. 213 and 218 |
| page-reference-plassey | Page reference | Correct source citation to PDF p. 168 |
| out-of-book-secret-fingerprint | Out-of-book | No relevant book evidence; answer explicitly abstains and invents no fingerprint |
| difficult-bengal-control | Difficult / multi-step | Plassey 1757, Buxar 1764, Allahabad 1765 and Diwani rights; PDF p. 168 |

The tests are versioned in `src/fatman/release-qa.ts`. They validate known source facts and citations, not every possible user question. They are a release smoke/regression layer, not a substitute for human review or broader evaluation with a larger test corpus.

## Guardrails

- QA retrieval bypasses only the *student monthly usage counter*. It still uses the configured AI Search namespace, hybrid retrieval, page-key validation, score threshold and lexical relevance filter.
- A passage must overlap the query on meaningful content terms. Vector similarity by itself is not sufficient evidence for an out-of-book question.
- Answer facts are checked against a small set of expected fact groups. Page references are generated from retrieved item keys, never from model-generated page numbers.
- The out-of-book test must have no relevant passages and must receive an explicit abstention. A long hex-looking fingerprint is treated as a failure.
- Only one answer repair attempt is allowed per test case. The suite never supplies expected answers to Gemini.
- Results are stored in D1 table `fatman_release_qa_runs` and are visible in the protected Fatman monitor.

## Automation

- The initial indexing workflow runs this suite after the 538-page completeness check and the existing three-page retrieval smoke test.
- The existing daily Worker Cron also schedules a regression run for the latest complete 538-page import. It does not re-upload the PDF or repeat OCR.
- Administrators can trigger a run with the protected `POST /admin/api/fatman/qa` endpoint. Latest results are available from `GET /admin/api/fatman/qa` and the monitor's QA panel.
- If a suite fails, Fatman mode is disabled immediately; the indexed book remains stored, and the next scheduled/manual run can re-approve it after the issue is resolved.
