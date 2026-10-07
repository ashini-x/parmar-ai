# Data Directory

**Classification: Placeholder / non-production**

The data/ directory exists only to make the repository's data boundary explicit.

Production student and analytics data does not belong in GitHub. Runtime data is held in the configured Cloudflare services and is governed by the project's retention and deletion controls.

## Never commit

- production D1 exports
- Telegram user exports
- raw student conversations
- private message dumps
- service-account credentials
- access tokens or secrets
- private billing information
- confidential evaluation datasets
- copyrighted material that Parmar AI is not authorized to redistribute
- generated reports containing identifiable student information

## Allowed

Only sanitized, synthetic, public-domain, or otherwise properly authorized fixtures belong here.

Any fixture containing personal data must be synthetic unless the project owner has documented authorization and an explicit reason for inclusion.

## Governance

See:

- ../PRIVACY.md
- ../docs/DATA_GOVERNANCE.md
- ../docs/SECURITY_MODEL.md

This directory is not a backup location and must never be treated as a production data store.
