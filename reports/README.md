# Offline Founder & Operations Reports

The reports/ directory contains **offline, non-production** utilities for turning approved Parmar AI admin JSON exports into local operational charts and summaries.

This tooling is outside the live Telegram request path and should never be given production credentials.

## What the reporting layer is for

Approved admin exports can be used for internal review of operational and learning signals such as:

- student/activity volume;
- question and usage trends;
- AI token/cost visibility;
- quiz and learning analytics exposed by the export schema;
- operational summaries for release or founder review.

The reporting layer is an analysis convenience, not the source of truth. The source of truth remains the deployed Cloudflare/D1/Durable Object application state.

## Usage

From the repository root:

~~~bash
pip install -r reports/requirements.txt
python reports/generate_report.py exported-report.json --output-dir report-output
~~~

The exact export filename and available report fields depend on the admin export schema at the time the report is generated.

## Data classification

Admin exports may contain sensitive or identifiable student information, including:

- Telegram identifiers;
- question text;
- timestamps;
- usage and estimated spend;
- learning analytics;
- quiz-related activity.

Treat every non-synthetic export as **confidential operational data**.

Do not publish, redistribute, upload to unrelated third-party services, or use exported student data as training/evaluation material unless the project's legal/privacy requirements and written authorization permit it.

## Safe reporting practice

- Work on a local copy with appropriate access controls.
- Prefer sanitized exports for experiments and screenshots.
- Delete temporary report output when no longer required.
- Never place raw production exports under data/, reports/, or any other tracked repository directory.
- Do not embed secrets in report input or output.

## Secrets

Reports must never contain or require:

- Telegram bot tokens;
- webhook/setup secrets;
- Google private keys;
- Cloudflare credentials;
- admin passwords/session secrets;
- billing credentials.

The reporting utility should operate only on the approved exported JSON data it is explicitly given.

## Repository status

This directory is **not** a live analytics subsystem and does not represent a shipped product dashboard feature. It is an offline founder/operations analysis aid.

The source is governed by the repository [LICENSE](../LICENSE), except where a third-party dependency is subject to its own license.