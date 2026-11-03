# AI Pipeline

## Input contract

The Worker accepts private Telegram text or photo messages; video uploads and mixed photo/video albums are rejected. Albums over five photos are rejected and the bot explains the limit in chat. Captions are bounded by `MAX_QUESTION_LENGTH`. A single photo is processed directly; photo-only Telegram album updates are staged for a 2.5-second quiet period and combined into one doubt (maximum 5 photos).

The text question and optional caption are passed to the Queue as a versioned `QuestionJob` containing:

- optional requested quiz count (1–10)

- `updateId`
- `chatId`
- `question`
- `messageId`
- `requestId`
- `createdAt`
- optional Telegram status message ID
- optional canonical Telegram user ID for analytics continuity

Photo file IDs are stored in the per-chat Durable Object job record for retries and are not included in Queue messages. At processing time, the consumer retrieves the photos from Telegram, validates JPEG/PNG/WebP type and size, then sends them to Gemini as inline image parts in message order. Downloads are capped at 7 MB per image and 12 MB total. The application does not persist the image bytes.

## Context assembly

Before Gemini execution, the consumer builds a `ProfileContext` containing:

- target exam,
- recent topics,
- recent subjects,
- attention topics,
- revision queue,
- up to twelve recent completed in-scope conversation turns.

The context is deliberately bounded to avoid unbounded prompt growth.

## Question interpretation

The answer pipeline uses the recent context to resolve short follow-ups such as:

- `iska`
- `isko`
- `isme`
- `ye`
- `same`
- `phir se`
- `simple mein`

Explicit confusion and weakness wording is treated differently from ordinary factual questions so the personalization system does not manufacture false signals.

## Response mode

The model decides the presentation mode semantically. Ordinary open-ended doubts remain text responses. A genuine student-supplied MCQ, an explicit request to be tested, a request to generate an MCQ, or a clearly ongoing MCQ task produces responseMode=quiz and a Telegram-ready question, options, correct option ID and compact explanation.

An MCQ must have a topic anchor: the current request, a recent stored SSC topic, or the immediately preceding Parmar exchange when the bot asked the student to choose an MCQ topic. A fresh generic request such as “mcq” or “quiz” is intercepted before the Gemini call and answered with a topic-selection prompt instead of allowing the model to invent a random topic. A topic supplied in the direct reply can then continue as the MCQ task.

The application validates the quiz payload before delivery. Student-submitted options are preserved where practical, with four options preferred for generated SSC quizzes. Multiple-MCQ requests produce a bounded batch of independent native Telegram quizzes (maximum 10), each with its own answer session. Telegram's native quiz result remains the student-facing feedback surface; Parmar does not send a second result message. Quiz outcomes are retained in conversation context so later follow-ups can refer to the exact question and selected answer.

## Structured output

Gemini is expected to return an `AnswerPacket` with fields for:

- answer,
- SSC takeaway,
- scope,
- subject,
- topic,
- question mode,
- exam relevance,
- difficulty,
- profile signal/note,
- revision topic,
- detected exam,
- time sensitivity,
- thinking level/grounding metadata.

Malformed, incomplete, or terminal `MAX_TOKENS` output is rejected according to the retry policy.

## Thinking policy

The configured environment value is a **maximum ceiling**, not a fixed instruction for every question.

The runtime chooses among:

- LOW: direct factual or very simple questions,
- MEDIUM: ordinary concepts/comparisons,
- HIGH: difficult, ambiguous, confused, or trap-style questions.

## Grounding policy

Google Search grounding can be enabled for questions that the classifier considers time-sensitive/current. Static historical and conceptual questions should not be grounded merely because grounding is available.

## Answer post-processing

Before Telegram delivery:

- literal escaped newline/carriage-return/tab sequences are normalized,
- code-fence wrappers are stripped where appropriate,
- redundant or malformed answer packets are rejected upstream,
- the final answer is kept bounded for Telegram delivery.

## Usage accounting

After each successful Vertex HTTP response, Gemini usage metadata is normalized into an `AiUsageRecord`. The record stores prompt/input, candidate/output, thoughts/reasoning, tool-use, cached-input and total token counts plus the selected model, thinking level, grounding state and estimated cost.

When the model requires an internal retry, each genuine model attempt is recorded. Accounting uses `(update_id, queue_attempt, attempt)` as a duplicate-safe key so queue redelivery cannot double-count the same model attempt.

The usage ledger is asynchronous and isolated from answer delivery; analytics failure must not prevent a valid answer from reaching Telegram.


## BRVIN central knowledge

BRVIN is the platform-level knowledge service. A PDF is ingested once into the central repository, assigned to a collection, OCR-processed, indexed by page and made eligible for retrieval only after page-grounded QA succeeds. The original Fatman 2nd Edition remains in its reviewed legacy namespace; no source is re-uploaded or silently re-keyed during the compatibility migration.

The administrator-only BRVIN console is at `/admin/brvin`. It manages:
- **Knowledge sources:** book/document registry, fingerprint, page count, indexed-page count, processing state and error state.
- **Collections:** logical groups of documents. Collection membership alone does not grant every project access.
- **Projects:** explicit project identities and access grants.
- **Governance:** direct book-to-project grants and project-to-collection grants. A project has no knowledge access by default.
- **Operations:** append-only specialist-stage telemetry for secure upload, Vision OCR, page indexing, monitor/repair, recovery, retrieval QA and readiness. The browser refreshes the operational view every five seconds from D1.

New PDFs use private resumable GCS objects under `brvin/imports/{importId}/`, and BRVIN-owned AI Search keys under `brvin/books/{bookId}/pages/`. Existing additional Fatman book keys under `fatman/books/{bookId}/pages/` remain resolvable during migration; the built-in reviewed source remains under `fatman/pages/`. OCR outputs and cleanup derive their object prefix from the import's stored source path, so legacy and BRVIN jobs do not cross-delete one another. Previously indexed pages under the former `vrain/books/{bookId}/pages/` prefix remain readable without re-indexing; new imports write only BRVIN-prefixed keys. In-flight uploads retain their stored GCS object paths so cleanup remains correctly scoped.

The existing Cloudflare Workflow remains the durable execution engine: async Google Vision OCR, page batches, bounded retry/repair, index monitoring, distributed page-grounded retrieval probes and temporary OCR-object cleanup. A book is marked `ready` only after all expected pages are indexed and retrieval QA passes. Failures remain visible for administrator recovery and do not become retrieval evidence.

Retrieval is project-scoped server-side. A request resolves an active BRVIN project, computes its directly assigned books and books in assigned collections, then admits only `ready` sources with `indexed_pages = page_count`. Search hits are filtered again against the allowed source prefixes before passages/citations are returned. Fatman uses its own `fatman` BRVIN project grants. Future products should call the shared BRVIN retrieval service with their own registered project slug; they must not query the shared AI Search namespace directly.

The current implementation uses the existing D1 database, GCS bucket, Cloudflare Workflow and shared AI Search namespace to avoid resource duplication. Project access is isolated logically at the service boundary and index-key prefix; deployments that require hard tenant isolation can later allocate a dedicated namespace/bucket without changing the project/collection model.
