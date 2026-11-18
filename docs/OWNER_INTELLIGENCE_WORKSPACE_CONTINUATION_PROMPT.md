# New-chat continuation prompt — Owner Gemini Intelligence

Continue the Owner-only **Owner Gemini Intelligence** workspace in `ashini-x/parmar-ai`.

## First action: recover the live source of truth

Before changing anything, inspect the latest `main` branch and read, in this order:

1. `docs/OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md` — authoritative milestone status, gates, decisions and task log.
2. `docs/OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md` — this handoff.
3. `docs/OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md` — approved memory/context design, including the Cloudflare Owner Context Replicator.
4. `docs/OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md` — authoritative Gemini/ChatGPT role split, central hub hierarchy, exchange artifacts and Owner approval gates.
5. `docs/OWNER_INTELLIGENCE_PROVIDER_AND_INFRASTRUCTURE_POLICY.md` — locked single-provider decision, Cloudflare Free/Paid limits and M4.6-P0 gate.
6. `docs/TEST_PLAN.md` and `docs/README.md`.
7. Re-read the source files and deployment/workflow state relevant to the first incomplete task. Do not rely on an old chat summary or assume this prompt is newer than GitHub.

## Product and security boundary

This is a private, general-purpose Gemini workspace inside the existing Owner-protected Admin Control Center. It is separate from the student-facing परमार्थAI Telegram tutor. Preserve the Owner route/session controls, selected-model and thinking-level behaviour, D1 isolation, current Vertex REST/SSE adapter, BRɅIN boundaries and all student flows. **Google Gemini through Vertex AI is the only AI provider inside Owner Intelligence.** Cloudflare is the deterministic backend only; do not use Workers AI, introduce another model provider, add a hidden model-backed summarizer/reranker or silently fall back. Cloudflare Free is the current Owner-confirmed account plan; do not assume account-wide headroom.

The Owner can type a prompt or dictate speech into editable text; both use the same text-generation path. Do not add Gemini Live, real-time audio/video, speech-to-speech, assistant voice output, media generation, generic computer-use/MCP or broad consumer-Gemini parity without a separately approved scope change. BRɅIN context remains optional and off by default. Never silently switch model, thinking level, API or provider.

### Locked infrastructure decision

- All Owner Intelligence inference (chat, CountTokens, memory draft and future model-backed Owner tasks) goes through the existing Vertex REST/SSE adapter using the exact selected verified Gemini model/thinking level. A memory preview consumes the same conversation's M4.1 200K D1 budget. ChatGPT Software Engineer is a separate authorized code executor, not a runtime provider.
- Cloudflare Workers/D1 perform authentication, validation, transcript/token/outbox persistence, context assembly, streaming transport and GitHub operations. D1 remains canonical. No Workers AI or new R2/KV/Vectorize/AI Search/Queue/Workflow resources are prerequisites; no resource is provisioned without a task-specific decision and Owner approval.
- The detailed Workers Free/Paid comparison and official sources are in `docs/OWNER_INTELLIGENCE_PROVIDER_AND_INFRASTRUCTURE_POLICY.md`. The Owner confirms Workers Free; actual current account-wide usage/headroom is not yet measured.
- M4.6-P0 — Cloudflare capacity and durability readiness — is required before M4.6 implementation. It measures shared Worker/D1/Queue/Workflow usage, costs and recovery. It does not block the current M4.3 acceptance walkthrough or automatically require an upgrade. Free Queue retention is 24 hours; D1 outbox, not queue messages or workflow state, remains the durable job authority.


## Current implementation status — do not overstate

