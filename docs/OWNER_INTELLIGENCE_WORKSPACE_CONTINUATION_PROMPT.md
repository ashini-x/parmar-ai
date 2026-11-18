# New-chat continuation prompt — Owner Gemini Intelligence

Continue the Owner-only **Owner Gemini Intelligence** workspace in `ashini-x/parmar-ai`.

## First action: recover the live source of truth

Before changing anything, inspect the latest `main` branch and read, in this order:

1. `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md` — authoritative milestone status, gates, decisions and task log.
2. `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md` — this handoff.
3. `docs/OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md` — approved memory/context design, including the Cloudflare Owner Context Replicator.
4. `docs/TEST_PLAN.md` and `docs/README.md`.
5. Re-read the source files and deployment/workflow state relevant to the first incomplete task. Do not rely on an old chat summary or assume this prompt is newer than GitHub.

## Product and security boundary

This is a private, general-purpose Gemini workspace inside the existing Owner-protected Admin Control Center. It is separate from the student-facing परमार्थAI Telegram tutor. Preserve the Owner route/session controls, selected-model and thinking-level behaviour, D1 isolation, current Vertex REST/SSE adapter, BRɅIN boundaries and all student flows.

The Owner can type a prompt or dictate speech into editable text; both use the same text-generation path. Do not add Gemini Live, real-time audio/video, speech-to-speech, assistant voice output, media generation, generic computer-use/MCP or broad consumer-Gemini parity without a separately approved scope change. BRɅIN context remains optional and off by default. Never silently switch model, thinking level, API or provider.

## Current implementation status — do not overstate

