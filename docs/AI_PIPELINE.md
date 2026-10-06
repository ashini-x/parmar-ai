# AI Pipeline

## Input contract

The Worker accepts text-only private Telegram messages up to `MAX_QUESTION_LENGTH` characters.

The question is passed to the Queue as a versioned `QuestionJob` containing:

- `updateId`
- `chatId`
- `question`
- `messageId`
- `requestId`
- `createdAt`
- optional Telegram status message ID

## Context assembly

Before Gemini execution, the consumer builds a `ProfileContext` containing:

- target exam,
- recent topics,
- recent subjects,
- attention topics,
- revision queue,
- up to six recent completed in-scope conversation turns.

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

- LOW — direct factual or very simple questions,
- MEDIUM — ordinary concepts/comparisons,
- HIGH — difficult, ambiguous, confused, or trap-style questions.

## Grounding policy

Google Search grounding can be enabled for questions that the classifier considers time-sensitive/current. Static historical and conceptual questions should not be grounded merely because grounding is available.

## Answer post-processing

Before Telegram delivery:

- literal escaped newline/carriage-return/tab sequences are normalized,
- code-fence wrappers are stripped where appropriate,
- redundant or malformed answer packets are rejected upstream,
- the final answer is kept bounded for Telegram delivery.
