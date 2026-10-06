# Data Model — v2.5.1

## Durable Object keys

| Key | Purpose |
|---|---|
| `profile:v1` | Student profile payload. The key is retained for backward compatibility while the stored profile carries version `2`. |
| `meta:rate:v2` | Daily/burst quota metadata. |
| `conversation:resetAt` | Timestamp boundary for `/reset`. |
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

The accepted-question counters are independent of `/reset`. Privileged access is a separate authorization state and is also independent of `/reset`.

## D1 tables

### `users`
Canonical Telegram user ID, private chat ID, identity fields, first-seen time, target exam, bot flag.

### `questions`
Operational analytics projection for accepted questions and their final processing result.

### `events`
Operational/admin events such as start, reset, profile view, study plan, daily-limit reached, and burst-limit reached.

## Privileged access model

There are three layers:

1. `BOT_OWNER_TELEGRAM_USER_ID` identifies the primary owner/admin.
2. `ADMIN_TELEGRAM_USER_IDS` optionally identifies additional admins.
3. `ai_access_overrides` stores runtime grants for specific Telegram IDs.

`UNLIMITED_AI_TELEGRAM_USER_IDS` is a deployment-time bootstrap allowlist. It is useful for trusted test accounts but is not a replacement for the D1 runtime grant system.

Privileged accounts bypass the daily AI allowance only. The 5 questions / 10 seconds burst safeguard remains active.

## Privacy note

D1 intentionally contains question and answer analytics for operations. Raw question/event rows are subject to the configured retention cleanup. Production administrators should limit dashboard access and export only the minimum information needed.


## D1 privileged access

### `ai_access_overrides`

Stores runtime grants for unlimited daily AI access.

| Column | Purpose |
|---|---|
| `telegram_user_id` | Target Telegram profile ID; primary key. |
| `unlimited_ai` | `1` while the override is active. |
| `granted_by_telegram_user_id` | Admin who granted the override. |
| `granted_at` | Grant timestamp. |
| `expires_at` | Optional future expiry timestamp; current admin commands create non-expiring grants. |

The owner/admin identity and static allowlist remain deployment configuration; runtime grants are stored in D1 so they can be changed without changing source code.


## AI usage ledger

### `ai_usage_attempts`

One row represents one genuine Vertex/Gemini model attempt. It contains token metadata, model/policy, grounding state, estimated cost in micro-USD, queue attempt number and completion/rejection status.

The unique key `(update_id, queue_attempt, attempt)` prevents duplicate accounting while allowing later Queue redelivery to remain visible when it actually performs another model attempt.

### `admin_audit_log`

Stores sensitive administrative actions such as access grants, revocations, suspension changes and profile resets.

### `admin_user_controls`

Stores per-student operational suspension state and administrator notes.

### `app_settings`

Reserved for safe, future runtime settings. Dangerous infrastructure configuration remains deployment configuration rather than mutable application state.
