# Data Model

## Durable Object keys

| Key | Purpose |
|---|---|
| `profile:v1` | Student profile payload. The key is retained for backward compatibility while the stored profile carries version `2`. |
| `meta:rate:v2` | Daily/burst quota metadata. |
| `meta:unsupported-video-notice` | Ten-second per-chat notice throttle for rejected video uploads. |
| `conversation:resetAt` | Timestamp boundary for `/reset`. |
| `job:<botConnectionId>:<updateId>` | Durable question job record, including temporary Telegram photo file IDs when a job has images. Photo IDs are cleared on completion; abandoned state follows 48-hour cleanup. |
| `photo-album:<botConnectionId>:<mediaGroupId>` | Temporary photo-album staging and update-deduplication state, including rejected mixed-media groups. Image file IDs are removed when a photo-only album is queued; staging follows 48-hour cleanup. |
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

The accepted-question counters are independent of `/reset`. Privileged access is a separate authorization state and is also independent of `/reset`. A photo album is admitted as one question and consumes one usage unit. Photo bytes are not stored in this data model; only Telegram file IDs are retained temporarily so Queue retries can retrieve the images.

## D1 tables

### `users`
Canonical Telegram user ID, private chat ID, identity fields, first-seen time, target exam, bot flag.

### `questions`
Operational analytics projection for accepted questions and their final processing result.

### `events`
Operational/admin events such as start, reset, profile view, study plan, daily-limit reached, and burst-limit reached.

## BRVIN book lifecycle

`brvin_books` is the project-governed registry for imported PDF sources. `fatman_books` and `fatman_import_jobs` retain the ingestion/runtime projection for each imported book.

- `ready`: OCR/indexing and page-grounded retrieval verification passed; assigned projects may retrieve the book.
- `archived`: the book remains stored, indexed and assigned, but project retrieval excludes it because retrieval admits only `ready` books.
- `deleting` / `delete_failed`: an administrator initiated full per-book purge; the source is excluded from retrieval while the background workflow removes provider objects and registry rows.
- `legacy`: the built-in reviewed 538-page Fatman source is protected from imported-PDF archive and delete controls.

Archive/restore updates the `brvin_books` and `fatman_books` status projections together. It retains the source PDF, persistent AI Search page text/index, and `brvin_project_books` grants. Temporary Vision JSON is removed after the book becomes `ready` and retrieval QA passes.

New source PDFs use `brvin/source-pdfs/<book-id>/source.pdf`. New temporary Vision output uses `brvin/temporary-vision-ocr/<book-id>/`; the Worker applies an age-30-day lifecycle Delete rule only to that temporary prefix. Legacy source objects under `brvin/imports/<book-id>/source.pdf` keep their historic `ocr/` child prefix until the retention supervisor cleans it after `ready`.

Full deletion removes the source-PDF prefix and temporary Vision prefix separately, then removes only that book’s AI Search items, project grants and registry rows. Operational deletion events in `brvin_activity_events` and shared project/collection definitions are retained.

## Privileged access model

There are three layers:

1. `BOT_OWNER_TELEGRAM_USER_ID` identifies the primary owner/admin.
2. `ADMIN_TELEGRAM_USER_IDS` optionally identifies additional admins.
3. `ai_access_overrides` stores runtime grants for specific Telegram IDs.

`UNLIMITED_AI_TELEGRAM_USER_IDS` is a deployment-time bootstrap allowlist. It is useful for trusted test accounts but is not a replacement for the D1 runtime grant system.

Privileged accounts bypass the daily AI allowance only. The 5 questions / 10 seconds burst safeguard remains active.

## Privacy note

D1 intentionally contains question and answer analytics for operations. Raw question/event rows are subject to the configured retention cleanup. Production administrators should limit dashboard access and export only the minimum information needed.


## Native quiz sessions

The quiz_sessions table correlates a native Telegram quiz poll with the student and the generated content needed to validate the student's answer without re-running the model.

| Column | Purpose |
|---|---|
| poll_id | Telegram poll identifier; primary key used by poll_answer updates. |
| bot_connection_id | Telegram bot connection that created the poll. |
| telegram_user_id | Student allowed to answer the private quiz. |
| chat_id | Private Telegram chat used for result feedback. |
| update_id | Original Parmar question update that produced the quiz. |
| message_id | Telegram quiz message ID. |
| question_text | Native quiz question shown to the student. |
| options_json | Quiz option text in display order. |
| correct_option_ids_json | 0-based correct option IDs. |
| explanation | Compact Telegram-native explanation. |
| created_at / answered_at | Quiz lifecycle timestamps. |
| selected_option_ids_json | Student's selected option(s). |
| result | correct or incorrect after the first vote. |

Quiz sessions are intentionally one-shot: revoting is disabled so the first response becomes a clean learning/analytics signal.

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
