# Privacy and Data Handling Notice

**Status:** Technical product notice; obtain jurisdiction-specific legal advice before using this as a formal privacy policy.

## Data the application may process
- Telegram user and private-chat IDs.
- Telegram username and name fields when provided.
- Questions and timestamps, including captions and photos sent for study help.
- Telegram photo file identifiers used temporarily to retrieve an image for processing.
- Question status/topic/subject/mode and related metadata.
- AI token-usage metadata and estimated cost fields.
- Study-profile data such as recent topics, attention areas, revision queue, and target exam.
- Security, access-control, and administrator audit records.

## Purposes
Data is processed to answer questions, maintain private-chat continuity, enforce limits, personalize study guidance, operate the admin dashboard, account for AI usage, and protect the service. When a student sends photos, the Worker retrieves them from Telegram and forwards them to Google Cloud / Vertex AI for analysis.

## Retention
Central D1 analytics uses the configured raw-retention period; the production baseline is 30 days for raw analytics content. Durable Object study-profile state has separate lifecycle semantics and is retained for personalization until reset or deletion under the application implementation. Image bytes are held in memory only while downloaded and sent for analysis; the application does not persist the image bytes. Telegram file identifiers are kept in Durable Object retry state until processing completes or the 48-hour job-retention cleanup runs. Album staging is also removed by that cleanup.

## Deletion
The product provides a student data-deletion command. Deletion applies to records controlled by the application and reachable Durable Object state. It does not guarantee deletion from Telegram, Cloudflare, Google Cloud, backups, legal records, or other provider-controlled systems.

## Third parties
The application uses Telegram, Cloudflare, and Google Cloud / Vertex AI. Their own privacy policies and terms apply to their processing.

Do not submit highly sensitive personal information unless necessary for the intended study interaction.