# Parmar AI

**Production line: 2.6.x**  
**Repository classification: Proprietary, source-available**  
**Copyright © 2026 Parmar AI. All rights reserved.**

> **IMPORTANT — PROPRIETARY SOFTWARE**
>
> This repository is public for controlled source inspection and project transparency. It is not an open-source project and is not licensed for general reuse, modification, redistribution, deployment, resale, competing products, advertising, endorsement, or promotional use.
>
> Public GitHub visibility does not make the software public-domain or open-source. GitHub's Terms of Service separately provide platform-level rights to view and fork public repositories. No additional permission is granted by Parmar AI beyond those platform rights. See LICENSE and TRADEMARKS.md.

## 1. Product

Parmar AI is a Telegram-first SSC study companion designed around fast doubt resolution, conversational continuity, evidence-based study personalization, usage controls, and operational visibility.

The production system uses:

- Cloudflare Workers
- Cloudflare Queues
- SQLite-backed Durable Objects
- Cloudflare D1
- Telegram Bot API
- Google Vertex AI / Gemini

The repository contains application code, tests, deployment templates, reference schemas, controlled documentation, prompt assets, and offline reporting utilities. Production secrets and real student data are intentionally excluded.

## 2. Current production scope

### Student experience

- SSC GA/GS-focused doubt solving.
- Exam-oriented factual and conceptual explanations.
- Adaptive Gemini reasoning within the configured ceiling.
- Recent conversation continuity and contextual follow-ups.
- Simplification and confusion-aware responses.
- Evidence-based learning signals.
- Revision priorities derived from observed signals.
- /start, /help, /id, /exam, /profile, /reset, and /delete-my-data.

### Reliability

- Queue-backed asynchronous processing.
- Durable per-chat job state and duplicate protection.
- Lease-aware job ownership and stale-job recovery.
- Queue retry and dead-letter handling.
- Structured answer validation and controlled retry.
- Telegram typing lifecycle management.
- Terminal failure handling.
- Student-profile failures isolated from the primary answer-delivery path.

### Usage and access

- Default daily limit: 20 accepted AI questions per India calendar day.
- Default burst guard: 5 accepted questions per 10 seconds.
- Unlimited access bypasses the daily limit only; burst protection remains active.
- Server-side Owner/Admin identities.
- D1-backed runtime unlimited test access.
- Server-side student suspension.

### Admin Control Center

The protected admin application provides:

- Live operational overview.
- Student directory and search.
- Student usage and estimated cost visibility.
- Grant/revoke unlimited access.
- Suspend/unsuspend controls.
- Profile reset.
- Audit logging.
- Activity monitoring.
- AI token and estimated-cost reporting.
- Learning analytics.
- System/configuration visibility.
- Telegram bot connection management.
- JSON report export.

## 3. Architecture

~~~text
Telegram private chat
        |
        v
Cloudflare Worker
        |
        +--> Durable Object
        |      +--> duplicate/job state
        |      +--> quota/rate metadata
        |      +--> recent conversation context
        |      +--> student profile
        |
        +--> Cloudflare Queue
        |       |
        |       v
        |   Queue consumer
        |       |
        |       +--> Vertex AI / Gemini
        |       +--> Telegram answer delivery
        |       +--> D1 usage accounting
        |
        +--> D1 analytics projection
                +--> users
                +--> questions
                +--> events
                +--> AI usage
                +--> access controls
                +--> audit log
                +--> Telegram bot connections

Protected /admin
        |
        v
Authenticated admin application
~~~

The Durable Object + Queue path is the primary operational question-processing state machine. D1 is the centralized analytics and administrative projection.

## 4. Repository map

| Path | Purpose |
|---|---|
| src/ | Production Worker and application code |
| src/ai/ | Vertex AI / Gemini integration |
| src/admin/ | Protected Admin Control Center |
| src/analytics/ | D1 analytics, usage, access and audit |
| src/core/ | Durable Object job store and shared logic |
| src/telegram/ | Telegram API and bot connection management |
| prompts/ | Prompt fixtures and controlled prompt documentation |
| reports/ | Offline founder/operations reporting |
| test/ | Regression and integration-oriented tests |
| docs/ | Engineering, operations, security, governance and release documentation |
| data/ | Placeholder/reference-data location; never a production data store |

