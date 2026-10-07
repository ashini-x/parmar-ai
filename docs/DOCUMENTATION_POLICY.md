# Documentation Policy

**Owner:** Parmar AI project maintainer  
**Status:** Controlled project documentation  
**Production line:** 2.6.x

## Purpose

Documentation is a production control surface. It should make deployed behavior understandable without publishing secrets, private user data, confidential vendor information, or false claims about unreleased features.

## Required review

Review documentation whenever a change affects:

- authentication or authorization
- Owner/Admin roles
- Telegram lifecycle
- Queue, Durable Object, or retry behavior
- D1 schema or retention
- AI provider behavior
- quotas or access controls
- privacy or deletion
- administrator workflows
- production configuration
- incident response
- release or rollback procedures

## Source of truth

Code is authoritative for implemented behavior.

Documentation must describe the code accurately and must not be used to claim behavior that is absent from the deployed release.

## Version discipline

Where applicable, keep the following aligned:

- package.json
- wrangler.jsonc
- CHANGELOG.md
- RELEASE_NOTES.md
- PROJECT_STATUS.md
- affected operations/security/privacy documents

## Sensitive information

Never publish:

- secrets
- production exports
- raw private logs
- real student conversations
- private incident evidence
- credentials
- confidential vendor information

## Review standard

Before release, confirm that documentation:

1. matches actual behavior;
2. marks unsupported features clearly;
3. uses placeholders in examples;
4. does not expose sensitive information;
5. preserves relevant version history;
6. distinguishes estimates from provider billing truth.

## Controlled publication

Public repository visibility is not permission to republish the documentation elsewhere. Repository licensing governs permitted use.
