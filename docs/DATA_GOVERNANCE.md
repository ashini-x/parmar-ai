# Data Governance

## Scope

This document defines the principles for introducing, storing, retaining, exporting, and deleting Parmar AI application data.

## Principles

### Purpose limitation

Collect only data necessary for a documented student, reliability, analytics, or administrative workflow.

### Identity discipline

Telegram numeric user IDs are the canonical student identity.

Usernames, display names, and other mutable Telegram metadata are presentation attributes, not primary identity keys.

### Storage separation

- Durable Object state stores per-chat operational state and study context.
- D1 stores the centralized analytics and administrative projection.
- Queue messages are operational transport, not the long-term analytics system of record.
- Temporary photo file IDs are held in Durable Object state for retry; raw image bytes are processed in memory and are not stored by the application.

### Retention

Raw D1 analytics are removed according to ANALYTICS_RAW_RETENTION_DAYS, which is 30 days by default.

Durable Object job and profile state has separate lifecycle controls implemented in application code.

### Export control

Admin exports are confidential operational artifacts.

Do not publish exports containing identifiable student information, private questions, or sensitive operational data.

### Deletion

The /delete-my-data workflow is the product-level deletion path for centralized student data and associated Durable Object study state.

Any new persistent store must define its deletion behavior before release. Native quiz sessions are deleted by /delete-my-data and follow the same configured raw-data retention lifecycle. Photo album staging and retry file IDs live in the student's Durable Object, so `/delete-my-data` clears them with the rest of that object's state; completed jobs clear their photo IDs and abandoned job state follows the 48-hour cleanup.

### Owner Intelligence workspace

M4 stores Owner conversations and both user/assistant message text in the dedicated `owner_intelligence_conversations` and `owner_intelligence_messages` D1 tables. Each row carries an `owner_id` derived from the configured web Owner username; every query path filters on that value. Response model, thinking level, returned token counts and elapsed time are stored separately in `owner_intelligence_generation_metadata`, also scoped by `owner_id`. Owner chat records and generation metadata are not student questions, profiles, quizzes, student AI usage, Durable Object state or BRɅIN retrieval content. The student `/delete-my-data` workflow does not operate on Owner conversations.

The Owner can delete a conversation from the workspace; that action deletes its associated messages, and generation metadata is tied to assistant message deletion. There is no automatic retention cleanup, bulk-delete facility or Owner-account deletion endpoint. Until a separate retention control is implemented, conversations remain stored until the Owner deletes them individually. A stopped or disconnected stream may leave a saved partial assistant answer; the UI marks its status and does not silently treat it as a completed response. Each conversation also has an Owner-scoped 200,000-token lifetime budget, stored in `owner_intelligence_session_usage`, plus an in-flight reservation ledger in `owner_intelligence_token_reservations`. The server counts the exact next prompt with Vertex CountTokens, reserves prompt plus allowed output before saving the turn, and settles against Vertex `usageMetadata.totalTokenCount`. If a generation ends without final usage metadata, its reserved amount is charged conservatively. Editing or regenerating does not refund tokens already consumed. Existing chats are initialized from recorded assistant total-token metadata; historical usage with no recorded metadata is not inferable. Starting a new chat creates an independent fresh budget. Deleting a conversation also deletes its budget and reservation rows through foreign-key cascade.

### Imported knowledge books

Imported BRVIN PDF books keep durable knowledge separate from temporary OCR processing output:

