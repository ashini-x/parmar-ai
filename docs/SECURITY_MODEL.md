# Security Model

## Trust boundaries
`Telegram -> Cloudflare Worker -> Durable Object / D1 / Queue -> Vertex AI`

`Protected /admin -> D1 analytics + access controls + audit log`

## Authentication
Telegram webhook requests require the configured secret header. `/telegram/setup` requires its setup secret. `/admin*` uses an HMAC-signed 12-hour `parmar_admin_session` cookie with `HttpOnly`, `Secure`, and `SameSite=Strict`; production should additionally be protected by Cloudflare Access.

The web session carries a server-signed `admin` or `owner` role. The role is never accepted from browser input. Legacy pre-role session payloads remain valid as admin-only and do not acquire Owner privileges. Owner sessions use a signature key derived from `ADMIN_SESSION_SECRET` and the currently configured Owner credential, so rotating the Owner credential invalidates existing Owner sessions.

Analytics/BRɅIN schema initialization must not cache unresolved module-global Promises across Worker requests. The deployed implementation records only completed initialization per D1 binding and makes additive SQLite column migrations re-check after concurrent DDL races. The Owner login handler is awaited inside the Worker route error boundary so initialization failures are logged through the standard request error handler rather than escaping as an uncaught Worker exception.

Production currently configures `OWNER_DASHBOARD_USER=admin` in `wrangler.jsonc`, explicitly assigning the single existing admin account to the Owner role. It reuses the existing admin login credential; no additional Owner password is stored in source. A future distinct Owner principal must use a different username and the `OWNER_DASHBOARD_PASSWORD` Cloudflare Worker secret. The Telegram `BOT_OWNER_TELEGRAM_USER_ID` is not a web-admin identity.

## Authorization
`requireAdmin` permits valid admin and Owner sessions for the existing admin application. `requireOwner` permits only the Owner claim. The M2 `/admin/intelligence` page and `/admin/api/intelligence/*` handlers are guarded by `requireOwner`. Anonymous requests receive 401 and authenticated non-Owner admins receive 403. Conversation/message queries also filter by the normalized configured Owner principal, rather than trusting a browser-supplied owner identifier. Mutations require a matching same-origin Origin header and reject cross-site fetches. Owner sessions use a signature key derived from the configured Owner credential; password rotation revokes existing Owner sessions.

Dashboard access mutations are server-side, same-origin protected, and verified against D1. Protected administrator identities cannot be suspended through ordinary student controls.

## Data separation
Durable Object holds student private-chat operational state, profile, rate metadata and job lifecycle. D1 holds student analytics, AI usage, access overrides, audit entries and Telegram bot metadata. Queue is transport for asynchronous student processing. Owner Intelligence has separate D1 tables `owner_intelligence_conversations` and `owner_intelligence_messages`; Owner prompts are not written into student `questions` or student Durable Object state.

## Secrets
Credentials must remain in secure deployment configuration. Never log tokens, private keys, cookies, authorization headers, or secret environment values.

## Telegram lifecycle
Dashboard-managed bot secrets are encrypted in D1. New bot connections are verified before switching from the active bot, with rollback safeguards.

## AI boundaries
Use bounded conversation/profile context and validate structured model output before delivery.

## Incident response
Rotate credentials, disable compromised access, inspect logs/audit events, assess impact, deploy the verified fix, and preserve an internal incident record.

## Owner Intelligence workspace controls

The M2 page is served with `no-store`, `noindex,nofollow`, a per-response nonce-based script Content Security Policy, `nosniff` and `no-referrer`. The browser sends conversation IDs and message/title content only; the server resolves Owner identity from the signed session and configured Owner principal. Conversation IDs are UUID-validated and every D1 query includes the Owner scope. The production Owner scope currently maps to `OWNER_DASHBOARD_USER=admin`; changing that username requires an explicit data migration to preserve existing conversations.

