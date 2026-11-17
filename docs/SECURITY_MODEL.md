# Security Model

## Trust boundaries
`Telegram -> Cloudflare Worker -> Durable Object / D1 / Queue -> Vertex AI`

`Protected /admin -> D1 analytics + access controls + audit log`

## Authentication
Telegram webhook requests require the configured secret header. `/telegram/setup` requires its setup secret. `/admin*` uses an HMAC-signed 12-hour `parmar_admin_session` cookie with `HttpOnly`, `Secure`, and `SameSite=Strict`; production should additionally be protected by Cloudflare Access.

The web session carries a server-signed `admin` or `owner` role. The role is never accepted from browser input. Legacy pre-role session payloads remain valid as admin-only and do not acquire Owner privileges. Owner sessions use a signature key derived from `ADMIN_SESSION_SECRET` and the currently configured Owner credential, so rotating the Owner credential invalidates existing Owner sessions.

Production currently configures `OWNER_DASHBOARD_USER=admin` in `wrangler.jsonc`, explicitly assigning the single existing admin account to the Owner role. It reuses the existing admin login credential; no additional Owner password is stored in source. A future distinct Owner principal must use a different username and the `OWNER_DASHBOARD_PASSWORD` Cloudflare Worker secret. The Telegram `BOT_OWNER_TELEGRAM_USER_ID` is not a web-admin identity.

## Authorization
`requireAdmin` permits valid admin and Owner sessions for the existing admin application. `requireOwner` permits only the Owner claim. M1 protects `/admin/intelligence` and reserves `/admin/api/intelligence/*` behind that Owner guard. Anonymous requests are rejected, authenticated non-Owner admins receive forbidden responses, and an Owner-only reserved API path remains unhandled (404) until M2 implements it. Every future workspace route and API must independently enforce Owner authorization and same-origin checks for mutations.

Dashboard access mutations are server-side, same-origin protected, and verified against D1. Protected administrator identities cannot be suspended through ordinary student controls.

## Data separation
Durable Object holds private-chat operational state, profile, conversation, rate metadata, and job lifecycle. D1 holds analytics, AI usage, access overrides, audit entries, and Telegram bot metadata. Queue is transport for asynchronous processing.

## Secrets
Credentials must remain in secure deployment configuration. Never log tokens, private keys, cookies, authorization headers, or secret environment values.

## Telegram lifecycle
Dashboard-managed bot secrets are encrypted in D1. New bot connections are verified before switching from the active bot, with rollback safeguards.

## AI boundaries
Use bounded conversation/profile context and validate structured model output before delivery.

## Incident response
Rotate credentials, disable compromised access, inspect logs/audit events, assess impact, deploy the verified fix, and preserve an internal incident record.