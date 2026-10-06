# HTTP/API Surface — v2.4.1

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
