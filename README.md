# परमार्थAI

**Production software: proprietary, source-available, not open source.**

परमार्थAI is a **Telegram-first, SSC-focused AI study companion** built for fast doubt solving, conversation continuity, adaptive study assistance, native quiz interaction, and controlled operational visibility.

The current production baseline is **v2.8.0**, including the multi-MCQ quiz workflow. Photo doubt support is being prepared on the `feat/photo-doubt-support` branch and is not deployed.

> **Public repository does not mean public reuse.** This codebase is published for transparency and inspection. Reuse, redistribution, commercial exploitation, derivative products, AI/ML training use, advertising or endorsement use, and Parmar branding are restricted by the repository's legal documents unless separately authorized in writing.

## Current product capabilities

### Student experience

Parmar currently supports:

- SSC GA/GS-focused doubt solving.
- Photo doubts only, with optional captions and albums of up to 5 pictures; videos are rejected (feature branch; not in production yet).
- Context-aware follow-ups using recent completed conversation turns.
- Simplification and clarification requests.
- Evidence-based study personalization, including recent topics, attention areas, and revision guidance.
- Telegram commands including /start, /help, /id, /profile, /exam, and /reset.
- User data deletion through the supported privacy flow.
- Semantic MCQ/test intent detection without turning ordinary doubts into quizzes.

### Native Telegram MCQs

The v2.8.0 quiz system is a first-class Telegram-native interaction:

- polity ka ek MCQ can produce one native Telegram quiz.
- polity ke 5 MCQs can produce **five independent native quizzes**, not one merged poll.
- A generic mcq or quiz request with no usable topic does **not** cause Parmar to invent a topic. The student is asked to choose one.
- Topic clarification remembers the requested quantity, so a follow-up such as polity can continue the original 5 MCQs request.
- Each quiz has its own Telegram poll/session correlation.
- Quiz answers are persisted for later reasoning and follow-up context.
- Telegram's native result/explanation surface is the student-facing feedback after a vote; Parmar deliberately does not send a duplicate result message.
- Partial batch delivery is cleaned up so failed batches do not leave misleading quiz state.
- Batch size is bounded to **10**.

## Reliability and backend controls

The production request path separates admission, durable state, model execution, delivery, and analytics.

- Cloudflare Worker webhook ingress.
- Durable Object state per private chat.
- Atomic duplicate/update protection and job admission.
- Daily quota and burst protection.
- Cloudflare Queues with retry and dead-letter handling.
- Lease-fenced/idempotent job processing and stale-job recovery.
- Structured AnswerPacket validation before delivery.
- Gemini / Vertex AI integration with retry classification.
- Telegram typing/status lifecycle and recovery.
- Contextual progress states in the same Telegram message, cycling through short phase-accurate variants during slow operations and transitioning into chunked answer streaming without separate status-message spam.
- Explicit Fatman Mode controls with separate Enter/Exit buttons, webhook callback self-sync from `/help`, and `/fatman on|off|status` text fallbacks.
- Best-effort personalization and analytics isolation so secondary failures do not unnecessarily block a valid student response.
- Protected server-side administrative mutations.

### Default usage controls

- **20 accepted AI questions per India calendar day.**
- **5 accepted AI questions per 10 seconds** for burst protection.
- Unlimited-access overrides bypass the daily quota only; burst protection still applies.
- A native quiz batch counts as its requested quantity for admission/quota accounting.

## Admin Control Center

The protected /admin application provides operational visibility and controlled mutations, including (dashboard data is loaded on page open and refreshed manually; no background polling):

- AI usage and estimated cost visibility.
- Student search and profile inspection.
- Learning and activity analytics.
- Grant/revoke unlimited access.
- Suspend/unsuspend controls.
- Profile reset operations.
- Audit history.
- Telegram bot connect, switch, test, and disconnect lifecycle.
- JSON export for approved offline reporting.

Administrative mutations are server-validated; the dashboard is not treated as an authority on its own.

## Architecture

The current production architecture is a **locked Telegram-first runtime** that separates webhook admission, per-chat operational state, durable Queue processing, model execution, Telegram delivery and D1 analytics.

For the exact as-built lifecycle, latency boundaries, recovery constants, observability fields, and the copy-forward checklist for the next bot, see **[docs/TELEGRAM_BOT_ARCHITECTURE.md](docs/TELEGRAM_BOT_ARCHITECTURE.md)**. The high-level summary is in [ARCHITECTURE.md](ARCHITECTURE.md).

~~~text
Telegram Bot API
      |
      v
