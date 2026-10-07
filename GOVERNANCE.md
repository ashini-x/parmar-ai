# Governance

## Ownership
Parmar AI is a privately controlled proprietary software project. The project owner retains final authority over repository visibility, licensing, trademarks, production releases, infrastructure, privileged access, security response, contributions, and product direction.

## Change control
Production changes should be defined, reviewed, implemented as a coherent change set, regression-tested, documented, verified against an exact revision, deployed as that revision, and recorded with the resulting Cloudflare version ID.

## Elevated review
Authentication, authorization, Owner/Admin logic, quotas, Telegram bot lifecycle, Queue/Durable Object state, D1 schema/retention, prompts, data deletion, and credentials are release-sensitive areas.

## Release integrity
Do not silently edit a deployed artifact and continue calling it the same release.

## Contributions
There is no implied right to contribute code. See [CONTRIBUTING.md](CONTRIBUTING.md).