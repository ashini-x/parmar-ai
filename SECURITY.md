# Security Policy

**Supported production line: 2.6.x**

Parmar AI treats security, student privacy, and production access control as high-priority concerns.

## Never publish

Do not commit or disclose:

- Telegram bot tokens
- Telegram webhook or setup secrets
- Google service-account private keys
- Cloudflare API tokens
- admin passwords
- admin session-signing secrets
- encryption keys
- production D1 exports
- raw production logs containing private questions
- private incident evidence

## Current controls

The current application includes:

- fail-closed Telegram webhook secret validation
- independent setup authentication
- signed admin sessions
- same-origin protection for admin mutations
- server-side privilege checks
- protected Owner/Admin identities
- encrypted dashboard-managed Telegram bot credentials
- D1 retention cleanup
- explicit user-data deletion
- private-chat-only processing
- verified student access mutations
- protected administrative audit handling

See docs/SECURITY_MODEL.md for the detailed trust-boundary model.

## Vulnerability reporting

Do not create a public issue containing credentials, exploit instructions, private student data, or a working production attack path.

Use the private security-reporting channel maintained by the project owner.

Provide only the information necessary to reproduce and remediate the issue. Include the affected release/version and request or correlation identifiers where available.

## Secret compromise

If a secret may have been exposed:

1. rotate or revoke it at the provider;
2. update the Cloudflare deployment secret;
3. validate the affected path;
4. review logs and audit events;
5. deploy the patched release;
6. document the incident privately.

## Responsible disclosure

The project does not promise a particular response time, bounty, or public advisory schedule. Disclosure timing is determined by the maintainer based on severity, user impact, and remediation readiness.
