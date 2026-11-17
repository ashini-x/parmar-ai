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
- Owner-authored conversation titles and message text in the private BRɅIN Intelligence workspace.
- Security, access-control, and administrator audit records.

## Purposes
Data is processed to answer questions, maintain private-chat continuity, enforce limits, personalize study guidance, operate the admin dashboard and Owner workspace, account for AI usage, and protect the service. When a student sends photos, the Worker retrieves them from Telegram and forwards them to Google Cloud / Vertex AI for analysis.

## Retention
Central D1 analytics uses the configured raw-retention period; the production baseline is 30 days for raw analytics content. Durable Object study-profile state has separate lifecycle semantics and is retained for personalization until reset or deletion under the application implementation. Image bytes are held in memory only while downloaded and sent for analysis; the application does not persist the image bytes. Telegram file identifiers are kept in Durable Object retry state until processing completes or the 48-hour job-retention cleanup runs. Album staging is also removed by that cleanup.

## Knowledge-book retention
For administrator-managed PDF books, the original PDF is held in private Google Cloud Storage under a per-book source prefix. Google Vision's intermediate JSON output is stored separately under a temporary prefix and is automatically removed after indexing and page-grounded retrieval verification pass. The persistent page text and search index remain available for project queries. A prefix-scoped 30-day lifecycle rule provides a safety net for temporary OCR objects; source PDFs are not in that lifecycle prefix. Administrators can request a full per-book deletion separately. Cloud Storage soft-delete, retention, or provider backups may delay irreversible erasure.

## Owner Intelligence workspace
M2 stores Owner-authored conversation messages and titles in separate D1 tables, scoped to the configured web Owner principal. These records are not student Telegram questions, profiles or quiz history. The current M2 workspace saves user-authored messages only; it does not yet send them to Gemini or generate assistant replies. Owner conversations remain stored until the Owner deletes each conversation in the workspace; no automatic retention cleanup or bulk-delete control is available yet. The student data-deletion command does not delete Owner conversations.

## Deletion
The product provides a student data-deletion command. Deletion applies to records controlled by the application and reachable Durable Object state. It does not guarantee deletion from Telegram, Cloudflare, Google Cloud, backups, legal records, or other provider-controlled systems. Owner conversation deletion is a separate workspace action and removes the selected conversation and its messages from the Owner chat tables.

## Third parties
The application uses Telegram, Cloudflare, and Google Cloud / Vertex AI. Their own privacy policies and terms apply to their processing.

Do not submit highly sensitive personal information unless necessary for the intended study interaction.