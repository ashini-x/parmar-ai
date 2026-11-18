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


## Owner Intelligence workspace

The Owner-only general-purpose workspace uses two dedicated D1 tables. These records are not part of the student Telegram data model.

### `owner_intelligence_conversations`

| Column | Purpose |
|---|---|
| `id` | UUID primary key for the conversation. |
| `owner_id` | Normalized configured web Owner username used to scope access. |
| `title` | Owner-visible title; defaults to `New chat`, maximum 80 characters. |
| `created_at` | Creation time in Unix milliseconds. |
| `updated_at` | Last conversation/message update time in Unix milliseconds. |

### `owner_intelligence_messages`

| Column | Purpose |
|---|---|
| `id` | UUID primary key for the message. |
| `conversation_id` | Parent conversation UUID; foreign key with cascade-delete semantics. |
| `owner_id` | Normalized configured web Owner username; every read/write is scoped by it. |
| `role` | `user`, `assistant` or `system`; the public composer writes user prompts and the generation route writes assistant turns. |
| `content` | Message text, up to 50,000 JavaScript characters. Assistant text is incrementally updated while a response streams. |
| `status` | `pending`, `complete`, `partial` or `error`; a stopped/disconnected generation with received text is retained as `partial`. |
| `created_at` | Creation time in Unix milliseconds. |

### `owner_intelligence_generation_metadata`

| Column | Purpose |
|---|---|
| `message_id` | Assistant message primary key and foreign key to `owner_intelligence_messages`; metadata is deleted with its message. |
| `owner_id` | Normalized configured web Owner username; every read/write is scoped by it. |
| `model_id` | Server-allowlisted Vertex publisher model used for the response. |
| `thinking_level` | Model-specific thinking level sent to Vertex. |
| `prompt_tokens` | Input token count returned by Vertex, or zero when absent. |
| `output_tokens` | Candidate/output token count returned by Vertex, or zero when absent. |
| `total_tokens` | Total token count returned by Vertex, or zero when absent. |
| `elapsed_ms` | Server-measured elapsed generation time in milliseconds. |


### `owner_intelligence_session_usage`

| Column | Purpose |
|---|---|
| `conversation_id` | Primary key and foreign key to one Owner conversation; one independent budget per chat. |
| `owner_id` | Configured Owner principal; all reads and writes are Owner-scoped. |
| `token_limit` | Session budget in tokens; currently 200,000. |
| `used_tokens` | Cumulative committed usage for every generation in this conversation. Editing or regenerating a turn does not refund tokens already consumed by Vertex. |
| `reserved_tokens` | Prompt plus permitted output capacity held while one generation is in flight. A conversation cannot reserve a second generation concurrently. |
| `locked_reason` | Server-side reason that makes the chat read-only when the remaining budget cannot support another request. |
| `updated_at` | Last usage/accounting update in Unix milliseconds. |

### `owner_intelligence_token_reservations`

| Column | Purpose |
|---|---|
| `reservation_id` | Unique generation-reservation UUID. |
| `conversation_id`, `owner_id` | Owner-scoped parent chat. |
| `reserved_tokens` | Exact CountTokens prompt count plus the output allowance reserved for this request. |
| `status` | `reserved`, `settled`, `released` or `expired`. |
| `actual_tokens` | Final Vertex total usage, or the conservative reservation amount when final usage is unavailable. |
| `usage_is_estimated` | Marks conservative reservation-based accounting when a final usage total was not received. |
| `created_at`, `settled_at` | Reservation start and settlement time in Unix milliseconds. |

The 200,000-token counter is cumulative for the lifetime of a conversation, not a model context-window setting. On first access to a legacy chat, the usage row is initialized from the sum of its recorded assistant `total_tokens` metadata. Historical generations whose usage was never recorded cannot be reconstructed. New chats receive a fresh budget. Deleting a conversation cascades its budget and reservations along with its messages. A missing final usage event is charged at the reserved amount rather than silently treated as zero.

