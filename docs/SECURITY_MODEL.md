# Security Model

## Trust boundaries

```text
Telegram platform
      |
      | signed webhook header
      v
Cloudflare Worker
      |
      +-- Durable Object state
      +-- D1 analytics
      +-- Cloudflare Queue
      |
      v
Google Vertex AI
```

## Authentication boundaries

### Telegram webhook
Requests to `/telegram/webhook` are accepted only when the configured `X-Telegram-Bot-Api-Secret-Token` matches.

### Telegram setup endpoint
`/telegram/setup` requires the independent setup secret.

### Admin
`/admin*` uses an application-level signed session cookie backed by `ADMIN_SESSION_SECRET` and credentials stored as Worker secrets. Cloudflare Access should be added in front of the path for defense in depth.

## Secret handling

Secrets must exist only in the deployment environment or local ignored configuration.

Never commit:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_SETUP_SECRET`
- `GCP_PRIVATE_KEY`
- `GCP_CLIENT_EMAIL`
- `GCP_PRIVATE_KEY_ID`
- `ADMIN_DASHBOARD_PASSWORD`
- `ADMIN_SESSION_SECRET`
- Cloudflare account/API credentials

## Logging

Logs must use operational identifiers rather than credentials. Avoid logging full authorization headers, raw service-account JSON, cookies, access tokens, or secret environment variables.

## Identity isolation

The canonical student identity for analytics/profile data is Telegram `from.id`. Usernames are mutable display metadata and must never be used as the primary identity key.

The current product accepts private chats only. Group traffic is rejected and redirected to DM so one group's users cannot accidentally share a stateful per-chat profile.

## Webhook integrity

Webhook requests must fail closed when the secret header is absent or mismatched.

## Data minimization and retention

Only the student profile information needed for personalization is retained in Durable Object state. Central D1 analytics is retained for the configured number of days and cleaned automatically.

## Incident response

1. Rotate the affected secret immediately.
2. Disable or invalidate compromised credentials at the provider.
3. Review Worker logs and admin events using request IDs.
4. Check whether D1 contains exposed payloads.
5. Deploy the patched release.
6. Record the incident and postmortem under the operational process.
