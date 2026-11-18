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

- M0–M3 are complete and deployed.
- M4 model-aware thinking, SSE text generation, partial persistence, Stop, Edit/resubmit and Regenerate are implemented/deployed. **Authenticated Owner acceptance is still open** for Stop/partial retention, Edit/resubmit, Regenerate and the observable waiting/streaming lifecycle.
- Owner-reported Vertex `StreamGenerateContent` HTTP 429 / `RESOURCE_EXHAUSTED` is separate from the 200K conversation cap. PR [#338](https://github.com/ashini-x/parmar-ai/pull/338) is merged as `518dd899db443caa0f9db3e402961e90cb5baf82`; production Worker version `3dc555ca-c84b-49c0-8f73-2575c2397143` is at 100% traffic. The current endpoint remains `global`. The Worker now retries transient initial 408/429/5xx stream-open responses at most twice with exponential backoff, jitter and a capped `Retry-After`; it does not retry permanent 4xx or an already accepted SSE stream, and Stop cancels the wait. The exact selected model/thinking level/request is preserved. **The Owner must still test the same Hydrogen HIGH request after deployment**; persistent failures require checking Google project/model quotas, billing tier and capacity. Preserve the exact 200,000-token M4.1 D1 budget and reservation/settlement architecture.
- M4.1's independent **200,000 cumulative token budget per conversation** is merged and deployed (PR #335). D1 tracks committed usage and in-flight reservations; exact CountTokens preflight, output reservation/cap, usage settlement and the visible meter/read-only boundary are implemented. **Authenticated Owner acceptance is still open** for meter refresh, in-flight reservation visibility and the exact 200,000-token hard boundary.
- M4.2–M4.8 are approved design only. Scratchpad/topic management, runtime GitHub App auth, automatic Save to GitHub, pinned Project Memory loading, rollover, Replicator middleware, historical recall, compaction, forks and caching are **not implemented**.
- Automatic in-place SSE reconnection is deferred and not implemented.

## Exact next task and execution gate

**Do not start M4.2 or implement the Replicator yet.** First close the existing authenticated M4 and M4.1 acceptance checks, in this order:

1. Verify M4 waiting/first-visible-token/streaming status transitions and ensure only observable request state is shown.
   - First, retry the previously failing Hydrogen HIGH request on the deployed Worker and record whether bounded `RESOURCE_EXHAUSTED` retries recover; a successful deployment alone does not prove persistent Google throttling is resolved.
   - Automated retry regression must prove the same selected model/thinking request is retried only for transient initial `StreamGenerateContent` 408/429/5xx responses, and stops after the bounded attempt count.
2. Verify Stop retains truthful partial response text/status.
3. Verify Edit/resubmit and Regenerate preserve turn order and selected model/thinking level.
4. Verify M4.1 meter refresh after completed/stopped/failed generation, including used/reserved/remaining values while a generation is in flight.
5. Verify a second concurrent generation cannot over-reserve the same chat, and the server rejects a turn at the exact 200,000-token boundary before persisting the rejected prompt.
6. Record the actual browser evidence in the roadmap. Do not claim a manual check passed until it has been performed.

Once both M4 and M4.1 acceptance gates pass, implement M4.2, then M4.3 through M4.8 sequentially. Only after that continuity sequence resume the unchanged original M5 voice-dictation milestone, then M6–M8. Do not renumber or silently mark any milestone complete.

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

Start by re-reading current `main`, then continue from the first incomplete authenticated M4/M4.1 check. Do not start the M4.2 implementation before those gates are closed.