- **Source PDF:** Stored under `brvin/source-pdfs/<book-id>/`. It remains available after ingestion for download, audit, and future reprocessing.
- **Temporary Vision output:** Google Vision JSON responses are written under `brvin/temporary-vision-ocr/<book-id>/`. After all pages are indexed and page-grounded retrieval QA passes, a separate background workflow deletes only that book’s temporary OCR prefix.
- **Persistent knowledge:** Extracted page text is uploaded into the book-specific Cloudflare AI Search items and index. Project queries use these persistent indexed pages; they do not read the temporary Vision JSON files.
- **Safety-net expiry:** The Worker adds a Google Cloud Storage lifecycle Delete rule scoped only to `brvin/temporary-vision-ocr/`, with a 30-day age condition. Existing unrelated rules are preserved. Before adding the rule, the Worker rejects any existing broad Delete rule that could include the source-PDF tree. If the service account lacks bucket-update permission, the immediate post-READY cleanup still runs, while the lifecycle-rule configuration is reported as deferred.
- **Legacy imports:** Existing books that used `brvin/imports/<book-id>/ocr/` remain readable during processing. The scheduled retention supervisor finds READY legacy books and removes only their old `ocr/` subfolder; it does not remove the sibling `source.pdf`.
- **Archive / restore:** Archive changes only the book status and disables retrieval. The original PDF, indexed page text, search index, and project grants remain. Restore returns a fully indexed archived book to `ready`.
- **Delete book:** The explicit per-book purge removes that book’s source PDF, temporary Vision output, AI Search page items, project grants, and book/import registry rows. Shared namespaces, other books, projects, collections, and operational audit events are preserved.

Cloud Storage lifecycle actions run asynchronously, and soft-delete or retention policies may keep deleted object generations recoverable for a period. The direct post-READY workflow performs the primary cleanup; the lifecycle rule is a bounded safety net, not the retrieval data store.

### Access control

Access to centralized student data should be limited to authenticated administrators and production services that require the data to perform their functions.

### Incident response

A suspected data incident requires:

1. containment;
2. credential rotation when relevant;
3. preservation of operational identifiers;
4. assessment of affected data;
5. remediation and deployment;
6. private post-incident review.

## Change requirement

Material changes to stored data must update:

- PRIVACY.md
- this document
- docs/DATA_MODEL.md
- relevant tests
- release notes


### Owner GitHub project-memory lifecycle (M4.3)

The full Owner transcript remains in the Owner-scoped conversation/message tables in D1. A Save preview reads bounded, source-linked transcript excerpts and existing Markdown; Gemini proposes editable Markdown, but nothing is written to GitHub until the Owner confirms. The draft is charged to the same 200K D1 usage/reservation ledger as normal chat generation. Existing transcript rows and generation metadata are not rewritten by Save. The D1 preview record is an expiring, Owner-scoped operation record (30 minutes) containing the destination, base commit SHA, proposed files, state and verified commit SHA. It does not replace D1 as the canonical transcript store.

The dedicated GitHub App stores only an encrypted private-key/client-secret bundle in D1. One-time state is hashed. Temporary GitHub user tokens and short-lived installation tokens are not stored. GitHub receives only the explicit five-file Markdown commit that the Owner reviewed and confirmed. Common credential patterns are redacted best-effort before model input and file persistence, but this does not replace Owner review. Only a verified commit and file read-back can set Synced or promote a Scratchpad. Conflict and interrupted states remain durable for safe recovery; external branch edits are not force-overwritten. No automatic Scratchpad expiry or automatic chat-turn GitHub sync is introduced.

### Owner Memory Hub and AI collaboration governance (approved target; not implemented)

The planned `owner-memory-hub` is a private curated memory/collaboration repository, not an application source repository. Keep application code in its original independent GitHub repositories. The hub may contain repository/path/commit references, curated notes and Owner-approved collaboration artifacts; it must not contain copied source trees, secrets, access tokens, private keys, service-account credentials, raw audio or an automatic full dump of private chat transcripts.

The Owner is the final authority. Gemini drafts architecture proposals and project memory; ChatGPT's separately authorized Software Engineer workflow implements only Owner-approved briefs and records actual PR/test/deployment evidence. Neither model may self-approve decisions. Private AI conversations are not automatically shared; the Owner explicitly selects what is published to GitHub.

Treat every imported proposal, review, Markdown file and implementation report as untrusted data. Preserve provenance, schema validation, manifest allowlists, exact commit snapshots and project/workstream/feature scoping. Cross-project retrieval is explicit. D1 remains the canonical complete Owner transcript and accounting store; curated hub files do not replace it.

The BRɅIN Owner Memory App is to be installed only on the hub repository with selected-repository access. ChatGPT's GitHub/deployment authorization is separate and is not available to Cloudflare Workers. Retain the existing strict conflict protection until path-aware multi-writer concurrency is implemented and tested. No collaboration document is an accepted decision until the Owner confirms it.