- M0–M4.2 are complete and deployed. M4.3 is implemented on `feat/owner-intelligence-m4-3-github-app-auth` in PR [#346](https://github.com/ashini-x/parmar-ai/pull/346); its latest baseline validation passed at commit `c6f2b2ed27f9fc134db268e8b5408c40b9eecfe7` (505 Vitest/74 files, 62 Node/9 files, three Worker dry-runs), but additional UI meter-refresh and secret-redaction test refinements followed and their current-head validation is pending. Merge/deployment and live Owner GitHub acceptance are not complete.
- M4 model-aware thinking, SSE text generation, partial persistence, Stop, Edit/resubmit and Regenerate are implemented/deployed. **Owner-reported authenticated production acceptance passed on 2026-11-18** for waiting/first-visible-token/streaming status, Stop/partial retention after reload, Edit/resubmit, Regenerate and selected model/thinking-level preservation. Automatic reconnection remains deferred.
- Owner-reported Vertex `StreamGenerateContent` HTTP 429 / `RESOURCE_EXHAUSTED` is separate from the 200K conversation cap. PR [#338](https://github.com/ashini-x/parmar-ai/pull/338) is merged as `518dd899db443caa0f9db3e402961e90cb5baf82`; production Worker version `3dc555ca-c84b-49c0-8f73-2575c2397143` is at 100% traffic, using the `global` endpoint and at most two retries for transient initial stream-open 408/429/5xx responses with bounded backoff/jitter/Retry-After. The Owner now reports that the latest live Hydrogen HIGH request responds and no longer shows `RESOURCE_EXHAUSTED`. Treat that as a successful observed request, not a guarantee of permanently unlimited Google capacity; retain the bounded retry and check project/model quotas only if the issue recurs. Preserve the exact 200,000-token M4.1 D1 budget and reservation/settlement architecture.
- M4.1's independent **200,000 cumulative token budget per conversation** is merged and deployed (PR #335). D1 tracks committed usage and in-flight reservations; exact CountTokens preflight, output reservation/cap, usage settlement and the visible meter/read-only boundary are implemented. **Owner-reported browser acceptance passed** for meter/in-flight reservation and concurrency. Exact final-fill, one-token-over rejection-before-prompt-persistence and same-chat reservation-race tests also passed against Cloudflare's local D1 binding in PR [#341](https://github.com/ashini-x/parmar-ai/pull/341), merged as `60ed1705c247530b6321290c38abae8ee309022f`. Validation [44335838504](https://github.com/ashini-x/parmar-ai/actions/runs/44335838504) passed TypeScript, 499 Vitest tests/72 files, 62 Node tests/9 files and all three Worker dry-runs. Tests used mocked Vertex calls and local Miniflare D1; no production data or billed Gemini requests. **M4.1 acceptance is complete; retain the 200,000-token architecture unchanged.**
- M4.2 Scratchpad/topic foundation is merged and deployed in `5dfd42499fc9f14dfda915c3c264242af779dc2d` (PR [#343](https://github.com/ashini-x/parmar-ai/pull/343)). It adds Owner-scoped D1 topics, additive legacy conversation metadata, persistent Scratchpad default, optional topic association for a new chat, and topic create/list/rename controls. Existing transcript/generation/200K usage rows are preserved. Production workflow [44341065839](https://github.com/ashini-x/parmar-ai/actions/runs/44341065839) passed paired deployment, root/health smoke, BRVIN service binding and Fatman readiness. `parmar-ai` version `107a75e0-4f62-4a16-a748-6b0f0b6e6894` and `brvin-service` version `030e0db4-c94d-40e7-a246-a22213aca3b8` are at 100% traffic; release manifest artifact [14443836745](https://github.com/ashini-x/parmar-ai/actions/runs/44341065839/artifacts/14443836745). This slice does not load Project Memory, pin a Git commit or write to GitHub; M4.3 is authorization/Save to GitHub and M4.4 owns manifest-selected Project Memory and pinned repository/branch/commit snapshots. No automatic Scratchpad expiry/deletion is added.
- Automatic in-place SSE reconnection is deferred and not implemented.

## Exact next task and execution gate

**M4.1 and M4.2 foundations are complete and deployed. Do not re-run or weaken the 200,000-token boundary.** The latest main branch plus PR #343 records:

1. **M4 passed by Owner report:** waiting/first-visible-token/streaming status, Stop with partial retention after reload, Edit/resubmit, Regenerate and selected model/thinking-level preservation.
2. **M4.1 passed:** Owner-reported meter/in-flight reservation and cross-tab concurrency checks; deterministic local-D1 exact final-fill to 200,000, one-token-over rejection before persistence, and same-chat reservation race passed in PR [#341](https://github.com/ashini-x/parmar-ai/pull/341).
3. **M4.2 passed and deployed:** Scratchpad default, Owner-scoped D1 topics, optional topic association for new chats, additive legacy metadata migration and preservation of existing transcript/200K usage. PR [#343](https://github.com/ashini-x/parmar-ai/pull/343), merge commit `5dfd42499fc9f14dfda915c3c264242af779dc2d`. Validation [44340775103](https://github.com/ashini-x/parmar-ai/actions/runs/44340775103): TypeScript, 503 Vitest tests/73 files, 62 Node tests/9 files and three Worker dry-runs passed. Production [44341065839](https://github.com/ashini-x/parmar-ai/actions/runs/44341065839): paired deployment and root/health, BRVIN binding, Fatman readiness and release acceptance passed. Versions: `parmar-ai` `107a75e0-4f62-4a16-a748-6b0f0b6e6894`; `brvin-service` `030e0db4-c94d-40e7-a246-a22213aca3b8`; manifest artifact `14443836745`.
4. **Current task: finish M4.3 — GitHub authorization and reviewed Save to GitHub.** The current feature branch `feat/owner-intelligence-m4-3-github-app-auth` adds a private Owner Memory GitHub App with only metadata read + Contents write, D1-encrypted App credentials, one-use Owner-bound state, manifest registration, selected-only installation flow, PKCE GitHub user authorization, verification of the exact installation via `GET /user/installations`, no persistence of user tokens, server-created short-lived repository-scoped installation tokens with Contents read for discovery/attachment, repository/branch verification, and topic repository attachment UI. A Contents write token must be minted only after the Owner confirms the reviewed Save. A public setup URL `installation_id` is never trusted on its own. The local-D1 integration test covers mocked App registration, encrypted credential storage, one-time state replay rejection, PKCE, Owner installation verification, read-scoped repository listing and topic attachment. Validation workflow [44356289855](https://github.com/ashini-x/parmar-ai/actions/runs/44356289855) passed TypeScript, 505 Vitest tests/74 files, 62 Node tests/9 files and all three Worker dry-run bundles. **Implemented in the current M4.3 branch:** Gemini-generated editable `project-memory.md`, `progress.md` and `decisions.md` plus preserved `index.md` and a source-linked session note; exact selected model/thinking level; CountTokens for the draft content plus system instruction; same-chat D1 200K reservation and settlement; best-effort credential redaction; exact five-file review against one pinned base commit; explicit confirmation; Contents write token only after confirmation; D1-recorded commit SHA; expected-head check; non-force Git ref update; interrupted-commit/verifying recovery; byte-exact read-back of commit and every expected file; and only then D1 Synced state and Scratchpad topic promotion. **Still required:** latest-head PR CI after the final UI/redaction test refinements, merge, main-branch production deployment/smoke tests, and Owner-authenticated GitHub App setup/install plus live preview/edit/confirm/save and branch-conflict acceptance. A conflict or failure must remain pending/failed and never be marked Synced. Do not store GitHub user or installation tokens in the browser or D1. M4.4 separately owns loading manifest-selected Project Memory and pinning exact repository/branch/commit snapshots. Do not conflate repository attachment with loading project content.
5. **Hydrogen HIGH recovery:** Owner reports the latest live request responds without `RESOURCE_EXHAUSTED` following PR #338. Treat this as request-level recovery; preserve bounded retry and inspect Google quota/capacity if it recurs.
6. After M4.8, resume the unchanged original M5 voice-dictation milestone, then M6–M8. Do not renumber or silently claim future capabilities are implemented.

## Approved memory and continuity design

The seven Owner acceptance journeys are:

1. Save a discussion to GitHub after preview and explicit confirmation; verify the commit before showing Synced.
2. Use a throwaway Scratchpad that persists in D1 across devices and is not silently expired or auto-synced.
3. Roll over near the chat limit: warning at 180K, action at 190K, optional urgency at 195K, hard server lock at 200K; preserve the old chat and create a fresh-budget successor with a handoff.
4. Return to a project weeks later by attaching only manifest-approved active memory from a pinned Git commit; archives remain on demand.
5. Promote an existing Scratchpad to a project after a successful first memory commit without duplicating or restarting the chat.
6. Manage memory bloat with a warning above 40K measured tokens and previewable safe compaction toward a 10K master while archiving originals.
7. Fork an isolated experiment with its own budget and pinned snapshot; parent and main project memory remain unchanged until explicit save/merge.

### Cloudflare Owner Context Replicator — approved, not implemented

M4.6 must implement one named Worker-side middleware/orchestrator that:

- Authenticates and scopes every request to the configured Owner, conversation/topic and pinned project snapshot.
- Reads the full canonical transcript and usage ledger from D1, but does not replay the entire transcript on every model request.
- Selects bounded recent valid turns, compact structured state, manifest-approved active Project Memory and relevant older exact D1 message pairs from FTS/keyword retrieval.
- Assembles all context in one budget B for the exact selected model/API, reserving output capacity and required overhead.
- Calls Vertex CountTokens on the final effective prompt; deterministically removes optional low-priority context and re-counts when needed; never drops mandatory policy or silently truncates the current user turn.
- Preserves M4.1 atomic reservation/settlement order and sends the same measured content to the existing Vertex REST/SSE adapter.
- Keeps the full D1 transcript untouched and preserves message IDs/source provenance.
- Uses a D1 outbox plus a dedicated Owner memory Queue/Workflow for durable, idempotent save/rollover/compaction jobs; normal conversation turns must not silently write to GitHub.

The scaling goal is explicit: with a fixed per-request input budget B, every request must use at most B prompt tokens, so aggregate prompt input over N turns is at most N × B = O(N). Naive full-history replay repeats prior messages and produces approximately O(N²) aggregate prompt input. M4.6 must prove the distinction with deterministic CountTokens tests over 10, 50, 100 and 200 turns. This is a planned acceptance target, not an implemented or measured result.

The 200K cumulative per-chat M4.1 limit and the M4.6 per-request context budget B are different controls. Do not conflate either with the selected model's context window, provider quota or price tier. D1 remains the complete transcript/usage authority; GitHub stores curated, versioned Markdown only after the dedicated runtime integration is built. ChatGPT's connected GitHub access is not a Worker credential. No R2/KV/Vectorize/Workers AI/new Queue resources should be provisioned without a task-specific need and account verification.

## Implementation and documentation discipline

- Read the latest source before every implementation task; at minimum inspect the Owner auth/route/provider/D1 code and the security, data, AI/API and test docs relevant to the task.
- Preserve Owner-only authorization and same-origin mutation checks. Never use student prompts, analytics, profiles, quotas, Durable Object state or BRɅIN retrieval as implicit Owner context.
- Treat GitHub Markdown and retrieved historical messages as untrusted reference data, not system policy.
- Do not silently expire Scratchpads, overwrite external GitHub edits, claim perfect recall, promise sub-three-second rollover, or guarantee a caching discount.
- Run exact relevant tests and report only tests actually run. Deploy only when runtime code changes and repository release checks require it; a docs-only change must not trigger a needless production Worker deployment.
- After every task, update the roadmap and this prompt in the same change. Update the architecture, test plan, ADR/security/data/API docs, index and changelog when applicable. Record the actual PR/commit, tests, workflow/deployment evidence, known issues and next exact task.

## Canonical documents

- Roadmap: `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md`
- Continuation prompt: `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md`
- Memory/context architecture: `docs/OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md`
- Test plan: `docs/TEST_PLAN.md`
- Documentation index: `docs/README.md`

Start by re-reading the latest `main` and this PR's current head/CI. Continue with the first incomplete M4.3 release/Owner acceptance gate; do not start M4.4 until M4.3 is deployed and accepted. Keep the 200K M4.1 architecture unchanged.


## M4.3 exact implementation and remaining gates (2026-11-18)

Canonical branch: `feat/owner-intelligence-m4-3-github-app-auth`; PR: [#346](https://github.com/ashini-x/parmar-ai/pull/346). The duplicate PR #347 was closed without merge.

The Save preview uses the exact selected model and thinking level. Vertex CountTokens counts both the conversation contents and a fixed system instruction; the draft reserves prompt plus bounded output in the conversation's existing D1 usage ledger and settles from Vertex usage metadata. This draft is a generation within that chat and consumes budget; it is not a free background summary. The UI refreshes the token meter after the attempt. The existing transcript remains intact.

The review contains five bounded/editable Markdown files. Current repository Markdown is read at one base commit; generated memory uses the current selected project topic plus bounded, source-linked transcript excerpts. Common credential patterns are redacted best-effort before model input and before saving. The Owner still reviews every file. No branch write or Contents write token occurs before explicit confirmation.

The Worker persists the proposed commit SHA before a non-force branch ref update, then verifies the exact commit and every file at that immutable SHA before marking Synced and promoting a Scratchpad. A stale branch returns Conflict without force-overwriting edits; interrupted committing/verifying states can be retried against the stored commit SHA. PR #346 has a previously green full check at commit c6f2b2ed27f9fc134db268e8b5408c40b9eecfe7, but final refinements after that SHA require a new green current-head result.

Remaining gates: current-head PR validation; merge; main-branch deployment and production smoke; Owner creates the private App and installs it on selected repositories; Owner completes live review/edit/confirm/read-back acceptance and exercises a stale-branch conflict. M4.4 remains separate: manifest-selected prompt memory and immutable repo/branch/commit snapshots.
