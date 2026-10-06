# Security Policy

## Supported release

The supported production line is the latest v2.5.x release. For the current repository baseline, that is **v2.5.2**.

## Never publish

Do not commit or publish:

- Telegram bot tokens
- Telegram webhook/setup secrets
- Google service-account private keys
- Cloudflare API tokens
- Cloudflare Access secrets
- admin passwords
- session-signing secrets
- database exports containing real students
- production logs containing private message content unless explicitly sanitized

Example files may contain placeholders only.

## Reporting a vulnerability

For a suspected security vulnerability, do not create a public issue containing exploit details. Use the private security-reporting mechanism configured for the organization/maintainer, or contact the project security owner through a trusted private channel.

## Security controls in v2.5.2

- Secret-token validation for Telegram webhook requests.
- Separate setup secret for webhook configuration.
- Signed admin session cookie.
- Recommended Cloudflare Access in front of `/admin*`.
- No secret values in operational logs.
- Private-chat-only student processing.
- Telegram user ID as canonical analytics/profile identity.
- Bounded profile and conversation context.
- D1 retention cleanup.
- Profile failures isolated from answer delivery.

See `docs/SECURITY_MODEL.md` for the full model.


## Privileged access

Unlimited daily AI access is never inferred from a username, display name, or chat text. It is granted only from server-side configuration (`BOT_OWNER_TELEGRAM_USER_ID`, `ADMIN_TELEGRAM_USER_IDS`, or the static `UNLIMITED_AI_TELEGRAM_USER_IDS` list) or the D1 `ai_access_overrides` table.

The runtime `/grant` and `/revoke` commands require a configured admin Telegram ID. The target is supplied as a numeric Telegram user ID. Admin authorization is checked before the command executes.

The owner ID and admin ID list should be stored as deployment configuration rather than committed with the real values to the public repository.