- M0–M4.3 implementation is merged and deployed. PR [#346](https://github.com/ashini-x/parmar-ai/pull/346) merged as `4291a8a63d44bdc035a97d4a72b9edafda24b60c`. Current-head validation [44382449397](https://github.com/ashini-x/parmar-ai/actions/runs/44382449397) passed 505 Vitest/74 files, 62 Node/9 files, TypeScript/check and all three Worker dry-runs. Production release [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed deployment, smoke and release acceptance. PR #346 merged as `4291a8a63d44bdc035a97d4a72b9edafda24b60c`; validation [44382449397](https://github.com/ashini-x/parmar-ai/actions/runs/44382449397) passed TypeScript/check, 505 Vitest tests/74 files, 62 Node tests/9 files and three Worker dry-runs. Production release [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed paired deployment and root/health, BRVIN binding, Fatman retrieval and release-acceptance checks. `parmar-ai` version `393f0844-3f65-4275-90b1-f6d5cca4f2d3` and `brvin-service` version `d43a9f7b-32b3-486f-9845-75ed11811165` are at 100% traffic; artifact [14464228113](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092/artifacts/14464228113). M4.3 Owner App installation is verified by the 2026-11-19 production screenshot (`Connected · 1 verified installation(s)`, account `ashini-x · User`, repository `ashini-x/owner-memory-hub · Private`). The topic list/create/rename route defect is now fixed in PR [#352](https://github.com/ashini-x/parmar-ai/pull/352), merged as `c555d9428421fbbe600a872093730fa3dce644e1`, and production-deployed by [workflow 44411119143](https://github.com/ashini-x/parmar-ai/actions/runs/44411119143). Cloudflare confirms `parmar-ai` version `1df8cbae-4777-44f9-87b4-e26dc6acde93` is at 100% traffic; `brvin-service` `da8c9944-a349-4b74-a160-1582db9ec104` is also at 100%. The fix uses the Worker’s `/admin/api/intelligence/topics` route and a dedicated `Retry topics` action. Production D1 previously showed zero topic rows, so the attempted topic was not created. **Next action: the Owner can now hard-refresh Owner Intelligence and retry topic creation.** Verify the topic appears in both topic dropdowns before attaching the hub and continuing M4.3.
- M4 model-aware thinking, SSE text generation, partial persistence, Stop, Edit/resubmit and Regenerate are implemented/deployed. **Owner-reported authenticated production acceptance passed on 2026-11-18** for waiting/first-visible-token/streaming status, Stop/partial retention after reload, Edit/resubmit, Regenerate and selected model/thinking-level preservation. Automatic reconnection remains deferred.
- Owner-reported Vertex `StreamGenerateContent` HTTP 429 / `RESOURCE_EXHAUSTED` is separate from the 200K conversation cap. PR [#338](https://github.com/ashini-x/parmar-ai/pull/338) is merged as `518dd899db443caa0f9db3e402961e90cb5baf82`; production Worker version `3dc555ca-c84b-49c0-8f73-2575c2397143` is at 100% traffic, using the `global` endpoint and at most two retries for transient initial stream-open 408/429/5xx responses with bounded backoff/jitter/Retry-After. The Owner now reports that the latest live Hydrogen HIGH request responds and no longer shows `RESOURCE_EXHAUSTED`. Treat that as a successful observed request, not a guarantee of permanently unlimited Google capacity; retain the bounded retry and check project/model quotas only if the issue recurs. Preserve the exact 200,000-token M4.1 D1 budget and reservation/settlement architecture.
- M4.1's independent **200,000 cumulative token budget per conversation** is merged and deployed (PR #335). D1 tracks committed usage and in-flight reservations; exact CountTokens preflight, output reservation/cap, usage settlement and the visible meter/read-only boundary are implemented. **Owner-reported browser acceptance passed** for meter/in-flight reservation and concurrency. Exact final-fill, one-token-over rejection-before-prompt-persistence and same-chat reservation-race tests also passed against Cloudflare's local D1 binding in PR [#341](https://github.com/ashini-x/parmar-ai/pull/341), merged as `60ed1705c247530b6321290c38abae8ee309022f`. Validation [44335838504](https://github.com/ashini-x/parmar-ai/actions/runs/44335838504) passed TypeScript, 499 Vitest tests/72 files, 62 Node tests/9 files and all three Worker dry-runs. Tests used mocked Vertex calls and local Miniflare D1; no production data or billed Gemini requests. **M4.1 acceptance is complete; retain the 200,000-token architecture unchanged.**
- M4.2 Scratchpad/topic foundation is merged and deployed in `5dfd42499fc9f14dfda915c3c264242af779dc2d` (PR [#343](https://github.com/ashini-x/parmar-ai/pull/343)). It adds Owner-scoped D1 topics, additive legacy conversation metadata, persistent Scratchpad default, optional topic association for a new chat, and topic create/list/rename controls. Existing transcript/generation/200K usage rows are preserved. Production workflow [44341065839](https://github.com/ashini-x/parmar-ai/actions/runs/44341065839) passed paired deployment, root/health smoke, BRVIN service binding and Fatman readiness. `parmar-ai` version `107a75e0-4f62-4a16-a748-6b0f0b6e6894` and `brvin-service` version `030e0db4-c94d-40e7-a246-a22213aca3b8` are at 100% traffic; release manifest artifact [14443836745](https://github.com/ashini-x/parmar-ai/actions/runs/44341065839/artifacts/14443836745). This slice does not load Project Memory, pin a Git commit or write to GitHub; M4.3 is authorization/Save to GitHub and M4.4 owns manifest-selected Project Memory and pinned repository/branch/commit snapshots. No automatic Scratchpad expiry/deletion is added.
- Automatic in-place SSE reconnection is deferred and not implemented.

## Exact next task and execution gate

**Do not switch to infrastructure work now.** The immediate task remains the Owner's in-progress M4.3 authenticated browser acceptance. Finish topic create/list verification, attach the private hub and unique memory root, reviewed five-file save/read-back/topic promotion, then stale-branch Conflict and recovery. M4.4 remains blocked until that live gate passes. The new M4.6-P0 capacity gate is later in the sequence and does not change the current walkthrough.

**M4.1 and M4.2 foundations are complete and deployed. Do not re-run or weaken the 200,000-token boundary.** The latest main branch plus PR #343 records:

1. **M4 passed by Owner report:** waiting/first-visible-token/streaming status, Stop with partial retention after reload, Edit/resubmit, Regenerate and selected model/thinking-level preservation.
2. **M4.1 passed:** Owner-reported meter/in-flight reservation and cross-tab concurrency checks; deterministic local-D1 exact final-fill to 200,000, one-token-over rejection before persistence, and same-chat reservation race passed in PR [#341](https://github.com/ashini-x/parmar-ai/pull/341).
3. **M4.2 passed and deployed:** Scratchpad default, Owner-scoped D1 topics, optional topic association for new chats, additive legacy metadata migration and preservation of existing transcript/200K usage. PR [#343](https://github.com/ashini-x/parmar-ai/pull/343), merge commit `5dfd42499fc9f14dfda915c3c264242af779dc2d`. Validation [44340775103](https://github.com/ashini-x/parmar-ai/actions/runs/44340775103): TypeScript, 503 Vitest tests/73 files, 62 Node tests/9 files and three Worker dry-runs passed. Production [44341065839](https://github.com/ashini-x/parmar-ai/actions/runs/44341065839): paired deployment and root/health, BRVIN binding, Fatman readiness and release acceptance passed. Versions: `parmar-ai` `107a75e0-4f62-4a16-a748-6b0f0b6e6894`; `brvin-service` `030e0db4-c94d-40e7-a246-a22213aca3b8`; manifest artifact `14443836745`.
4. **Current task: complete M4.3 live Owner acceptance in production.** The implementation is already merged/deployed. It includes the private Owner GitHub App with exactly Metadata read + Contents write; selected-only installation with PKCE verification; encrypted App credentials in D1; Gemini-generated editable five-file memory preview using the current selected model/thinking level; CountTokens plus the same chat's 200K D1 reservation/settlement; best-effort secret redaction; explicit confirmation; Contents write token only after confirmation; expected-head check; non-force commit; stored commit SHA; recovery of interrupted commit/verification; exact file read-back; and Synced/topic promotion only after verification. Do not change the 200K architecture.

**Next action for the Owner:** the topic-route fix is already merged and production-deployed. Hard-refresh [Owner Intelligence](https://parmar-ai.thenewtongs.workers.dev/admin/intelligence) (Windows: Ctrl+Shift+R), click `+ Topic`, create `Owner Intelligence`, and verify it appears in both `START NEW CHAT IN` and `SAVE CURRENT CHAT TO PROJECT`. Then select it under `START NEW CHAT IN`, attach `ashini-x/owner-memory-hub`, branch `main`, memory root `projects/owner-intelligence/memory`, and confirm the UI says it was attached. After that, proceed with a Scratchpad test conversation, preview/review all five files, explicit confirm, exact GitHub commit/file read-back and Scratchpad promotion. Finally test stale-branch Conflict and recovery. Do not reinstall/recreate the GitHub App. Production evidence: [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092). PR #346 merged as `4291a8a63d44bdc035a97d4a72b9edafda24b60c`; validation [44382449397](https://github.com/ashini-x/parmar-ai/actions/runs/44382449397) passed TypeScript/check, 505 Vitest tests/74 files, 62 Node tests/9 files and three Worker dry-runs. Production release [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed paired deployment and root/health, BRVIN binding, Fatman retrieval and release-acceptance checks. `parmar-ai` version `393f0844-3f65-4275-90b1-f6d5cca4f2d3` and `brvin-service` version `d43a9f7b-32b3-486f-9845-75ed11811165` are at 100% traffic; artifact [14464228113](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092/artifacts/14464228113). **M4.3 installation acceptance is now passed; its topic attachment/save/read-back/conflict browser acceptance remains pending.** M4.4 remains separate and must not start until that gate passes: it loads only manifest-approved Project Memory into future prompts and pins exact repository/branch/commit snapshots.

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

Start by re-reading latest `main` and production status. Continue with M4.3's real Owner App setup/install and browser acceptance; do not re-open the already merged/deployed implementation unless a live test finds a defect. Do not start M4.4 until M4.3 live acceptance passes. Keep the 200K M4.1 architecture unchanged.


## M4.3 implementation and live Owner acceptance (deployed 2026-11-19 IST)

Canonical branch: `feat/owner-intelligence-m4-3-github-app-auth`; PR: [#346](https://github.com/ashini-x/parmar-ai/pull/346). The duplicate PR #347 was closed without merge.

The Save preview uses the exact selected model and thinking level. Vertex CountTokens counts both the conversation contents and a fixed system instruction; the draft reserves prompt plus bounded output in the conversation's existing D1 usage ledger and settles from Vertex usage metadata. This draft is a generation within that chat and consumes budget; it is not a free background summary. The UI refreshes the token meter after the attempt. The existing transcript remains intact.

The review contains five bounded/editable Markdown files. Current repository Markdown is read at one base commit; generated memory uses the current selected project topic plus bounded, source-linked transcript excerpts. Common credential patterns are redacted best-effort before model input and before saving. The Owner still reviews every file. No branch write or Contents write token occurs before explicit confirmation.

The Worker persists the proposed commit SHA before a non-force branch ref update, then verifies the exact commit and every file at that immutable SHA before marking Synced and promoting a Scratchpad. A stale branch returns Conflict without force-overwriting edits; interrupted committing/verifying states can be retried against the stored commit SHA. Current-head validation [44382449397](https://github.com/ashini-x/parmar-ai/actions/runs/44382449397) passed: TypeScript/check, 505 Vitest tests/74 files, 62 Node tests/9 files and three Worker dry-runs. PR #346 is merged and production workflow [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed paired deploy and smoke/release acceptance.

Remaining gate: the Owner attaches the already-verified private hub to a project topic with a unique memory root; completes preview/edit/confirm and exact GitHub read-back/topic promotion; and exercises stale-branch Conflict handling. M4.4 remains separate: manifest-selected prompt memory and immutable repo/branch/commit snapshots.


## M4.3 production deployment evidence — 2026-11-19 IST

PR #346 merged as `4291a8a63d44bdc035a97d4a72b9edafda24b60c`. Current-head PR validation [44382449397](https://github.com/ashini-x/parmar-ai/actions/runs/44382449397) passed TypeScript/check, 505 Vitest tests/74 files, 62 Node tests/9 files and three Worker dry-runs. Production release [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed paired deployment, root/health, BRVIN binding, Fatman retrieval and release acceptance. Deployed `parmar-ai` version `393f0844-3f65-4275-90b1-f6d5cca4f2d3` and `brvin-service` version `d43a9f7b-32b3-486f-9845-75ed11811165`, both at 100%; release artifact [14464228113](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092/artifacts/14464228113).

**Remaining manual Owner acceptance:** installation is now verified by screenshot. Attach a project topic/repository/branch/unique memory root; preview and edit all five files; confirm; inspect the exact GitHub commit/files; verify D1 topic association and token meter; advance a touched branch file after preview and confirm Conflict without external edit overwrite. Once these pass, M4.3 can be marked fully accepted and M4.4 may begin.

## 2026-11-19 authoritative architecture and handoff update

This section supersedes any earlier wording in this prompt that assumes one GitHub repository per project or that Gemini is the application-code executor.

### Locked operating model

- **Owner:** director and final authority for project registration, architecture decisions, accepted memory, implementation authorization and merge/deployment approval.
- **Gemini Owner Intelligence:** discussion, architecture, planning, critique, correction, project-memory curation and implementation-brief drafting. It does not push/merge/deploy application source code.
- **ChatGPT Software Engineer:** separately authorized engineering/release executor. It reads Owner-approved briefs, inspects the actual source repositories, implements, tests, opens/updates PRs, merges and deploys when authorized, and writes a factual implementation report to the hub.
- GitHub is the versioned document exchange layer; no live agent-to-agent wake-up or private chat transcript sharing is implemented. The Owner explicitly asks each AI to read/publish selected artifacts.
- One private `owner-memory-hub` is the target memory/collaboration repo. It does not contain source code. Existing source repositories remain independent and are represented by references.
- Dedicated BRɅIN Owner Memory App: install only on the hub, selected-only, exact Metadata read + Contents read/write, no events. ChatGPT uses separate credentials; never share its connector token with Cloudflare or the Worker App.

### Owner's immediate actions

1. **GitHub installation is now verified.** The 2026-11-19 production screenshot shows `Connected · 1 verified installation(s)`, account `ashini-x · User`, and `ashini-x/owner-memory-hub · Private`. The App must remain installed only on this hub with selected-repository access. Do not uninstall, recreate or reinstall it.
2. In Owner Intelligence, click `+ Topic` and create the first project topic (for example, `Owner Intelligence` or the first real project you want to manage).
3. Select that topic under `START NEW CHAT IN`. Attach repository `ashini-x/owner-memory-hub`, branch `main`, and a unique project memory root. For an Owner Intelligence project, use `projects/owner-intelligence/memory`; choose a different path for each other project.
4. Open a chat in that topic and choose the same topic under `SAVE CURRENT CHAT TO PROJECT`. Click `Preview Save to GitHub`, inspect/edit all five files, and confirm only after reviewing the destinations and content.
5. Verify the resulting GitHub commit and all five files at its exact SHA; confirm the save reports Synced only after byte-exact read-back and the existing Scratchpad/topic promotion is correct. Check the same chat's 200K meter because the Gemini draft consumes that conversation's budget.
6. Test stale-branch handling: create a preview, advance one of its destination files externally, then confirm the old preview. It must return Conflict without overwriting the external change. Make a fresh preview and complete a normal verified save.
7. **M4.3 is fully accepted only after steps 2–6 pass.** Do not begin M4.4 before that gate. Once accepted, proceed to M4.4 hierarchical hub manifest/project catalog, stable project/workstream/feature IDs, pinned snapshots and scoped Project Memory loading.

### M4.4–M4.8 design authority

Read [OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md](OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md) before implementing memory/collaboration. M4.4 adds the central hub manifest/project catalog, stable project/workstream/feature IDs, immutable per-conversation hub commit snapshots, manifest-selected active memory and strict cross-project isolation. M4.3's current branch-head conflict guard must remain until safe path-aware multi-writer concurrency is implemented. M4.5 retains project-aware rollover and durable handoffs. M4.6 implements the Cloudflare Owner Context Replicator and all original fixed-B/O(N) acceptance. M4.7 and M4.8 remain as already specified.

### Original Gemini problems remain non-negotiable

- Preserve the exact M4.1 200,000-token cumulative budget per conversation and its D1 CountTokens/reservation/settlement/concurrency rules.
- M4.6 solves quadratic full-history replay; the exact final prompt, including project/workstream/feature memory, selected collaboration artifacts, recent turns and relevant exact historical D1 message pairs, must fit one selected-model-specific input budget B. Every request is ≤ B; for fixed B, aggregate prompt input over N turns is ≤ N × B = O(N). Run deterministic 10/50/100/200-turn tests and compare to a naïve O(N²) full-history baseline.
- Keep D1 as the full transcript authority. Do not copy every private turn to GitHub. Keep all seven Owner scenarios in the canonical Memory and Context Architecture.
- ChatGPT execution begins only from an Owner-approved implementation-ready brief. Proposals/reviews are not authorization. ChatGPT reports actual source commits, tests, deployment workflow/version and rollback evidence; Gemini may audit the report.

Canonical documents now include [OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md](OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md). Docs-only architecture updates do not justify a production Worker deployment.
