# Security Policy

## Scope
This policy covers the public source repository and the production Worker, Telegram integration, Queue/Durable Object processing, D1 analytics, AI integration, and admin control center.

## Supported line
The current documented production line is `v2.6.x`.

## Never publish
Never commit or publicly paste Telegram tokens, webhook/setup secrets, Google service-account private keys, Cloudflare credentials, admin passwords, session secrets, production D1 exports, raw private logs, private billing data, `.env`, `.dev.vars`, or other credentials.

## Vulnerability reporting
Do not create a public issue containing exploit details. Use the project's configured private security-reporting channel. Include the affected component, impact, reproduction summary, and source/deployment version when safe to disclose.

## Secret exposure
1. Revoke or rotate the credential at the provider.\n2. Replace the Cloudflare secret/configuration.\n3. Review relevant Worker and audit logs.\n4. Determine whether users or data were affected.\n5. Deploy a verified fix.\n6. Preserve an internal incident record.

## Security principles
- Webhook secrets fail closed.\n- Owner/Admin authorization uses numeric Telegram IDs.\n- Dashboard mutations are server-side and same-origin protected.\n- Privileged access changes are verified in D1.\n- Logs must not contain secrets.\n- Retention and deletion are treated as explicit data controls.

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).