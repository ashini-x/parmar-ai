# Data Model — v2.4.1

## Durable Object keys

| Key | Purpose |
|---|---|
| `profile:v1` | Student profile payload. The key is retained for backward compatibility while the stored profile carries version `2`. |
| `meta:rate:v2` | Daily/burst quota metadata. |
| `meta:conversation_reset` | Timestamp boundary for `/reset`. |
| `job:<updateId>` | Durable question job record. |
| `profile:applied:<updateId>` | Idempotency marker preventing duplicate profile updates. |

## Student profile

```ts
interface StudentProfile {
  version: 2;
  targetExam: string;
  recentTopics: string[];
  recentSubjects: string[];
  attentionTopics: string[];
  revisionQueue: string[];
  learningSignals: LearningSignal[];
  questionCount: number;
  lastUpdatedAt: number;
}
```

`learningSignals` records evidence, not a permanent diagnosis. Each signal has:

```ts
interface LearningSignal {
  topic: string;
  confusionCount: number;
  weakCount: number;
  lastSeenAt: number;
}
```

## Rate metadata

The rate state tracks:

- current burst window start,
- burst count,
- India day key,
- daily count,
- last rate notification timestamp.

The accepted-question counters are independent of `/reset`.

## D1 tables

### `users`
Canonical Telegram user ID, private chat ID, identity fields, first-seen time, target exam, bot flag.

### `questions`
Operational analytics projection for accepted questions and their final processing result.

### `events`
Operational/admin events such as start, reset, profile view, study plan, daily-limit reached, and burst-limit reached.

## Privacy note

D1 intentionally contains question and answer analytics for operations. Raw question/event rows are subject to the configured retention cleanup. Production administrators should limit dashboard access and export only the minimum information needed.
