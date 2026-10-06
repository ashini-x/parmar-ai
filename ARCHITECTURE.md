# Architecture — Parmar AI v2.5.1

## Design goals

v2.5.1 is optimized for a Telegram-first SSC doubt-solving workload where the student should receive a reliable answer even when secondary systems such as analytics or learning-profile persistence fail.

The architecture separates:

1. request admission,
2. durable job state,
3. asynchronous model execution,
4. profile personalization,
5. Telegram delivery,
6. analytics projection.

## Request lifecycle

```text
1. Telegram sends webhook update
2. Worker authenticates Telegram webhook secret
3. Worker identifies private chat + Telegram user
4. Command messages are handled synchronously
5. Question enters Durable Object admission path
6. Duplicate/rate-limit checks run atomically in Durable Object
7. Worker sends short acknowledgement + typing action
8. Worker publishes question job to Cloudflare Queue
9. Queue consumer claims the job through Durable Object
10. Consumer loads profile + recent conversation context
11. Consumer calls Gemini through Vertex AI
12. Structured answer is validated
13. Student profile is updated best-effort
14. Answer is delivered to Telegram
15. Job is marked done and retained only as operational state needed by the conversation window/reliability logic
16. D1 analytics is updated as a separate projection
```

## Durable Object responsibilities

`JobDedupe` is the main per-private-chat operational state store.

It owns:

- duplicate update detection,
- question admission,
- daily quota counters,
- burst protection,
- job state (`pending`, `queued`, `processing`, `done`),
- active Queue message claim information,
- short conversation history,
- student profile,
- profile migration,
- profile-update idempotency.

The object serializes active AI processing for a chat so a student's answers remain ordered even though different chats can be processed concurrently.

## Queue responsibilities

The Queue decouples Telegram webhook acknowledgement from model latency. The consumer uses retries and a dead-letter queue for transient failures.

Permanent application errors should be logged with request/update/queue identifiers so they can be diagnosed without exposing user secrets.

## Gemini responsibilities

Gemini produces a structured `AnswerPacket`. The application validates the packet before delivery and rejects incomplete/malformed responses.

Thinking level is selected adaptively within the configured ceiling. Time-sensitive questions may use Google Search grounding when enabled by configuration.

## Profile update isolation

Profile learning is an enrichment layer, not the source of truth for answer delivery. A profile read failure falls back to a safe empty profile. A profile write failure must not prevent a valid answer from being delivered.

This rule was made explicit in v2.4 after the original `learningSignals` normalization regression demonstrated why personalization must not be allowed to block the primary response path.

## D1 responsibilities

D1 is a centralized analytics/admin projection:

- `users`
- `questions`
- `events`

It supports admin reporting, auditability, operational metrics, and retention cleanup.

D1 is not the primary rate-limit counter and is not the primary conversation store.

## Scheduled operations

The Worker runs a daily cleanup trigger that removes D1 raw questions/events older than the configured retention period.

## Failure boundaries

### Telegram failure
The webhook returns failure so Telegram can retry when acknowledgement or enqueueing cannot be safely completed.

### Queue failure
Queue retry/DLQ handling protects transient processing failures. Job state is durable and idempotent.

### Gemini failure
Retryability is determined from the structured Gemini error class/status handling.

### Profile failure
Profile failures are best-effort and must not strand the question.

### Analytics failure
D1 writes are queued asynchronously where practical and do not define the primary student response state.
