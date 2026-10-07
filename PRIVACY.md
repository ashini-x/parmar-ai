# Privacy & Data Handling Notice

**Status: Repository-level operational notice**  
**Last reviewed: 2026-10-07**

This document describes the data-handling behavior represented by the current Parmar AI source tree. It is not a substitute for a jurisdiction-specific consumer privacy policy, data-processing agreement, or legal advice.

## 1. Data categories

Depending on the feature used, Parmar AI may process:

- Telegram numeric user ID and private-chat ID
- Telegram username, first name, and last name when supplied
- questions submitted to the bot
- interaction and operational events
- recent conversation context
- SSC target-exam information
- study-profile and revision signals
- AI token-usage metadata
- estimated AI-cost metadata
- administrator access-control records
- administrator audit records
- Telegram bot connection metadata for dashboard-managed bots

## 2. Purposes

Data is processed to:

- answer student questions
- maintain conversation continuity
- personalize study and revision guidance
- enforce daily and burst limits
- detect operational failures
- account for AI usage and estimated cost
- provide protected administrator visibility
- manage access controls and Telegram bot connections
- support security and incident investigation

## 3. Deletion

The bot currently provides /delete-my-data.

When successful, the workflow deletes the student's centralized analytics/history, runtime access override, administrative-control record, user record, and associated Durable Object study state.

Deletion from Parmar AI does not guarantee deletion from third-party provider systems. Provider-specific retention remains governed by applicable provider terms, configuration, and law.

## 4. Retention

The default raw D1 analytics retention is 90 days, controlled by ANALYTICS_RAW_RETENTION_DAYS.

Durable Object records have separate lifecycle controls in application code and should not be assumed to follow the D1 period.

## 5. Third-party processing

Student questions may be sent to Google Vertex AI / Gemini to generate answers.

Telegram, Cloudflare, Google Cloud, and other deployment providers may process data according to their respective service configurations and contractual terms.

## 6. Security

Credentials belong in provider secret stores and must never be committed to GitHub.

Real student exports, raw production logs, and private incident evidence must not be published.

## 7. Data minimization

New persistent data collection should have a documented product or operational purpose and an explicit deletion/retention decision before release.

## 8. Privacy requests

Questions about student data, deletion, or privacy incidents should use the private support/security channel maintained by the project owner.

Do not post private student information in public GitHub issues.
