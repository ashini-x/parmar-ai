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

### Retention

Raw D1 analytics are removed according to ANALYTICS_RAW_RETENTION_DAYS, which is 90 days by default.

Durable Object job and profile state has separate lifecycle controls implemented in application code.

### Export control

Admin exports are confidential operational artifacts.

Do not publish exports containing identifiable student information, private questions, or sensitive operational data.

### Deletion

The /delete-my-data workflow is the product-level deletion path for centralized student data and associated Durable Object study state.

Any new persistent store must define its deletion behavior before release.

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
