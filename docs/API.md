# HTTP/API Surface — v2.5.2

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

- `/grant <telegram_user_id>` — create/renew unlimited daily AI access.
- `/revoke <telegram_user_id>` — remove a runtime unlimited-AI override.
- `/unlimited <telegram_user_id>` — inspect access status.
- `/id` — display the requesting private-chat user's numeric Telegram ID.

These controls do not remove the five-question/10-second burst safeguard.

## Error conventions

JSON APIs use HTTP status codes plus a machine-readable `error` field. Request IDs may be attached for operational correlation. Internal stack traces and provider credentials are not exposed to students.