Conversation list queries are limited to the latest 100 rows for the Owner principal. Deleting a conversation removes its messages and the conversation row; the generation metadata foreign key cascades with its assistant message. Changing `OWNER_DASHBOARD_USER` changes the owner scope and requires a deliberate migration if conversations must be retained. Password rotation does not change the scope.



### Owner GitHub integration tables (M4.3, additive)

The Owner GitHub tables are separate from the student Telegram data model and never hold the full Owner transcript.

#### `owner_intelligence_github_app`
One row per configured Owner. Stores GitHub App ID/slug/name, redirect URI, encrypted App private-key/client-secret bundle, App status and timestamps. Raw credentials and installation access tokens are never stored or returned to the browser.

#### `owner_intelligence_github_installations`
Owner + installation ID key. Stores App ID, GitHub account login/type, selected-repository mode, verified authorized GitHub user login, active/revoked status and timestamps. Installation identity is accepted only after PKCE GitHub user authorization confirms it in that user's installation list.

#### `owner_intelligence_github_states`
SHA-256 state hash primary key, Owner principal, purpose (manifest, installation or user authorization), JSON callback payload, creation time and expiry. Raw state is random and single-use; the database stores only its hash. Expired/replayed values are rejected.

#### `owner_intelligence_github_previews`
Owner-scoped preview UUID, source conversation and topic IDs, verified installation/repository IDs, repository owner/name, branch, memory root, expected base commit SHA, reviewed five-file JSON, status, commit SHA, expiry and timestamps. State transitions include ready, writing, committing, verifying, synced, conflict, expired and failed. The preview expires after 30 minutes. The exact file set and each/aggregate content size are bounded. A retry in committing/verifying uses the stored commit SHA rather than creating a second commit.

The existing `owner_intelligence_topics` table is extended with GitHub installation ID and repository ID in addition to its existing repository owner/name/branch, memory root, manifest revision and current commit SHA fields. A successful verified save updates the topic's current commit SHA and associates the existing Scratchpad conversation to the topic. This is not the M4.4 prompt snapshot; M4.4 separately records the exact repo/branch/commit selected for each conversation's active Project Memory context.

The Save draft is a normal metered Gemini generation. Its prompt/output tokens are recorded through the same `owner_intelligence_session_usage` and `owner_intelligence_token_reservations` records as chat generation. GitHub preview/confirm does not rewrite or delete transcript rows. The existing 200,000-token budget remains unchanged.

## Owner Memory Hub — planned project and collaboration records

The single planned private `owner-memory-hub` GitHub repository is a curated document store, not a code monorepo. It will hold a versioned hub manifest and project catalog, then project/workstream/feature namespaces with stable immutable IDs, JSON manifests and human-readable Markdown memory. Projects may reference multiple source repositories by full name, path hints and commit SHA; application source trees are not copied into the hub.

Planned logical records/files (schemas and D1 persistence must be designed and migrated in M4.4; these are not deployed D1 tables):
- Hub manifest/schema revision and project registry entries.
- Project, workstream and feature IDs, slugs, lifecycle state and parent/child relationships.
- Source-repository references (repository full name, intended role, default branch, relevant paths and last verified commit reference).
- Per-conversation primary project ID plus optional workstream/feature IDs.
- Immutable conversation memory snapshot: hub repository ID/full name, branch, commit SHA, manifest revision and exact selected paths.
- Collaboration thread/round IDs, author system, timestamps, status, source artifact commit SHA and related proposal/review/decision paths.
- Owner-accepted decision records and implementation-ready task brief IDs.
- ChatGPT implementation report references: code repository, PR/commit SHAs, test evidence, workflow/run IDs, deployed version IDs and rollback state.

Current deployed schema still has a flat Owner topic with one repository/branch/memory-root association and conversation `topic_id`. During the M4.3 transition, multiple topics may point to the same hub repository with distinct memory-root paths. M4.4 must add hierarchical identity/scope and pinned snapshots additively without resetting existing conversation IDs, transcript messages, generation metadata, or 200K usage/reservations. Do not implement these proposed entities/columns before inspecting the actual current migrations and planning compatibility/rollback.
