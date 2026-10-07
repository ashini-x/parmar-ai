# Changelog

## 2.6.1 — Production Hardening
- Aligned release metadata and runtime fallback on v2.6.1.
- Made dedicated Telegram credential encryption mandatory for production writes, with controlled legacy-read compatibility during key migration.
- Reduced the public health endpoint to a minimal health response.
- Reduced the production raw analytics retention baseline from 90 days to 30 days.
- Hardened Durable Object internal payload handling and centralized lease-ownership validation.
- Added regression coverage for freshness classification, lease ownership, malformed AnswerPackets, retention defaults, encryption configuration, and public health behavior.

## 2.6.0 — Production Reliability & Access Control Hardening
- Fixed Student action-button event handling.
- Added D1 read-back verification for suspend/unsuspend.
- Hardened unlimited-access verification and audit handling.
- Fixed Access-tab Telegram ID validation.
- Fixed Telegram Test connection/Disconnect validation.
- Added proprietary licensing, AI/ML restrictions, brand policy, privacy notice, governance, support, and documentation-index files.
- Refreshed release, operations, and production test documentation.
- Lease-fenced Durable Object jobs and stale-job recovery.
- Correct processing/typing lifecycle and retry classification.
- End-to-end dashboard unlimited-access verification.
- Broader grounding detection and truthful analytics.
- Secure Telegram setup authentication.
- Explicit user data deletion.

Historical releases remain below this entry.