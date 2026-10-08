# Parmar AI Engineering Documentation

This directory contains the engineering, operational, security, data, release, and verification documents that describe the implemented Parmar AI system.

The current source baseline is **v2.8.0**.

## Start here

| Document | Purpose |
|---|---|
| [REPOSITORY_MAP.md](REPOSITORY_MAP.md) | Where major source, config, tests, prompts, and operational assets live. |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | High-level system architecture and failure boundaries. |
| [AI_PIPELINE.md](AI_PIPELINE.md) | Gemini/Vertex execution, response contracts, quiz semantics, and usage accounting. |
| [TEST_PLAN.md](TEST_PLAN.md) | Production-oriented automated and manual verification matrix. |
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | Diagnosis and recovery procedures. |
| [RELEASE_PROCESS.md](RELEASE_PROCESS.md) | Source approval, verification, deployment, and release recording. |
| [VERSIONING.md](VERSIONING.md) | Version and compatibility discipline. |

## Data and security

| Document | Purpose |
|---|---|
| [DATA_GOVERNANCE.md](DATA_GOVERNANCE.md) | Runtime-data handling, retention, deletion, and repository boundaries. |
| [DATA_MODEL.md](DATA_MODEL.md) | D1 and Durable Object data structures and relationships. |
| [SECURITY_MODEL.md](SECURITY_MODEL.md) | Trust boundaries, authentication, authorization, and secret handling. |

## API and source references

- [API.md](API.md) — supported HTTP/webhook/admin surface and request expectations.
- [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md) — tracked source/assets and their roles.
- [DOCUMENTATION_POLICY.md](DOCUMENTATION_POLICY.md) — documentation maintenance requirements.

## Current feature documentation

The v2.8.0 implementation includes:

- Telegram-first SSC doubt solving.
- Durable Object conversation and job state.
- Cloudflare Queue processing with retry/DLQ behavior.
- Structured Gemini/Vertex answer generation and validation.
- Semantic native Telegram quiz mode.
- Generic-MCQ topic clarification without random topic invention.
- Independent native Telegram quiz batches of up to 10 items.
- Per-quiz answer/session persistence.
- Quiz-result conversation context for follow-up explanations.
- D1 AI usage and analytics accounting.
- Protected admin controls and auditability.

### Native quiz contract

The current native quiz flow is intentionally different from ordinary text answers:

1. A genuine quiz intent is classified as quiz mode.
2. A generic quiz request without a topic anchor is intercepted before model generation and asks for a topic.
3. A topic reply continues the original requested quiz quantity.
4. The model returns validated quiz item(s).
5. Each batch item is delivered as its own Telegram native quiz/poll.
6. The selected answer is persisted against the quiz session.
7. Telegram's native result/explanation remains the student-facing vote result; Parmar does not send a duplicate result message.
8. The result is retained in short conversation context for subsequent explanation/follow-up questions.

## Documentation maintenance rule

Documentation must describe **deployed behavior, not aspirations**.

Whenever a change affects security, data handling, access control, Telegram behavior, persistence, AI contracts, quota/limits, admin operations, testing, or release procedures, update the relevant documentation in the same release.

Do not document unshipped Battle Arena, squad, social graph, ranking, economy, or other future systems as current product capabilities.

For repository-wide legal/security rules, see:

- [../LICENSE](../LICENSE)
- [../SECURITY.md](../SECURITY.md)
- [../PRIVACY.md](../PRIVACY.md)
- [../AI_USAGE_POLICY.md](../AI_USAGE_POLICY.md)
- [../TRADEMARKS.md](../TRADEMARKS.md)
- [../GOVERNANCE.md](../GOVERNANCE.md)
- [../CONTRIBUTING.md](../CONTRIBUTING.md)
- [../SUPPORT.md](../SUPPORT.md)