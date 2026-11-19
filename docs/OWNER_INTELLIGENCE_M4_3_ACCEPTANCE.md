# Owner Gemini Intelligence — M4.3 live acceptance record

**Last updated:** 2026-11-19 IST  
**Repository:** `ashini-x/parmar-ai`  
**Owner Memory Hub:** `ashini-x/owner-memory-hub` (private), default branch `main`  
**Status:** Live Save/read-back and append-only Owner-content preservation subtest passed. Final M4.3 closeout requires read-only reconciliation of topic promotion and usage-ledger evidence.

## Summary

M4.3's dedicated Owner GitHub App and Save-to-GitHub implementation are merged and deployed. The Preview timeout/reliability fix and append-only preservation fix are also merged and deployed. On 2026-11-19 the Owner confirmed a live production workflow in which an external comment in `progress.md` survived a fresh Gemini Preview, explicit Save from the Owner panel to `main`, and GitHub read-back. Newly generated progress content appeared immediately after the manually authored comment.

This is a real Owner/browser acceptance result, not merely a unit-test assertion. It closes the live external-edit preservation / fresh-preview / explicit-save / commit-read-back subtest.

## Acceptance ledger

| Area | Evidence | Result |
|---|---|---|
| Dedicated GitHub App / selected-only installation | Earlier authenticated production screenshot showed `Connected · 1 verified installation(s)`, account `ashini-x · User`, repository `ashini-x/owner-memory-hub · Private`; exact permissions are Metadata read + Contents write. | **Passed — Owner screenshot previously recorded** |
| Topic endpoint | PR #352 corrected list/create/rename to `/admin/api/intelligence/topics`; production workflow 44411119143 passed. | **Passed — deployed** |
| Stale preview after external edit | Earlier preview `46116e56-1890-4cf5-91b9-9a145b3c0510` recorded as `conflict` after external commit `f41938e6b335162e3ef78bc76a259c27e128a0c6`. | **Passed — conflict state recorded** |
| Fresh preview incorporates external Owner edit | Fresh preview `1a5f45c6-4b01-4f98-9758-bd87a8eec59b`, base SHA `f41938e6b335162e3ef78bc76a259c27e128a0c6`, included the exact marker in its persisted preview files. | **Passed — preview evidence recorded** |
| Explicit Save and GitHub read-back | Owner confirmed Save from the Owner panel to `main`, then fetched/opened `projects/owner-intelligence/memory/progress.md`; newly generated content was visible below the manually authored comment. | **Passed — Owner-confirmed 2026-11-19** |
| Append-only preservation | Exact comment marker and Owner-authored content survived; generated content was added below it. PR #356 added byte-preserving, idempotent append logic and regression coverage. | **Passed — live and automated** |
| Five-file commit verification | Runtime reads back every expected file at the exact commit SHA and compares bytes before marking Synced; Owner-visible save/read-back succeeded. | **Implementation verified; no separate manual inspection of every file is claimed here** |
| Topic association / Scratchpad promotion | Runtime promotes the conversation only after successful byte-exact read-back. This documentation update did not independently query live D1 topic/conversation rows. | **Read-only evidence reconciliation required** |
| Memory-draft usage settlement | Draft uses same conversation's M4.1 CountTokens/reservation ledger. Exact production D1 usage row was not independently queried in this documentation update. | **Read-only evidence reconciliation required** |

## Exact Owner-authored marker

```html
<!-- M4.3 stale-preview test marker: external GitHub edit made after Owner preview on 2026-11-19. -->
```

GitHub's rendered Markdown may hide HTML comments. Use Raw/source view when checking a marker, but do not rerun Save merely because the rendered view hides comments.

## M4.3 engineering fixes

### PR #355 — Vertex memory-draft reliability

- Merge commit: `64c8559ce92413ea46dfa96f77133e0786da001d`.
- Memory-draft GenerateContent timeout increased from 35 to 90 seconds; browser preview deadline increased to six minutes.
- Revalidates only the selected Gemini model instead of probing the full catalogue before the draft.
- Retries only explicit HTTP 429 RESOURCE_EXHAUSTED capacity responses, at most three attempts, with bounded exponential backoff/jitter.
- Does not replay ambiguous HTTP 408/5xx/timeouts/lost connections.
- Releases unused token reservation after definitive provider rejection (400/401/403/404/429); ambiguous failures remain conservatively accounted.
- Does not change selected model, thinking level, provider, Google Cloud quota, billing, IAM or location.

### PR #356 — append-only Markdown preservation

- Merge commit: `3ae456188fb7535db47bcab2a7909cf333b59285`.
- Gemini returns additive update fragments for project memory, progress and decisions rather than whole-file replacements.
- `appendOwnerMemorySection(existing, marker, heading, body)` preserves existing bytes and appends under a unique preview-scoped HTML-comment marker. Reapplying an existing marker is idempotent; empty generated body adds nothing.
- Conversation checkpoints are append-only, preserving later Owner edits inside prior generated sections.
- Regression tests seed Owner-authored progress and an external comment marker, verify them in a new preview, save Owner edits, and prove edits survive the commit and subsequent preview.

## Validation and deployment evidence

- PR #356 CI: [run 44455732385](https://github.com/ashini-x/parmar-ai/actions/runs/44455732385) passed `npm run check`, **513 Vitest tests across 75 files**, **62 Node tests across 9 files**, and dry-run builds for `brvin-service`, `parmar-ai` and isolated BRɅIN website Worker.
- PR #356 merged at `3ae456188fb7535db47bcab2a7909cf333b59285`.
- Cloudflare reports `parmar-ai` version `74fade9d-422e-4a91-8be4-f98340b76eb4` (version 991; deployment `8368eb58-773b-49cc-8332-99372ae00e6a`) at 100% traffic.
- Cloudflare reports `brvin-service` version `1999a4c1-9137-447e-8dc7-596f70a338b9` (version 220; deployment `a1b126fb-bf07-4cc2-8827-025d05b955a4`) at 100% traffic.
- PR validation and production deployment activation are separate evidence. This record does not claim a post-#356 live smoke workflow unless a matching run is separately identified.

## Required closeout action

1. Re-read current `main` and Cloudflare deployment state.
2. Read topic attachment/saved commit metadata and corresponding D1 conversation/preview records with read-only queries only.
3. Confirm the saved conversation is associated with the intended topic and that Scratchpad promotion (if this save originated in Scratchpad) happened only after exact five-file read-back and Synced.
4. Inspect the same conversation's memory-draft usage record and reservation/settlement state. Do not change/top-up the budget.
5. If both conditions are confirmed, mark M4.3 fully accepted and proceed to M4.4. Otherwise test only the missing item; do not repeat the successful save.

## M4.4 — next approved feature milestone

M4.4 adds stable project/workstream/feature IDs, a versioned central hub catalog/manifest, immutable per-conversation repository/branch/commit snapshots, manifest-selected active Project Memory loading, explicit project-context visibility and strict cross-project isolation. It must not implement unbounded transcript replay, rollover, compaction, forks, background sync, semantic cache or path-aware multi-writer rebasing. M4.1's 200,000-token budget and M4.3 strict branch-head Conflict protection remain unchanged.