See docs/README.md for the maintained documentation index.

## 5. Public/private boundary

### Repository material that may be published

Only source, tests, fixtures, schemas, templates, and documentation that Parmar AI has intentionally placed in this public repository.

### Never commit

- Telegram bot tokens.
- Telegram webhook/setup secrets.
- Google service-account private keys.
- Cloudflare API tokens or private credentials.
- Admin passwords.
- Session-signing secrets.
- Production D1 exports.
- Real student conversations.
- Production logs containing private student content.
- Private billing credentials.
- Local secret files such as .dev.vars.

Public configuration files use placeholders where deployment-specific secrets or identifiers are required.

## 6. Security posture

The application uses multiple security boundaries:

- Telegram webhook secret validation.
- Independent setup authentication.
- Signed admin sessions.
- Same-origin validation for admin mutations.
- Server-side access checks.
- Protected Owner/Admin identities.
- Encryption for dashboard-managed Telegram bot secrets.
- D1 retention cleanup.
- Private-chat-only student processing.
- Operational logging that avoids secret material.

Read SECURITY.md and docs/SECURITY_MODEL.md before changing authentication, access control, secrets, or data handling.

## 7. Privacy and data handling

Parmar AI processes information required to operate the product, including Telegram identity metadata, submitted questions, operational state, study-profile signals, AI usage metadata, and administrator audit data.

The current bot provides /delete-my-data for explicit user-directed deletion of stored student data.

Read PRIVACY.md for the repository-level data handling notice. Third-party provider handling remains subject to the relevant provider configuration and terms.

## 8. Deployment

Production deployment is designed around Cloudflare and the repository-connected deployment workflow.

Read, in order:

1. DEPLOY_DASHBOARD.md
2. PRODUCTION_CHECKLIST.md
3. docs/OPERATIONS_RUNBOOK.md
4. docs/TEST_PLAN.md

No real secret values belong in this repository.

## 9. Owner and admin model

- The Owner is defined by BOT_OWNER_TELEGRAM_USER_ID.
- Additional Telegram admins are listed in ADMIN_TELEGRAM_USER_IDS.
- Owner/Admin identities receive unlimited daily AI access.
- Owner/Admin targets are protected from ordinary student-level suspension and revocation controls.
- The web dashboard uses a separate authenticated administrator session.

## 10. Testing and release discipline

A release is production-ready only when the relevant automated checks and manual production scenarios pass against the exact source artifact being deployed.

See docs/TEST_PLAN.md, docs/RELEASE_PROCESS.md, CHANGELOG.md, and RELEASE_NOTES.md.

## 11. Contributions

This is not an unrestricted open-source contribution project.

Public visibility does not constitute permission to create, publish, distribute, commercialize, or repurpose derivative works. Do not submit code, prompt reproductions, datasets, screenshots, or production artifacts unless Parmar AI has expressly invited the contribution.

See CONTRIBUTING.md.

## 12. Trademarks and promotion

Parmar AI product names, logos, screenshots, visual identity, and distinctive branding are not licensed for third-party advertising, promotion, endorsement, or confusingly similar products.

See TRADEMARKS.md.

## 13. Licensing

This repository is governed by the Parmar AI Proprietary Source-Available License.

No open-source rights are granted. No patent license is granted. No trademark license is granted. No permission is granted to use the source as the basis for a competing service, product, commercial offering, advertisement, endorsement, promotional material, training corpus, or public redistribution.

Because this repository is public, GitHub's platform terms still control the ability of GitHub users to view and fork public repositories. GitHub states that public repositories may be viewed and forked on the service, while a license controls additional rights. citeturn856428search0turn856428search1

If absolute access restriction is required, the repository must be private. A license cannot technically stop a person who already has access to public source from making a physical copy. citeturn856428search0turn856428search5

## 14. Status

Shipped functionality is tracked in PROJECT_STATUS.md. Planned concepts such as Battle Arena, squad matchmaking, live voice rooms, social graph, Sprint Coins, payments, marketplace features, and similar future ideas are not production features unless explicitly released.

## 15. Legal note

This documentation and the custom license are project materials, not legal advice. The project owner should obtain jurisdiction-specific legal review before relying on them as an enforceable commercial agreement.

---

**Parmar AI — Proprietary Software. All rights reserved.**
