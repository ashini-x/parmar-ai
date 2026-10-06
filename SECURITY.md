# Security Policy

## Supported release

The supported production line is the latest deployed v2.4.x release. For the current repository baseline, that is **v2.4.1**.

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

## Security controls in v2.4.1

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
