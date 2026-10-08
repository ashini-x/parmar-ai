# Data Directory

**Classification: Placeholder / non-production**

The data/ directory exists to make Parmar AI's repository data boundary explicit. It is **not** a production datastore and must never be treated as a backup or export location.

## Where production data lives

Production data is held in the configured Cloudflare runtime services.

- **Durable Objects** hold per-private-chat operational state, including short conversation context, profile state, job/admission state, and stored quiz-result context.
- **D1** holds the centralized analytics/admin projection, including users, questions/events, access and audit data, AI usage accounting, and native Telegram quiz-session records.
- **Telegram** remains the external messaging surface; Telegram update data must be handled according to the project's privacy and retention rules.

GitHub is source control, not the production data layer.

## Never commit

Do not place any of the following in this directory:

- production D1 exports or database backups;
- Telegram user exports;
- raw student conversations or private message dumps;
- identifiable student datasets;
- Telegram bot tokens or webhook/setup secrets;
- Google credentials or private keys;
- Cloudflare credentials;
- admin/session secrets;
- private billing information;
- confidential evaluation or benchmark datasets;
- copyrighted source material that Parmar AI is not authorized to redistribute;
- generated reports containing identifiable student information.

A file can be blocked from Git accidentally; the correct rule is simply **do not put production/private data here in the first place**.

## Allowed content

Only commit:

- synthetic fixtures;
- sanitized examples;
- public-domain material;
- test data that contains no real student identity;
- datasets or artifacts for which the project owner has explicit redistribution rights.

When a fixture is derived from production behavior, scrub identifying information and document its authorization and purpose.

## Quiz and learning data

Native Telegram MCQ outcomes are operational product data. Quiz questions, options, correct answers, explanations, selected answers, and result states are correlated with a Telegram student/session and can feed future product analytics.

They must therefore be handled as confidential runtime data, not as harmless test fixtures.

The current product stores quiz-session state in D1 and also records a bounded result context in Durable Object conversation state so later questions such as “why?” can refer back to the answered quiz.

## Retention and deletion

Do not invent a local retention policy by keeping exports indefinitely.

Runtime retention and deletion are governed by the deployed application, including its configured analytics retention and user-data deletion behavior. The current production baseline uses a **30-day raw analytics retention default** when no override is configured.

User deletion operations cover the centralized records and per-chat study state required by application semantics, including quiz-session data.

See:

- [../PRIVACY.md](../PRIVACY.md)
- [../SECURITY.md](../SECURITY.md)
- [../docs/DATA_GOVERNANCE.md](../docs/DATA_GOVERNANCE.md)
- [../docs/DATA_MODEL.md](../docs/DATA_MODEL.md)
- [../docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md)

## Governance rule

If data is not clearly synthetic, sanitized, public, or explicitly authorized for repository publication, **do not commit it**.

This directory is a controlled source-code fixture area, not a production data store.