# Parmar AI Engineering Documentation

This directory contains the engineering, operational, security, data, release, and verification documents that describe the implemented Parmar AI system.

The current source baseline is **v2.8.0**.

## Start here

| Document | Purpose |
|---|---|
| [REPOSITORY_MAP.md](REPOSITORY_MAP.md) | Where major source, config, tests, prompts, and operational assets live. |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | High-level system architecture and failure boundaries. |
| [TELEGRAM_BOT_ARCHITECTURE.md](TELEGRAM_BOT_ARCHITECTURE.md) | Locked as-built Telegram runtime, latency boundaries, operational invariants and reusable blueprint for the next bot. |
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

- [API.md](API.md): supported HTTP/webhook/admin surface and request expectations.
- [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md): tracked source/assets and their roles.
- [DOCUMENTATION_POLICY.md](DOCUMENTATION_POLICY.md): documentation maintenance requirements.

## Telegram bot runtime — locked source of truth

**For any future Telegram bot built from this codebase, start with [TELEGRAM_BOT_ARCHITECTURE.md](TELEGRAM_BOT_ARCHITECTURE.md).** It records the production webhook/`/start` fast path, Durable Object admission and recovery, Queue hand-off, runtime D1 schema boundary, Gemini stream, progress retry policy, observability and the reuse checklist. [../ARCHITECTURE.md](../ARCHITECTURE.md) is the short overview only.

The generic Telegram runtime should be copied independently from Parmar's SSC/Fatman/BRVIN business logic. Every new bot gets isolated Cloudflare resources, secrets and application data.

## BRVIN — current source of truth

**For every new BRVIN chat, start with [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md).** It is the current continuation handoff, not an archive or aspirational plan. It points to the only active product-scope, architecture, contract and operator references.

| Active document | Purpose |
|---|---|
| [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md) | Single current-state and new-chat continuation entry point. |
| [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md) | Approved product boundary and active M6–M11 acceptance ledger. |
| [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) | Current as-built architecture, infrastructure, D1 model, trust boundary and production state. |
| [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md) | Accepted architecture decisions; historical evidence is labelled and is not a task list. |
| [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md) | Current private v2 retrieval and connection-proof contract. |
| [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md) | One-time integration of a same-account consumer Worker. |
| [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md) | Day-to-day administrator instructions. |
| [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md) | Engineering/operator procedures, API references and troubleshooting. |
| [BRVIN_PRIVATE_RETRIEVAL_API.md](BRVIN_PRIVATE_RETRIEVAL_API.md) | Legacy v1 contract for existing Fatman compatibility only. |

The active architecture is the shared `parmar-ai` admin/ingestion plane plus private `brvin-service` retrieval Worker. New consumers use the v2 trusted application/environment identity and project grants. Consumer applications own end-user authentication and model generation.

**Superseded plans:** the autonomous Project Factory proposal and the old M3 connector/reference-client design were removed from the active documentation tree. Do not recreate their milestones or the retired `brvin-test-client`. Past text remains recoverable from Git history, not as active requirements.

## BRVIN Teachers — planned downstream application platform

**BRVIN Teachers** is the planned multi-channel, multi-tenant application platform for operating teacher-specific AI teaching experiences. It is a **separate downstream consumer**, not BRVIN core, not a BRVIN Worker and not a currently deployed capability. Its approved architecture and phased build direction are recorded in [BRVIN_TEACHERS_ARCHITECTURE.md](BRVIN_TEACHERS_ARCHITECTURE.md).

The proposed implementation repository is `ashini-x/brvin-teachers` (not yet created). It will use the existing private BRVIN v2 Service Binding for authorized knowledge retrieval. BRVIN source data, ingestion, grants and retrieval remain in the existing BRVIN system in `ashini-x/parmar-ai`. The existing Parmar AI SSC application also remains standalone for now; there is no initial code or production-data transfer. BRVIN Teachers is intended to have one central Operator Console for all its tenant teachers and channel instances, not one admin panel per Telegram bot. This planning document does not change BRVIN scope or close the remaining M11 real-consumer acceptance gate.

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

## VRAIN standalone knowledge platform

The standalone VRAIN Worker source now lives under [../workers/vrain](../workers/vrain/). It is a separate runtime and resource boundary from the current Parmar AI Worker. It is not deployed or cut over yet.

| Document | Purpose |
|---|---|
| [VRAIN_PLATFORM_SPEC.md](VRAIN_PLATFORM_SPEC.md) | Detailed product boundary, owner/consumer security model, Google Cloud Vision OCR, page indexing, QA, recovery, API, D1 model, and migration architecture. |
| [VRAIN_OPERATIONS_RUNBOOK.md](VRAIN_OPERATIONS_RUNBOOK.md) | Dedicated D1/GCS/Cloud Vision setup, secrets, deployment, source upload, monitoring, recovery, API-key rotation, and operational checks. |
| [../workers/vrain/README.md](../workers/vrain/README.md) | Standalone Worker commands, required resources, authentication, and compatibility boundary. |

The existing Parmar AI VRAIN implementation remains the deployed compatibility path until the new Worker passes an end-to-end multi-page OCR/retrieval test and a controlled cutover.

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