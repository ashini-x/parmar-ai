# Owner Intelligence — M4.4 Project Memory Acceptance

**Status:** **ACCEPTED — implementation deployed and authenticated Owner production attach/read + Scratchpad-isolation walkthrough passed**
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

## 4. Authenticated Owner production acceptance — PASSED (2026-11-19 IST)

The Owner completed the production browser walkthrough in `/admin/intelligence` on 2026-11-19. The tested conversation began as a new Scratchpad; the Owner explicitly selected the connected Owner Intelligence topic and the **Owner Gemini Intelligence** project, left Workstream and Feature at project-wide defaults, kept both cross-project controls off, and selected **Attach pinned Project Memory**.

### 4.1 Attachment and pinned provenance observed

The Project Context card showed:

- Primary project: **Owner Gemini Intelligence**
- Stable project ID: `6d0bf6d4-59a2-4df2-9389-6d04100d8d84`
- Workstream: none; Feature: none
- Hub repository: `ashini-x/owner-memory-hub`
- Branch: `main`
- Full pinned repository/catalog commit: `91e5c98cbc375b3c418207b6559021b16200e0b4`
- Active allowlisted files: `projects/owner-intelligence/memory/project-memory.md`, `progress.md`, and `decisions.md`
- The UI displayed source blob SHA identifiers for the three active files and an estimate of **2,599 tokens**.
- The card also showed `Hub ashini-x/owner-memory-hub · main · catalog commit 91e5c98cbc37`; that shortened catalog commit matches the prefix of the full pinned SHA above.
- The selected generation model was Gemini 4 Hydrogen (High thinking).

The screenshots show the repository, branch, full pinned commit, active file paths/blob provenance and catalog-commit reference. The symbolic schema label `owner-memory-v1` was **not separately visible in the captured card**. The pinned catalog commit and per-file blob identifiers provide the visible immutable provenance; the implementation's D1 snapshot retains the governing manifest provenance as described in Section 2. Do not claim that the UI visibly printed the symbolic revision label.

### 4.2 Attach-and-read model test — PASSED

The Owner sent a fresh prompt asking Gemini to use only the attached primary Project Memory, summarize the project purpose and current milestone state, identify the next task, reproduce the exact pinned commit SHA, and list the active memory files.

The captured response:

- Identified the Owner-only workspace and its governance/role separation.
- Distinguished the private memory hub from independent source-code repositories.
- Reproduced the full pinned commit SHA `91e5c98cbc375b3c418207b6559021b16200e0b4`.
- Identified the three active memory files: `project-memory.md`, `progress.md`, and `decisions.md`.
- Distinguished the pinned snapshot commit from a different historical commit mentioned inside `progress.md`.

The Owner supplied excerpts rather than every response screenshot; the recorded observations above are limited to details visible in the supplied captures and the Owner's confirmation that the remaining response was also received. This is production evidence that the selected memory was attached to the effective conversation and read by the selected Gemini model, not merely that the attachment button changed state.

### 4.3 Independent Scratchpad isolation test — PASSED

The Owner created a second, separate New Chat and left it as a Scratchpad. No topic, project or Project Memory was selected or attached. The Owner asked Gemini whether it could access the private Owner Gemini Intelligence Project Memory and requested the pinned commit SHA and active file names.

Gemini answered that no Project Memory was attached in that conversation and that it could not verify or provide the SHA or file names. The response did not invent those values. This is the expected no-implicit-context behavior for an untouched Scratchpad.

The two observed session meters were independent: **6,792 / 200,000** tokens in the attached-memory conversation and **1,050 / 200,000** in the separate Scratchpad at the time of the screenshots. These are UI observations, not a substitute for D1 accounting evidence. The 200,000-token per-conversation limit was not changed.

### 4.4 Acceptance decision

**M4.4 is formally accepted and closed as of 2026-11-19 IST.** The authenticated production default-path attach/read test and the independent Scratchpad-isolation test passed. Combined with the merged implementation, automated validation and production deployment recorded above, the M4.4 acceptance gate is satisfied.

The acceptance did not exercise cross-project opt-in, historical archive/session retrieval, branch refresh, rollover, compaction, forks, or path-aware multi-writer rebasing; these remain outside M4.4. The Owner did not repeat the M4.3 Save flow, alter Google Cloud settings, change the 200K budget, or modify student-facing Telegram behavior.

## 5. Cloudflare capacity cleanup

## 5. Cloudflare capacity cleanup

At the start of the maintenance, the account Durable Object namespace inventory was at 100/100. Stale `parmar-ai` preview environments were reconciled against merged PR heads, current branches and open PRs. Only eligible old preview records with no open PR and empty Durable Object object listings were removed, without force deletion. Final inventory was 32 namespaces: 16 for `parmar-ai` and 16 for `askmoina-voice`. No Workers plan upgrade or new resource provisioning was performed; active non-preview namespaces were not intentionally deleted. The runtime code and bindings were not changed by this cleanup.
