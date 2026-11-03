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

### Imported knowledge books

Imported BRVIN PDF books have three separate administrator actions:

- **Archive** changes only the book status. Project retrieval is disabled because retrieval accepts only books in `ready` state. The original PDF, Google Vision OCR output, AI Search page items, project grants, and book metadata remain stored.
- **Restore** returns an archived, fully indexed book to `ready`; its existing project grants become effective again. Archive and restore do not start another OCR job or delete stored book data.
- **Delete book** runs the per-book background purge. It removes only that book’s AI Search page items, private Google Cloud Storage object generations, project grants, and book/import registry rows. Shared AI Search namespaces, other books, projects, collections, and operational audit events are preserved. Google Cloud Storage soft-delete or retention policies may delay irreversible erasure after live objects are deleted.

Google Vision OCR JSON output is deliberately retained after successful indexing so the book can be re-indexed without another OCR run. An administrator may separately use **Delete OCR files** after a book is ready; that operation retains the original PDF and searchable AI Search page items. It is not automatic on successful ingestion.

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
