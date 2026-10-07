# Privacy and Data Handling Notice

**Status:** Technical product notice; obtain jurisdiction-specific legal advice before using this as a formal privacy policy.

## Data the application may process
- Telegram user and private-chat IDs.\n- Telegram username and name fields when provided.\n- Questions and timestamps.\n- Question status/topic/subject/mode and related metadata.\n- AI token-usage metadata and estimated cost fields.\n- Study-profile data such as recent topics, attention areas, revision queue, and target exam.\n- Security, access-control, and administrator audit records.

## Purposes
Data is processed to answer questions, maintain private-chat continuity, enforce limits, personalize study guidance, operate the admin dashboard, account for AI usage, and protect the service.

## Retention
Central D1 analytics uses the configured raw-retention period; the production baseline is 90 days. Durable Object study-profile state has separate lifecycle semantics and is retained for personalization until reset or deletion under the application implementation.

## Deletion
The product provides a student data-deletion command. Deletion applies to records controlled by the application and reachable Durable Object state. It does not guarantee deletion from Telegram, Cloudflare, Google Cloud, backups, legal records, or other provider-controlled systems.

## Third parties
The application uses Telegram, Cloudflare, and Google Cloud / Vertex AI. Their own privacy policies and terms apply to their processing.

Do not submit highly sensitive personal information unless necessary for the intended study interaction.