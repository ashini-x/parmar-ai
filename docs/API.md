# HTTP/API Surface — v2.4.2

The Worker is primarily a Telegram webhook service. The following public routes exist in the application.

## `GET /`
Returns a small health/status response identifying the service and current application phase/version.

## `POST /telegram/webhook`
Telegram Bot API webhook entry point.

Authentication:

```text
X-Telegram-Bot-Api-Secret-Token
```

The endpoint accepts Telegram updates and returns quickly after safe admission/enqueueing.

## `POST /telegram/setup`
Sets the Telegram webhook and bot command menu using the Worker configuration.

Requires the setup secret.

## `GET /admin`
Protected HTML dashboard.

## `POST /admin/login`
Creates the signed admin session when credentials are correct.

## `POST /admin/logout`
Clears the admin session.

## `GET /admin/api/overview`
Protected operational summary.

## `GET /admin/api/users`
Protected recent/user analytics listing.

## `GET /admin/api/questions`
Protected recent question analytics listing.

## Error conventions

JSON API errors include HTTP status and a machine-readable `error` field where applicable. A request ID may be attached to responses for operational correlation.

Do not expose internal stack traces or provider credentials to Telegram users.


## Admin Telegram access controls

Configured admins may use these private-chat commands:

- `/grant <telegram_user_id>` — create or renew unlimited daily AI access.
- `/revoke <telegram_user_id>` — remove a runtime unlimited-AI override.
- `/unlimited <telegram_user_id>` — check whether a target currently has unlimited access.

These commands do not appear in the global Telegram command menu. They affect runtime access only; they do not alter the normal 20/day policy for ordinary users.


## Student identity helper

- `/id` — returns the requesting private-chat user's Telegram numeric ID. This is intended for owner/admin configuration and self-identification.
