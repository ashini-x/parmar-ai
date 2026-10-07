# Security Model

## Trust boundaries
`Telegram -> Cloudflare Worker -> Durable Object / D1 / Queue -> Vertex AI`

`Protected /admin -> D1 analytics + access controls + audit log`

## Authentication
Telegram webhook requests require the configured secret header. `/telegram/setup` requires its setup secret. `/admin*` uses authenticated signed sessions and should additionally be protected by Cloudflare Access.

## Authorization
Owner/Admin checks use numeric Telegram IDs. Dashboard access mutations are server-side, same-origin protected, and verified against D1. Protected administrator identities cannot be suspended through ordinary student controls.

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