Cloudflare Worker
(auth / commands / fast /start / question admission)
      |
      +---- /start -> send welcome first -> background analytics/menu/OAuth
      |
      +---- question -> per-chat Durable Object
                         (dedupe / quota / leases / profile / recovery)
                                      |
                                      v
                                Cloudflare Queue
                                      |
                                      v
                                Queue consumer
                                      |
                                      v
                                Vertex AI / Gemini
                                (structured AnswerPacket)
                                      |
                                      v
                                Telegram final delivery
                                      |
                                      +---- Durable Object operational state
                                      +---- D1 analytics projection

Protected /admin -> Worker -> D1 + verified access/audit mutations
Telegram poll_answer -> Worker -> quiz-session state + Durable Object context
~~~

### Primary responsibility split

**Worker ingress** authenticates Telegram updates, routes commands, sends the original `/start` welcome before ancillary work, and publishes new question jobs to the Queue before returning a queued response.

**Durable Objects** are the per-private-chat operational authority for atomic admission, daily/burst limits, duplicate protection, active-job leases, conversation/profile state and recovery.

**Queues** isolate webhook response time from model latency and provide retries and a dead-letter path. A post-publication typing/state hand-off runs in the background; it does not hold the normal webhook response open.

**Vertex AI / Gemini** returns a structured answer packet that the application validates before final Telegram delivery. Progress updates are cosmetic and have bounded failure recovery.

**D1** stores bot credentials, access overrides, analytics, AI usage and quiz-session projections. It is not the primary job/quota/conversation store.

## Data and privacy boundary

Production student data does **not** belong in GitHub.

Never commit:

- Telegram bot tokens or webhook secrets.
- Google service-account/private-key material.
- Cloudflare credentials.
- Admin/session secrets.
- Production D1 exports.
- Raw student conversations or private message dumps.
- Billing credentials.
- Production logs containing personal data.
- Confidential evaluation datasets.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [data/README.md](data/README.md).

## What is implemented vs. not yet shipped

This repository intentionally documents implemented behavior separately from future product concepts.

### Implemented today

The v2.8.0 baseline includes the SSC tutor workflow, native single/batch MCQs, per-quiz answer persistence, follow-up explanation context, production access controls, admin operations, usage accounting, and reliability hardening described above.

### Not shipped

The following remain future product work and must not be presented as existing capabilities:

- Telegram WebApp Battle Arena.
- Squad formation or matchmaking.
- Social/friend graph.
- Live spectator stadium or kill-feed.
- Sprint Coins or other in-app economy.
- Payments, donations, subscriptions, or marketplace rewards.
- Shareable competitive result cards.
- Advanced live rankings.
- Cross-student collective-intelligence/network-effect systems.

The current learning system is primarily **per-student**. Accumulated quiz and learning data provides a foundation for future aggregate intelligence, but no cross-student intelligence layer is claimed by v2.8.0.

## VRAIN Knowledge Platform

The repository now contains the source foundation for a separately deployable VRAIN Worker under [workers/vrain](workers/vrain/). It is intended to extract the Fatman-proven PDF ingestion pattern into a private, owner-operated knowledge service while leaving the current Parmar AI Worker untouched.

The standalone design uses Google Cloud Vision asynchronous PDF OCR, private resumable GCS uploads, server-side SHA-256 verification, page-level indexing, independent retrieval QA, a final publish gate, checkpoint-based automatic recovery, and project-scoped read-only API keys.

**Deployment status:** source and documentation are being added in this branch. The standalone Worker is not yet deployed; it requires a dedicated D1 database, private GCS bucket, Google Cloud IAM/secrets, and a verified end-to-end ingestion test. The currently deployed Parmar VRAIN compatibility path remains in place until a controlled migration and rollback window are complete.

- [VRAIN Platform Specification](docs/VRAIN_PLATFORM_SPEC.md)
- [VRAIN Owner Operations Runbook](docs/VRAIN_OPERATIONS_RUNBOOK.md)
- [Standalone Worker README](workers/vrain/README.md)

## Repository documentation

### Product, engineering, and operations

- [ARCHITECTURE.md](ARCHITECTURE.md): system design and failure boundaries.
- [docs/TELEGRAM_BOT_ARCHITECTURE.md](docs/TELEGRAM_BOT_ARCHITECTURE.md): locked production Telegram runtime and reusable blueprint for future bots.
- [PROJECT_STATUS.md](PROJECT_STATUS.md): shipped versus planned scope.
- [CHANGELOG.md](CHANGELOG.md): release history.
- [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md): release readiness.
- [DEPLOY_DASHBOARD.md](DEPLOY_DASHBOARD.md): dashboard deployment notes.
- [docs/README.md](docs/README.md): complete engineering documentation index.

