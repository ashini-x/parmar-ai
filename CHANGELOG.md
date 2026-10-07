## 2.6.0 - Production Reliability & Access Control Hardening

- Lease-fenced Durable Object jobs and stale-job recovery.
- Correct processing/typing lifecycle and retry classification.
- End-to-end dashboard unlimited-access verification.
- Broader current-fact grounding detection and truthful grounding analytics.
- Secure Telegram setup authentication and reduced public health disclosure.
- Added explicit user data deletion.

# Changelog

## 2.5.2 - Admin Access Controls UI Fix
- Fix owner/admin effective access display in the Students directory.
- Fix Grant unlimited and Suspend action handlers so their action names are correctly quoted.
- Surface admin API action failures instead of silently ignoring them.

## 2.5.1 - Admin UI Interaction Fix

- Fixed a browser JavaScript syntax error that prevented admin-dashboard click handlers from loading.
- Restored navigation tabs, refresh/sign-out, student actions, access controls and report export interactions.
- No runtime student behavior or backend quota/accounting semantics changed.

## 2.5.0 - Admin Control Center + AI Economics

- Expanded the protected admin page into a non-technical owner control center.
- Added live overview metrics, alerts, quota distribution, active-user ranking and retention snapshots.
- Added Gemini usage ledger with prompt/output/reasoning/tool-use/cached/total token metadata.
- Added per-attempt estimated AI cost accounting with duplicate-safe persistence.
- Added spend views by thinking level, grounding and model/policy.
- Added configurable daily AI budget threshold and simple run-rate projection.
- Added searchable student analytics, usage/cost detail, learning signals and administrative actions.
- Added suspension controls with protection for configured owner/admin accounts.
- Added administrator audit logging.
- Added seven-day AI trend and expensive-request views.
- Added JSON export plus offline PDF/CSV/PNG founder reporting through Python/Matplotlib.
- Added repository CI/issue/PR support for the expanded production surface.
- Preserved the stable v2.4.2 student path, daily quota, burst safeguard and privileged test access.

## 2.4.2 - Privileged Access Controls

- Add bot-owner/admin identity configuration.
- Add D1-backed unlimited-AI overrides.
- Add owner/admin Telegram commands.
- Preserve 20/day for ordinary users and 5/10-second burst protection for everyone.

## 2.4.1 - Stable Production Release

- Separate burst and daily quota messages/events.
- Rebuilt v2.4 personalization architecture.
- Profile-learning failures isolated from answer delivery.

## 2.4.0 - Evidence-Based Personalization

- Add learning signals and safe migration.
- Require explicit/repeated evidence for attention areas.

## 2.3.0 - Conversation Intelligence & Answer Reliability

- Add recent conversation context.
- Improve follow-ups and confusion handling.
- Retry malformed/incomplete structured model responses.

## 2.2.1 - Admin/D1 Stabilization

- Fix and stabilize D1 initialization.

## 2.2.0 - Central Admin Analytics

- Add D1 analytics and protected admin dashboard.
