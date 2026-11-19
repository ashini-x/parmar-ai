# Owner Intelligence — M4.4 Project Memory Acceptance

**Status:** Implementation merged and production deployed; authenticated Owner attach-and-read walkthrough pending
**Date:** 2026-11-19 IST
**Parent roadmap:** [OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md](OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md)
**Continuation:** [OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md](OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md)

## 1. Delivered scope

Owner Memory Hub PR [#1](https://github.com/ashini-x/owner-memory-hub/pull/1) merged as `91e5c98cbc375b3c418207b6559021b16200e0b4`. Parmar AI Worker PR [#361](https://github.com/ashini-x/parmar-ai/pull/361) merged as `cd54375690b3e5d3ecc566f83be7711b48c58443`.

The hub contains version-1 hub, catalog, project, workstream and feature manifests. Owner Gemini Intelligence uses stable project ID `6d0bf6d4-59a2-4df2-9389-6d04100d8d84`. Source repositories remain separate and no source code is copied into the hub.

Only manifest-allowlisted active memory files are implicitly loaded: `project-memory.md`, `progress.md` and `decisions.md`. Session notes, archive, handoff/collaboration folders and unlisted files are excluded.

## 2. Runtime guarantees

- Each attachment stores an immutable Owner-scoped D1 snapshot containing the conversation, project/workstream/feature scope, exact hub repository/branch/commit, governing manifest provenance, file blob SHAs and Markdown bytes.
- A conversation uses the pinned snapshot; later hub branch-head changes do not silently change existing context.
- One primary scope is allowed by default. A secondary scope requires both the conversation-level cross-project switch and explicit per-snapshot Owner opt-in. Disabling cross-project mode deactivates secondary scopes but preserves the primary snapshot.
- Pinned memory enters the exact effective prompt before selected-model Vertex CountTokens and the existing M4.1 reservation. The 200,000-token cumulative conversation limit and canonical D1 transcript are unchanged.
- Markdown is untrusted reference data; it cannot override application instructions or Owner policy.

Out of scope: archive/session search, automatic branch refresh, rollover, compaction, forks, historical D1 recall, semantic caching, auto-sync and path-aware multi-writer rebasing.

## 3. CI and production release

- Validation workflow [44568064917](https://github.com/ashini-x/parmar-ai/actions/runs/44568064917) passed TypeScript, 521 Vitest tests across 76 files, 62 Node tests across 9 files and all three Worker dry-run builds.
- The same workflow deployed both Workers and passed root, BRVIN-backed health and release acceptance.
- M4.4 release versions: `parmar-ai` `fd932efb-9d97-4e8f-837f-79a460409495` (deployment `1f2b9b0e-8655-4158-b4a1-23b83ad89aba`); `brvin-service` `90b21e52-2a55-402e-8398-0c6e308d3a0e` (deployment `719cbe9a-435f-4080-ad8b-344ecf59320f`). Acceptance artifact [14552742089](https://github.com/ashini-x/parmar-ai/actions/runs/44568064917/artifacts/14552742089).
- Current main later added PR #365's separate response renderer; latest workflow [44571138999](https://github.com/ashini-x/parmar-ai/actions/runs/44571138999) passed. Current versions at 100% traffic: `parmar-ai` `fccd13e6-1be3-4ecb-b1e6-d42d352cd1f8` (deployment `4e1185bf-e60c-4ad6-b003-0afea11f74f9`) and `brvin-service` `500709c7-b62a-4c6c-9613-159f77988310` (deployment `967d0804-a43f-4236-8284-ac900b1977b5`). Artifact [14553902907](https://github.com/ashini-x/parmar-ai/actions/runs/44571138999/artifacts/14553902907).

These release smoke checks validate root and BRVIN-backed health. They do not sign in as the Owner or exercise Project Context. M4.4 is not marked fully accepted until the Owner walkthrough below is completed.

## 4. Remaining authenticated Owner walkthrough

1. Sign in as the Owner and open `/admin/intelligence`.
2. Open a conversation associated with the connected Owner Intelligence hub topic, or create a Scratchpad and select that topic.
3. In the sidebar **PROJECT CONTEXT** panel, choose the Owner Intelligence hub topic and **Owner Gemini Intelligence** project. Leave optional Workstream and Feature at project-wide defaults.
4. Keep **Enable cross-project context** and **Add selected scope as secondary context** unchecked. Press **Attach pinned Project Memory**.
5. Verify the attached primary scope and inspect the repository, branch, exact commit SHA, governing manifest provenance and allowlisted active file names.
6. Send a fresh prompt asking the selected Gemini model to summarize the attached project memory and identify the pinned commit. Verify the answer uses the Owner Gemini Intelligence scope and does not introduce unrelated project facts.
7. Confirm a separate Scratchpad remains transcript-only until the Owner explicitly attaches a project.

Record the actual Owner observation and date here after the walkthrough. Do not enable cross-project mode or create production test projects merely to complete this default-path check.

## 5. Cloudflare capacity cleanup

At the start of the maintenance, the account Durable Object namespace inventory was at 100/100. Stale `parmar-ai` preview environments were reconciled against merged PR heads, current branches and open PRs. Only eligible old preview records with no open PR and empty Durable Object object listings were removed, without force deletion. Final inventory was 32 namespaces: 16 for `parmar-ai` and 16 for `askmoina-voice`. No Workers plan upgrade or new resource provisioning was performed; active non-preview namespaces were not intentionally deleted. The runtime code and bindings were not changed by this cleanup.
