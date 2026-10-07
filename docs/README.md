# Parmar AI Documentation

**Documentation status: Controlled / proprietary**  
**Production line: 2.6.x**

This directory contains maintained engineering, operations, security, architecture, testing, governance, and release documentation.

Public visibility does not grant permission to republish, adapt, redistribute, commercialize, or use these materials for a competing product or promotional campaign.

## Documentation index

| Document | Purpose |
|---|---|
| AI_PIPELINE.md | AI request, validation, retry, and usage-accounting flow |
| API.md | Worker route and interface reference |
| DATA_MODEL.md | D1 and application data-model reference |
| OPERATIONS_RUNBOOK.md | Production troubleshooting and operational response |
| REPOSITORY_MAP.md | High-level source-tree orientation |
| SECURITY_MODEL.md | Trust boundaries, secrets, authentication, and incident response |
| SOURCE_INVENTORY.md | Controlled inventory of production source areas |
| TEST_PLAN.md | Production and manual acceptance scenarios |
| VERSIONING.md | Version and release discipline |
| DOCUMENTATION_POLICY.md | Documentation ownership and synchronization rules |
| DATA_GOVERNANCE.md | Data minimization, retention, export, access, and deletion |
| RELEASE_PROCESS.md | Release approval, deployment, validation, and rollback controls |

## Maintainer reading order

1. ../README.md
2. SECURITY_MODEL.md
3. ../ARCHITECTURE.md
4. DATA_MODEL.md
5. AI_PIPELINE.md
6. OPERATIONS_RUNBOOK.md
7. TEST_PLAN.md
8. VERSIONING.md
9. RELEASE_PROCESS.md

## Documentation rules

Documentation should remain synchronized with deployed behavior.

Review documentation whenever a change affects:

- authentication or authorization
- Owner/Admin roles
- Telegram connection lifecycle
- Queue, Durable Object, or retry behavior
- D1 schema or retention
- AI provider behavior
- quotas or access controls
- privacy/data handling
- administrator workflows
- production configuration
- security response
- release or rollback procedures

Never include secrets, production exports, raw private logs, or identifiable student data.

## Ownership

The project owner/maintainer determines which documents are current, which internal details may be published, and which information requires restricted handling.

For intellectual-property rules, see ../LICENSE and ../TRADEMARKS.md.
