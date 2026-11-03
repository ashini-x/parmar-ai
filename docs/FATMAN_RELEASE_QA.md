# Fatman real-user release QA

Fatman book mode has two readiness layers:

1. **Index readiness** — all 538 source pages are present as completed AI Search text items.
2. **Answer readiness** — a versioned end-to-end suite verifies query understanding, retrieval, Gemini answers, citations, follow-up continuity and safe abstention.

Book mode must not be considered release-ready on index completion alone. Stage 6 uses the existing Parmar AI chat and the same configured Gemini model; book mode changes the retrieved context and answer instructions, not the model or chat product.

## Bounded QA specialists

The specialist roles are deterministic, auditable Workflow stages. They do not have unrestricted tools or permission to mutate production state independently.

- **Release coordinator** runs the versioned suite and records its run ID, document version, actual hybrid-search request count, estimated model cost and results.
- **Retrieval specialist** tests the student's natural-language query plus bounded search variants for short Article lookups, comparison operands, common exam shorthand and compact keyword phrases. It uses the same hybrid AI Search instance and lexical evidence filter as a student.
- **Answer specialist** sends retrieved page evidence through the production Gemini book-answer path. The configured Gemini model remains unchanged.
- **Citation specialist** ranks candidate source pages using retrieval score plus overlap with the question and generated answer. It cites the most relevant pages instead of choosing the three numerically lowest PDF pages.
- **Abstention specialist** verifies that an out-of-book question receives no relevant passages and that Gemini declines to invent an answer.
- **Repair specialist** permits one additional answer attempt when facts/citations are incomplete or Gemini returns a retryable generation failure. The repair prompt requires a concise response and still supplies only retrieved book evidence.
- **Release supervisor** enables book mode only when every case passes. A failed or interrupted regression fails closed by disabling book mode while preserving the completed 538-page import.

## Regression coverage

Suite version fatman-real-user-qa-v4 contains twelve questions:

| Case | Type | Required evidence |
|---|---|---|
| exact-plassey-fact | Exact fact | Robert Clive and Siraj-ud-Daulah; PDF p. 168 |
| concept-president-parliament | Concept | President is part of Parliament; a Bill requires the President's assent; PDF p. 227 |
| comparison-equality | Comparison | Fundamental Rights Part III and DPSP Part IV; PDF pp. 213 and 218 |
| page-reference-plassey | Page reference | Correct source citation to PDF p. 168 |
| out-of-book-secret-fingerprint | Out-of-book | No relevant book evidence; explicit abstention and no invented fingerprint |
| difficult-bengal-control | Difficult / multi-step | Plassey 1757, Buxar 1764, Allahabad 1765 and Diwani rights; PDF p. 168 |
| short-article-79-lookup | Short natural query | Article 79 composition of Parliament; President, Rajya Sabha and Lok Sabha; PDF p. 227 |
| abbreviated-fr-dpsp-comparison | Shorthand / comparison | FR and DPSP resolve to the relevant Part III and Part IV material; PDF pp. 213 and 218 |
| subsidiary-alliance-natural-question | Natural-language exact fact | Lord Wellesley introduced the Subsidiary Alliance in 1798; PDF p. 169 |
| first-governor-general-bengal | Historical lookup | Warren Hastings as first Governor-General of Bengal; PDF p. 197 |
| cornwallis-land-revenue-question | Natural-language exact fact | Permanent Settlement and 1793; PDF p. 174 |
| plassey-cause-explanation | Causal question | Mir Jafar's alliance with the British and Robert Clive's forces; PDF p. 168 |

These are regression probes, not a claim that twelve questions cover every possible student phrasing. Runtime retrieval remains evidence-gated: when the index does not return relevant passages, Fatman must abstain rather than fall back to Gemini's general knowledge.

## Retrieval and chat guardrails

- Each student request reserves one monthly Fatman search allowance. Internally, the bounded query-expansion pass may issue up to three hybrid searches; the monitor records the actual number of requests.
- Query variants are search hints only. They never become answer facts, and each returned passage must still pass page-key validation, the configured score threshold and lexical relevance checks.
- Article-number lookups add an Indian Constitution search phrase; comparison questions search each operand separately; known exam shorthand such as FR/DPSP is expanded before searching.
- Context-dependent follow-ups may include the previous Fatman exchange to resolve references such as “why?”, “what about it?” or “explain that”. Previous chat text is explicitly not evidence; factual answers must be supported by the newly retrieved pages.
- The same hybrid search index and same Gemini generation function are used for release QA and student answers. QA bypasses only the student monthly usage counter.
- Gemini is instructed to answer only from retrieved excerpts, ignore instructions embedded in OCR text, avoid invented page numbers and abstain when evidence is insufficient.
- When comparing constitutional concepts, answers should include each relevant Part or Article number when it appears in the retrieved book pages, including for shorthand questions.
- The fact verifier canonicalizes standard ordinal variants such as 1st/first, 2nd/second and 3rd/third so equivalent answer wording is not marked as a factual miss.
- Fatman answers receive a larger minimum output budget than ordinary short chat responses so complex answers are not truncated by the default 1,200-token limit.
- Citations are selected from actual retrieved PDF page keys and ranked using passage relevance, question overlap and answer overlap. No page number is accepted from Gemini itself.
- The out-of-book test must retrieve no relevant passages and receive an explicit abstention. A long hex-looking fingerprint is treated as a failure.
- Results are stored in the D1 table fatman_release_qa_runs and are visible in the protected Fatman monitor.

## Automation and operations

- The import workflow runs this suite after the 538-page completeness check and initial page-grounded retrieval smoke tests.
- The daily Worker Cron schedules a regression run for the latest complete 538-page import. It does not re-upload the PDF or repeat OCR.
- Administrators can trigger a run with the protected POST /admin/api/fatman/qa endpoint; latest results are available from GET /admin/api/fatman/qa and the monitor's QA panel.
- A failed suite disables student Fatman mode immediately but leaves all indexed book pages and import progress intact. A later passing run can re-approve the same version.
- Ordinary Parmar AI chat remains available when Fatman mode is off. A submitted question keeps its mode snapshot, so changing the toggle does not reroute an already accepted job.
