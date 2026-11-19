# Owner Gemini Intelligence — M4.3 live acceptance record

**Last updated:** 2026-11-19 IST  
**Repository:** `ashini-x/parmar-ai`  
**Owner Memory Hub:** `ashini-x/owner-memory-hub` (private), default branch `main`  
**Status:** **M4.3 fully accepted and closed on 2026-11-19 IST.** Live Owner Save/read-back, stale-preview conflict protection, exact five-file GitHub verification, topic attachment and same-chat usage-ledger reconciliation are complete.

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
| Five-file commit verification | The final Synced preview and its five expected paths were compared against GitHub at the exact saved commit and again at current `main`; every file matched byte-for-byte. | **Passed — independent read-only check** |
| Topic association / Scratchpad promotion | D1 confirms the tested conversation was already `session_kind=topic`, attached to the `Owner Intelligence` topic. Its latest preview is Synced only after verification. Scratchpad promotion is **not applicable to this conversation** because it did not originate as a Scratchpad. | **Passed — topic attachment verified; conditional promotion N/A** |
| Memory-draft usage settlement | The same conversation has nine reservation rows, all `settled`; sum of actual tokens is 40,496, matching the D1 session meter. Reserved tokens are zero; the limit remains 200,000. | **Passed — production D1 reconciliation** |

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

## Final M4.3 closeout reconciliation — completed 2026-11-19 IST

All final checks below were read-only against the production D1 database and GitHub. No D1 rows, GitHub refs, App permissions, Worker bindings, secrets, models, billing settings or Google Cloud settings were changed.

### Topic, installation and conversation association

- Production topic: `Owner Intelligence` (`a3a58a83-90a0-4c23-a9a4-46eaf2ae6709`).
- Topic attachment: private `ashini-x/owner-memory-hub` (repository ID `1463342529`), branch `main`, memory root `projects/owner-intelligence/memory`, installation `183469022`, manifest revision `owner-memory-v1`.
- The installation is still `active` and `repository_selection=selected` for account/user `ashini-x`. The previously recorded Owner screenshot confirms the exact requested App permissions: Metadata read + Contents write.
- Tested conversation: `43bca53d-baa1-4a49-a447-947f3fb8e243`; D1 records `session_kind=topic` and the same `topic_id`. This journey did **not** start as a Scratchpad, so Scratchpad promotion was not applicable. The implementation's Scratchpad promotion remains conditional on the same successful byte-exact verification and Synced result.

### Conflict, Save and five-file verification

- Stale preview `46116e56-1890-4cf5-91b9-9a145b3c0510` is recorded as `conflict` after external edit commit `f41938e6b335162e3ef78bc76a259c27e128a0c6`.
- Fresh preview `1a5f45c6-4b01-4f98-9758-bd87a8eec59b` used that external commit as its base and contained the manually authored marker.
- The Owner explicitly confirmed Save in the Owner panel. Final Synced preview `86534fbd-05ce-43c3-ae8b-866758efbe62` records commit `b40e46c50ee4e7663f5d2c2dd6ad85725979b656` on `main`.
- The saved commit is the latest commit returned for the private hub's `main` branch at the time of inspection. All five expected files — `index.md`, `project-memory.md`, `progress.md`, `decisions.md` and `sessions/2026-11-19-43bca53d-86534fbd.md` — matched the preview's persisted contents byte-for-byte both at the saved SHA and at current `main`. The Owner-authored progress marker remains present and generated content is appended below it.
- Topic `current_commit_sha` matches `b40e46c50ee4e7663f5d2c2dd6ad85725979b656`.

### Same-chat usage settlement

- Conversation `43bca53d-baa1-4a49-a447-947f3fb8e243` session meter: **40,496 used / 200,000 limit / 0 reserved**.
- All **nine** reservation rows for that same conversation are `settled`; their `actual_tokens` sum to exactly **40,496**, matching `owner_intelligence_session_usage.used_tokens`.
- The latest memory-draft reservation in that sequence was settled with provider usage (`usage_is_estimated=0`) before the final Synced preview was recorded. No outstanding reservation or top-up is required.

### Production activation check

Cloudflare's latest deployment listings still show `parmar-ai` version `74fade9d-422e-4a91-8be4-f98340b76eb4` and `brvin-service` version `1999a4c1-9137-447e-8dc7-596f70a338b9` at 100% traffic. PR #356's CI evidence remains separate from production activation; no additional post-#356 smoke run is claimed.

**Closeout decision:** Every M4.3 acceptance gate applicable to this saved Topic conversation is now evidenced. M4.3 is **Complete / Accepted**. M4.4 is unblocked and is the next task. Do not repeat the successful live Save, do not reinstall the GitHub App, and do not weaken the strict branch-head Conflict guard.

## M4.4 — next approved feature milestone

M4.4 adds stable project/workstream/feature IDs, a versioned central hub catalog/manifest, immutable per-conversation repository/branch/commit snapshots, manifest-selected active Project Memory loading, explicit project-context visibility and strict cross-project isolation. It must not implement unbounded transcript replay, rollover, compaction, forks, background sync, semantic cache or path-aware multi-writer rebasing. M4.1's 200,000-token budget and M4.3 strict branch-head Conflict protection remain unchanged.