### Security, privacy, and governance

- [LICENSE](LICENSE): controlling proprietary source license.
- [NOTICE.md](NOTICE.md): copyright and third-party notices.
- [SECURITY.md](SECURITY.md): vulnerability reporting and secret-handling policy.
- [PRIVACY.md](PRIVACY.md): product data-handling notice.
- [AI_USAGE_POLICY.md](AI_USAGE_POLICY.md): AI/ML reuse restrictions.
- [TRADEMARKS.md](TRADEMARKS.md): Parmar brand restrictions.
- [GOVERNANCE.md](GOVERNANCE.md): ownership and change control.
- [CONTRIBUTING.md](CONTRIBUTING.md): authorized contribution rules.
- [SUPPORT.md](SUPPORT.md): support boundaries.

### BRVIN — current source of truth

**Continuing BRVIN in a new chat? Start with [docs/BRVIN_2_MASTER_PLAN.md](docs/BRVIN_2_MASTER_PLAN.md).** It is the current handover and identifies the only active roadmap and technical references. M6–M10 are complete; M11 has one remaining real teacher-focused consumer retrieval/revocation acceptance test.

- [docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md): approved scope and active milestone acceptance.
- [docs/BRVIN_SYSTEM_REFERENCE.md](docs/BRVIN_SYSTEM_REFERENCE.md): as-built architecture and production state.
- [docs/BRVIN_2_ARCHITECTURE_DECISIONS.md](docs/BRVIN_2_ARCHITECTURE_DECISIONS.md): accepted architecture decisions.
- [docs/BRVIN_2_RPC_V2_CONTRACT.md](docs/BRVIN_2_RPC_V2_CONTRACT.md): current private v2 contract.
- [docs/BRVIN_INTEGRATION_GUIDE.md](docs/BRVIN_INTEGRATION_GUIDE.md): consumer Worker integration.
- [docs/BRVIN_TEACHERS_ARCHITECTURE.md](docs/BRVIN_TEACHERS_ARCHITECTURE.md): approved architecture for the separate downstream `ashini-x/brvin-teachers` platform; not a BRVIN core subsystem.
- [docs/BRVIN_SYSTEM_REFERENCE.md §10.6](docs/BRVIN_SYSTEM_REFERENCE.md): deployed BRVIN Teachers management entrypoint, consumer Service Binding and remaining environment-registration/retrieval gates.
- [docs/BRVIN_ADMIN_RUNBOOK.md](docs/BRVIN_ADMIN_RUNBOOK.md): administrator instructions.
- [docs/BRVIN_OPERATIONS_RUNBOOK.md](docs/BRVIN_OPERATIONS_RUNBOOK.md): engineering/operator troubleshooting.
- [docs/BRVIN_PRIVATE_RETRIEVAL_API.md](docs/BRVIN_PRIVATE_RETRIEVAL_API.md): legacy v1 compatibility only.

### Specialized directories

- [data/README.md](data/README.md): repository data boundary and fixture rules.
- [prompts/README.md](prompts/README.md): prompt-asset policy.
- [reports/README.md](reports/README.md): offline founder/operations reporting.

## Development and verification

The repository contains automated TypeScript/Vitest coverage plus a production-oriented Telegram acceptance plan.

Key package scripts:

~~~text
npm run check
npm test
npm run test:node
npm run format:check
npm run deploy
~~~

The Node-specific suite covers contracts that must remain runnable outside the Cloudflare test environment.

See [docs/TEST_PLAN.md](docs/TEST_PLAN.md) for the release acceptance matrix.

## Deployment discipline

Deploy only an explicitly approved source revision.

The release process should:

1. verify the intended source revision;
2. run automated checks and the applicable manual Telegram/admin acceptance tests;
3. deploy that exact revision;
4. record the resulting Cloudflare version identifier;
5. preserve the release manifest/checksums required by the repository process.

See [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md), [DEPLOY_DASHBOARD.md](DEPLOY_DASHBOARD.md), [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md), and [docs/VERSIONING.md](docs/VERSIONING.md).

## License and IP

**परमार्थAI Proprietary Source License v1.0: All Rights Reserved.**

Copyright © 2026 परमार्थAI. All rights reserved.

The LICENSE, AI usage policy, trademarks policy, privacy notice, and NOTICE file are part of the repository's controlling legal/documentation boundary. GitHub hosting terms still apply to the GitHub platform itself; a license cannot make a public repository physically impossible to copy or fork.