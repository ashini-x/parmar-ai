# HTTP/API Surface: v2.5.2

The Worker is primarily a Telegram webhook service. Admin routes are protected by the signed dashboard session.

## Public/runtime routes

### `GET /`
Returns a small health/status response with current service/version information.

### `GET /health`
Returns machine-readable health information.

### `POST /telegram/webhook`
Telegram Bot API webhook entry point. Requests must include Telegram's configured webhook secret header.

### `POST /telegram/setup`
Sets the Telegram webhook and bot command menu. Requires the setup secret.

## Admin routes

### `GET /admin`
Protected HTML Admin Control Center.

### `POST /admin/login`
Creates the signed admin session when configured credentials are correct.

### `POST /admin/logout`
Clears the admin session.

### `GET /admin/api/overview`
Owner-level operational summary: users, questions, success/failure, latency, backlog, quota events, AI usage/cost, alerts, top subjects/topics, quota distribution, active users and retention snapshots.

### `GET /admin/api/users`
Searchable student directory with today/30-day/all-time question volume, estimated spend, access state and last activity.

### `GET /admin/api/questions`
Per-student question history with associated AI token/cost aggregates.

### `GET /admin/api/user`
Detailed student view including target exam, usage, estimated spend, top topics, learning signals and recent questions.

### `GET /admin/api/ai-usage`
Token/cost reporting by date window, model, thinking level, grounding and expensive request.

### `GET /admin/api/learning`
Subject, topic, question-mode and repeated-confusion analytics.

### `GET /admin/api/activity`
Recent question activity with status, attempts, latency, token usage and estimated cost.

### `GET /admin/api/access`
Owner/admin configuration visibility and D1 runtime unlimited-access overrides.

### `GET /admin/api/audit`
Administrator action audit log.

### `GET /admin/api/system`
Runtime configuration/health visibility, retention, quota and AI pricing configuration.

### `GET /admin/api/export`
Exports an analytics snapshot for the selected number of days. This is intended for offline founder reporting.

### `POST /admin/api/action`
Protected administrative actions:

- `grant_unlimited`
- `revoke_unlimited`
- `suspend`
- `unsuspend`
- `reset_profile`

The server derives the audit actor from the configured dashboard username rather than trusting a browser-supplied actor value.

## Telegram admin commands

Configured bot owner/admin identities may use private-chat commands:

- `/grant <telegram_user_id>`: create/renew unlimited daily AI access.
- `/revoke <telegram_user_id>`: remove a runtime unlimited-AI override.
- `/unlimited <telegram_user_id>`: inspect access status.
- `/id`: display the requesting private-chat user's numeric Telegram ID.

These controls do not remove the five-question/10-second burst safeguard.

## Error conventions

JSON APIs use HTTP status codes plus a machine-readable `error` field. Request IDs may be attached for operational correlation. Internal stack traces and provider credentials are not exposed to students.


## Owner Intelligence API (Owner session only)

All routes below require a valid `requireOwner` session. They do not accept an owner ID from the browser. JSON responses use `{ ok: true, ... }` on success and a machine-readable `error` on failure.

| Method | Route | Behavior |
|---|---|---|
| `GET` | `/admin/api/intelligence/conversations` | List up to the latest 100 conversations for the signed-in Owner. |
| `POST` | `/admin/api/intelligence/conversations` | Create a conversation. Optional `title`; defaults to `New chat`. Title maximum 80 characters. |
| `GET` | `/admin/api/intelligence/conversations/:id` | Reopen a conversation and return its messages in creation order. |
| `PATCH` | `/admin/api/intelligence/conversations/:id` | Rename with JSON body `{ "title": "..." }`. |
| `DELETE` | `/admin/api/intelligence/conversations/:id` | Delete the conversation and its saved messages. |
| `POST` | `/admin/api/intelligence/conversations/:id/messages` | Save an Owner-authored message with JSON body `{ "content": "..." }`. Maximum content length: 50,000 JavaScript characters. |
| `POST` | `/admin/api/intelligence/conversations/:id/generate` | Generate an assistant response using `{ "content": "...", "modelId": "...", "thinkingLevel": "..." }`. Optional `editMessageId` edits a prior user prompt; `{ "action": "regenerate", ... }` regenerates the latest user prompt. Returns server-sent events. |

All mutations require a matching same-origin `Origin` header and reject cross-site fetch metadata. Conversation identifiers must be UUIDs. Every database operation is scoped to the normalized configured Owner username. A missing conversation or one owned by another principal returns 404 rather than disclosing its existence.

The conversation/message APIs remain Owner-scoped and use the existing dedicated D1 tables. Generation is a separate Owner-only endpoint. Every mutating request requires a matching same-origin `Origin` header and rejects cross-site fetch metadata. The generation endpoint validates the selected model and thinking level against the server registry; it does not accept a browser-selected project, location, endpoint or credential.

The generation endpoint returns `text/event-stream` events: `meta` identifies the pending assistant message and selected model/level, `delta` carries user-facing text, `done` reports the saved final message and usage, and `error` reports a sanitized failure. The browser can stop by aborting the request; request cancellation is forwarded to Vertex. Partial output is periodically saved with `partial` status. Editing a user message replaces it and deletes later turns; regeneration retains the latest user prompt and removes later turns before creating a new assistant response. A disconnected stream can be reopened from the saved conversation, but automatic in-place stream reconnection is not implemented.



### `GET /admin/api/intelligence/models`

Owner-only model catalogue. Reads the project/location from Worker environment bindings and probes the centrally maintained Gemini candidate allowlist using the Vertex AI Count Tokens endpoint. The response contains sanitized model IDs, labels, API version, adapter modalities, context/output limits, supported/default thinking metadata, availability and `selectable`. Only a successful project/location probe produces `selectable: true`. No credentials are returned and the caller cannot supply model ID, project, location or endpoint. A successful catalogue is cached for 90 seconds. This endpoint does not generate an assistant response. A successful Count Tokens probe confirms that the configured project/location can perform token estimation for that candidate; it does **not** prove the service account can invoke GenerateContent/streamGenerateContent for that model. Actual generation permission is evaluated when a response is requested. A 401/403 at generation is reported separately and must not trigger silent model fallback.

A 400/404 candidate is reported unavailable; 401/403 is denied; transient provider failures/timeouts remain unverified. These states are not selectable. Availability may change after the probe because provider quotas, billing, regional eligibility and capacity remain external constraints.
