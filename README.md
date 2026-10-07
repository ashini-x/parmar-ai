# Parmar AI

**Production software — proprietary, source-available, not open source.**

Parmar AI is a Telegram-first SSC-focused AI study companion designed for fast doubt solving, conversation continuity, evidence-based study personalization, and controlled operational visibility.

**Legal/IP posture:** This repository is public for transparency and inspection. Public visibility is not permission to reuse the software. No commercial use, redistribution, derivative works, competing products, AI/ML training use, advertising, sponsorship, endorsement, or trademark use is granted unless separately authorized in writing. See [LICENSE](LICENSE), [AI_USAGE_POLICY.md](AI_USAGE_POLICY.md), and [TRADEMARKS.md](TRADEMARKS.md).

> **Important:** GitHub's platform terms still apply to GitHub hosting and functionality. If the requirement is to prevent public access or platform forking, make the repository private; a license alone cannot make a public GitHub repository physically uncopyable.

## Production baseline

Current documented production line: **v2.6.x**.

The system uses Cloudflare Workers, Queues, SQLite-backed Durable Objects, D1, Telegram Bot API, and Google Vertex AI / Gemini.

### Student capabilities
- SSC GA/GS-focused doubt solving.
- Recent-turn conversation continuity and follow-up handling.
- Evidence-based learning signals and revision guidance.
- `/profile`, `/exam`, `/reset`, `/help`, `/id`, and data-deletion commands.

### Reliability and controls
- Queue-backed asynchronous AI processing.
- Durable per-private-chat job state and duplicate protection.
- Retry and dead-letter handling.
- Structured answer validation.
- Telegram typing lifecycle and recovery.
- Server-side suspension.
- Dashboard-managed Telegram connection lifecycle.
- Server-side verified administrative mutations.

### Default usage policy
- **20 accepted AI questions per India calendar day.**
- **5 accepted questions per 10 seconds** for burst protection.
- Unlimited access bypasses only the daily quota; burst protection remains.

## Admin control center

The protected `/admin` application provides live analytics, AI usage/cost estimates, student search and profiles, learning analytics, grant/revoke unlimited access, suspend/unsuspend, profile reset, audit history, Telegram connect/switch/test/disconnect, and JSON reporting.

## Architecture

```text
Telegram -> Cloudflare Worker -> Durable Object
                         |
                         +-> D1 analytics/access/audit
                         +-> Queue -> Vertex AI/Gemini
                                   |-> D1 usage ledger
                                   |-> Telegram delivery
Protected /admin -> D1 analytics + access controls + audit log
```

## Public/private boundary

Public source is not a license to publish secrets or production data.

**Never commit:** Telegram tokens, webhook/setup secrets, Google private keys, Cloudflare credentials, admin passwords, session secrets, production exports, raw private logs, billing credentials, `.env`, `.dev.vars`, or equivalent secret files.

## Documentation

- [LICENSE](LICENSE) — proprietary source license.
- [NOTICE.md](NOTICE.md) — copyright and third-party notice.
- [SECURITY.md](SECURITY.md) — vulnerability and secret policy.
- [PRIVACY.md](PRIVACY.md) — product data-handling notice.
- [AI_USAGE_POLICY.md](AI_USAGE_POLICY.md) — AI/ML reuse restrictions.
- [TRADEMARKS.md](TRADEMARKS.md) — brand restrictions.
- [GOVERNANCE.md](GOVERNANCE.md) — ownership and change control.
- [CONTRIBUTING.md](CONTRIBUTING.md) — authorized-contribution rules.
- [SUPPORT.md](SUPPORT.md) — support boundaries.
- [docs/README.md](docs/README.md) — engineering documentation index.
- [reports/README.md](reports/README.md) — offline reporting.

## Deployment

Review the exact source revision, run the automated and manual checks, deploy the exact approved revision, record the Cloudflare version ID, and preserve the release artifact.

See [DEPLOY_DASHBOARD.md](DEPLOY_DASHBOARD.md), [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md), and [docs/VERSIONING.md](docs/VERSIONING.md).

## License

**Parmar AI Proprietary Source License v1.0 — All Rights Reserved.**

Copyright © 2026 Parmar AI. All rights reserved.