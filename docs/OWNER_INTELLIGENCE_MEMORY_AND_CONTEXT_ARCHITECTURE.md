# Owner Intelligence — Memory and Token-Aware Context Architecture

**Status:** Approved design with 2026-11-19 central Owner Memory Hub and AI collaboration amendment; M4.4–M4.8 not implemented  
**Original approval:** 2026-11-18  
**Central hub/collaboration amendment:** 2026-11-19 IST  
**Parent roadmap:** [OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md](OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md)  
**Continuation:** [OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md](OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md)  
**Scope:** Owner-only workspace in `ashini-x/parmar-ai`

## 1. Purpose and implementation boundary

Extend the deployed Owner Gemini chat so a project discussion can be saved, reopened after weeks, continued across independent chats, compacted safely, forked for experiments, and rolled over before the per-chat budget is exhausted.

This is a design specification for the capabilities that extend the deployed Owner workspace. M0–M4.3 (including Owner-scoped topics, a dedicated encrypted GitHub App credential, and reviewed preview/confirm Save to GitHub) are merged and deployed; authenticated Owner installation/save/conflict browser acceptance remains pending. Automatic Project Memory prompt loading, hierarchical hub manifests, immutable per-conversation snapshots, rollover, historical recall, compaction, fork and AI collaboration exchange are not yet shipped.

The implementation must preserve the existing Owner-only Admin Control Center, Vertex authentication and SSE path, selected-model behaviour, D1 conversation storage, and the student/BRɅIN security boundaries. It must not rebuild the chat UI or replace the current provider adapter.

## 2. The token problem: two different budgets

The design explicitly handles two separate token constraints. They must never be conflated.

### 2.1 Cumulative conversation lifetime budget — already deployed

M4.1 enforces 200,000 cumulative tokens per conversation. D1 is authoritative for committed usage and in-flight reservations.

Current behaviour to preserve:

- The Worker calls Vertex CountTokens before committing a new, edited or regenerated prompt.
- D1 atomically reserves the prompt token count plus the permitted output allowance (currently up to 8,192 tokens), and the request's max output is bounded by the reservation.
- A conversation cannot reserve a second generation concurrently.
- Vertex usageMetadata.totalTokenCount settles the reservation. If final usage metadata is missing, charge the reservation conservatively.
- Editing or regenerating does not refund tokens already consumed. Each new conversation has a separate budget.
- The 200,000 limit is an application-level session safeguard. It is not a model context-window size, a request input limit, or an account-wide Vertex quota.

Do not increase or silently change the limit during M4.2–M4.8.

### 2.2 Per-request prompt/context budget — planned M4.6

A conversation can be well below 200,000 cumulative tokens and still have one prompt that is too large for its selected model/API. Conversely, a long-lived conversation can have a small current prompt if the right context is selected.

Before a generation is committed, the server must measure the **complete effective request** for the exact selected model and API. This includes the application/Owner instruction, selected project-memory content, any retrieved historical messages, the bounded recent conversation, the current user turn, and any request-level material supported by that adapter. The measurement must match what will actually be sent to Vertex.

The builder must:
1. Reserve the model/API's required output capacity and any mandatory request overhead.
2. Select the current turn and useful recent conversation turns.
3. Add only manifest-selected active project-memory files.
4. Add structured state and older exact messages only when relevant.
5. Call Vertex CountTokens for the final assembled input.
6. If it does not fit, deterministically remove lower-priority optional context, re-count, and explain when relevant history or project notes were omitted.
7. Persist a proposed new/edit/regenerate mutation only after successful preflight and a valid budget reservation, preserving the existing M4.1 ordering.

Character count and a fixed number of turns may be used as cheap early bounds. They are not an authoritative fit check. Model context ceilings, input caps, output caps, reserved output and API behaviour must come from the currently verified server-side model registry, not a universal constant.

### 2.3 Pricing, quotas and provider caching

The cumulative 200K application budget must not be described as a universal Google pricing cliff. Pricing tiers and cached-token prices vary by model, API, request type and date. For example, Google's published pricing tables distinguish models with explicit 200K request input tiers from models priced without the same threshold. Verify the live pricing page before adding cost estimates: [Google Cloud Agent Platform pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing).

Context caching is an optimisation, not a substitute for history or a correctness dependency. Google documents model-specific support, minimum token thresholds, cache lifetime and pricing; verify these at implementation time against the exact project, region, model and API:
- [Context caching overview and supported models](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview)
- [Vertex AI context caching concepts](https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview)

Do not promise a fixed percentage saving or assume explicit caching is available for every selected model. Record actual cache hits, cache writes, TTL, latency and cost before enabling it. A cache miss, expiry or provider rejection must fall back to an equivalent safe uncached request without switching models.

## 3. Canonical stores and trust boundaries

### 3.1 D1 — canonical live conversation and accounting store

D1 remains authoritative for:
- Complete Owner conversations and verbatim user/assistant messages.
- Message IDs and their order/status.
- The 200K conversation usage ledger and reservations.
- Topics/project associations, conversation lifecycle, fork lineage and pinned project-memory snapshots (new tables/columns in later migrations).
- Idempotent memory-job/outbox state and retry status.

Do not migrate the canonical transcript to R2 or GitHub. The full transcript must remain available even when project-memory summarisation fails, a GitHub write conflicts, the Owner forks, or a handoff is compacted.

### 3.2 GitHub — curated, versioned project memory

GitHub stores concise Markdown that represents durable project knowledge and Owner-approved AI collaboration artifacts, not a verbatim dump of every turn. The target is one private Owner Memory Hub repository, shared by all projects. Each project/workstream/feature has its own stable ID and manifest-allowlisted path namespace within that hub. Source-code repositories remain independent and are represented by references only. A suggested layout is:

```text
<project-root>/
  memory/
    index.md
    project-memory.md
    progress.md
    decisions.md
    sessions/
      2026-11-18-auth-flow.md
    handoffs/
      2026-11-18-rollover.md
    archive/
      ...
```

- `index.md` is a small allowlist/manifest: active memory paths, purpose, revision metadata and optional token estimates.
- `project-memory.md` contains stable project goals, architecture and durable constraints.
- `progress.md` contains current status and next actions.
- `decisions.md` contains only accepted/locked decisions.
- Dated session notes capture useful outcomes from a discussion; handoff notes focus on continuation-critical state.
- `archive/` is excluded from default context and is searchable/on-demand.

These names and directory paths are an approved initial convention; the implementation may add schema versioning while retaining Markdown as the human-readable source format.

### 3.3 Runtime GitHub authorization

The production Worker needs its own GitHub authorization. The ChatGPT GitHub connector used to inspect this repository is not available as a credential to the deployed Worker.

Preferred approach: a dedicated private GitHub App installed in selected-repository mode on only the private Owner Memory Hub repository, with exactly `metadata: read` and `contents: write` and no webhook events. Source-code repositories are not installed on this write-capable App; ChatGPT uses its separate Owner-authorized GitHub/deployment integration for engineering work. The App private key, client secret and App identifiers are encrypted in the Owner-scoped D1 credential vault; the vault key is derived from the server-side session secret and Owner principal. A one-use, 10-minute D1 state binds manifest registration and installation callbacks to the Owner. GitHub's installation `setup_url` includes an `installation_id` that must be treated as untrusted: after the callback, complete GitHub's web-application user authorization flow with PKCE, exchange the code server-side, and verify the exact `installation_id` and `app_id` in the authorized user's `GET /user/installations` result. Require a selected-repositories installation, not all repositories. Discard the temporary user access token after verification. For repository discovery and attachment, mint short-lived installation tokens server-side with only `contents: read`, further restricted to the selected `repository_id`; never return tokens to the browser, logs or prompts. The App retains its `contents: write` grant for the later Save operation, but a write-capable installation token must not be minted until the Owner reviews and explicitly confirms the exact commit. Repository, branch and memory-root access must be revalidated on every request against the Owner-scoped topic and installation.

Saving is an explicit operation:
1. Ask Gemini to draft/refresh a small set of Markdown files from the selected conversation plus current project memory.
2. Show the proposed changes/diff and the target repository, branch and paths.
3. Require the Owner to confirm.
4. Write the multi-file update as one conflict-aware Git commit (for example using Git Trees + commit/ref update) based on the expected branch head.
5. Read back/verify the commit and expected files.
6. Only then mark the conversation as **Archived & Synced**. A failed or conflicting write remains **Sync pending/failed**, never Synced.

Do not silently overwrite files changed outside this application. Reconcile against the current branch head and show a diff/merge choice when the expected base SHA no longer matches.

### 3.4 Optional infrastructure

The initial design does not require R2, KV, Vectorize or Workers AI:
- R2 may be considered later for bulk transcript exports or immutable archives, but D1 remains canonical for live conversations.
- KV is not canonical memory and its consistency/write characteristics make it unsuitable as the authority for topic or token state. D1 stores the authoritative state.
- Use D1 FTS5/keyword retrieval first for exact historical recall. Consider a semantic index only after a representative query benchmark proves lexical retrieval insufficient.
- Do not assume Cloudflare Vectorize or Workers AI is enabled. Re-inspect the account and current bindings before proposing provisioning. Account inspection on 2026-11-18 found R2 not enabled, no KV namespace and no Vectorize index. Those are observations, not permanent account guarantees.

## 4. Owner experience and lifecycle

### 4.1 Primary actions

Keep the high-frequency chat actions simple:

1. **New Chat** — starts a Scratchpad by default.
2. **Attach Project Memory** — optional project selector, especially on a blank/new conversation.
3. **Save to GitHub** — available during a conversation and opens a review/confirm step.
4. **Roll Over** — appears when the current chat approaches its cumulative budget boundary.

**Compact Memory** and **Fork Chat** are secondary actions in a contextual/overflow menu, not permanent primary buttons.

### 4.2 Scratchpad and projects

A Scratchpad is a normal Owner conversation with no project attached. It remains in D1, works across devices and survives browser storage clearing, and is not automatically committed to GitHub. Quick one-off chats require no project selector or save action.

A Scratchpad can become a project conversation at any time through Save to GitHub. Promotion links the existing conversation to a topic only after the project's first memory commit succeeds; do not duplicate or restart the conversation.

No automatic 7/14-day deletion is approved. Initially, retain Scratchpads under the existing Owner deletion policy. A future optional expiry must be explicit, Owner-configured and recoverable (for example, trash/grace period before permanent purge). Never silently delete useful history.

### 4.3 Project attachment and immutable snapshots

A new conversation may optionally attach to a project. The server reads the manifest and only the files it explicitly lists as active. Session archives, large historical notes and unrelated repository documents are not automatically loaded.

At attachment time, record repository, branch and exact Git commit SHA plus selected paths and the CountTokens estimate. The conversation uses that pinned snapshot for its lifetime; changes committed to the branch later do not silently alter an active chat's context. The Owner can deliberately refresh or switch the snapshot.

Display the project-memory estimate separately from the new conversation's 200K cumulative usage. The estimate is not charged as conversation usage until the corresponding content is actually sent to the selected model; the exact prompt preflight remains authoritative.

### 4.4 The seven Owner workflows

The approved product experience must support these seven end-to-end scenarios. They are acceptance scenarios, not claims about shipped UI or runtime capabilities:

1. **Save a useful discussion:** while in a chat, the Owner requests Save to GitHub, reviews the proposed Markdown files/diff and destination, then explicitly confirms. M4.3 commits the curated memory atomically and verifies the resulting commit before showing Synced. The complete D1 transcript remains unchanged.
2. **Use a throwaway chat:** New Chat starts a Scratchpad in M4.2. It persists in D1 across browser/device changes, requires no project selection and is not automatically written to GitHub. No silent seven-/fourteen-day expiry is allowed.
3. **Continue near the chat limit:** M4.5 warns at 180,000 cumulative tokens, offers Roll Over at 190,000, optionally highlights urgency at 195,000, and preserves the 200,000 hard lock. It retains the old chat and creates a linked fresh-budget chat with a provenance-bearing handoff; D1 remains the fallback when GitHub is unavailable.
4. **Return to a project weeks later:** M4.4 lets the Owner attach Project Memory. Only manifest-allowlisted active files load by default, the exact repository/branch/commit SHA is pinned, and archived/session material is retrieved only on demand.
5. **Promote a Scratchpad:** M4.3 lets the Owner save an existing Scratchpad into a project. The current conversation is linked to the topic only after the first memory commit is verified; it is not duplicated or restarted.
6. **Control memory bloat:** M4.7 warns when active project memory exceeds 40,000 measured tokens. The Owner previews compaction toward a sub-10,000-token master only where safe; original notes are preserved in the versioned archive with provenance.
7. **Experiment without damaging the project:** M4.7 creates a child chat with its own 200,000-token budget and pinned memory snapshot. The parent remains unchanged and experimental results do not update main project memory until the Owner explicitly saves or merges them.

These seven workflows share the same D1 transcript authority, Owner-only authorization and context-budget enforcement. They must not introduce silent data deletion, implicit GitHub writes or unreviewed changes to the selected project memory.

## 5. Rollover and durable handoff

Recommended first thresholds, applied to committed usage plus in-flight reservation:
- **180,000:** amber heads-up; explain the remaining budget.
- **190,000:** show the primary **Roll Over (Save & Continue)** action.
- **195,000:** optional urgent visual state if a single request could consume the remaining allowance.
- **200,000:** the existing server-side hard lock; never relax this boundary in the UI.

A rollover handoff should include:
- Current objective and intended outcome.
- Locked decisions and non-negotiable constraints.
- Current architecture, relevant file paths/code/schema and exact implementation state.
- Completed work and evidence/commit references.
- Unresolved problems, blockers and uncertainty.
- The next concrete task and its acceptance checks.
- Provenance: source conversation ID and relevant D1 message IDs; project repo/branch/commit SHA where applicable.

Keep the old chat read-only but fully accessible. Create a new conversation with a new zeroed 200K budget, link it to the previous chat/topic and attach the selected project snapshot. Do not delete or mutate the prior transcript.

If GitHub is unavailable, retain the handoff in D1 and show an honest **Sync pending** status with retry. The user can still continue from the D1 handoff. Never lose the handoff just because external sync failed. Do not guarantee a sub-three-second rollover: Gemini summarisation, network latency and GitHub commit time vary. Maintain compact structured state during normal work when it is safe; rollover should only need to reconcile the recent tail when such state is current and provenance-checked.

## 6. Token-aware context assembly and historical recall

### 6.0 Cloudflare Owner Context Replicator — the coordinating middleware

**Architecture decision:** the **Cloudflare Owner Context Replicator** is the single logical middleware/orchestration boundary that reconstructs the effective conversational context for each Owner turn. It is a server-side Cloudflare Worker responsibility, not a separate model, a browser-side transcript cache, or a claim to reproduce ChatGPT's proprietary internals. Its job is to replicate the useful *conversation continuity behaviour*—bounded working context plus selective durable recall—while leaving the complete source transcript intact in D1.

The logical request path is:

```text
Owner browser
    │  authenticated turn + selected model/thinking level
    ▼
Owner-only Cloudflare Worker route
    ▼
Cloudflare Owner Context Replicator
    ├─ 1. Policy and scope
    │     Owner identity, conversation/topic, selected model/API,
    │     model context ceiling, output reservation and request budget
    ├─ 2. Canonical state read
    │     D1 transcript + message status/order + M4.1 usage/reservations
    ├─ 3. Context source selection
    │     pinned active Project Memory + structured state
    │     + D1 FTS/keyword hits (exact source message IDs)
    │     + bounded recent valid turn suffix
    ├─ 4. Budgeted assembly
    │     priority ordering, provenance and untrusted-data boundaries
    ├─ 5. Exact final fit gate
    │     Vertex CountTokens on the effective request; deterministic
    │     removal of optional low-priority context and re-count as needed
    └─ 6. Handoff to the existing provider adapter
          unchanged selected model/thinking level → Vertex REST/SSE
                    │
                    ▼
           streamed response + usage settlement
                    │
                    ▼
              canonical D1 transcript

Owner-confirmed save / rollover / compaction
    ▼
D1 outbox → dedicated Owner memory Queue/Workflow
    ▼
GitHub App → conflict-aware project-memory commit → read-back verification
```

The stages have the following contract:

1. **Authenticate and scope first.** Reuse the existing Owner route guard and bind every read/write to the configured Owner principal. Validate the conversation, topic and pinned project snapshot server-side. Never accept Owner identity, repo/path scope or model authority from browser-supplied context alone.
2. **Read canonical records, not browser replay.** Load authoritative D1 conversation metadata, valid message rows and M4.1 accounting. Keep all messages in D1. Exclude pending, failed and empty assistant rows from model context; after filtering, preserve the provider's valid user-led role ordering.
3. **Select context by purpose.** Use only the current pinned, manifest-approved active Project Memory; add compact structured project state with source references; search D1 FTS/keyword indexes for relevant older exact message pairs; then choose the most useful recent valid suffix. A Scratchpad has no project memory unless the Owner explicitly attaches/promotes it.
4. **Assemble under a request-specific budget.** Derive the available input budget from the selected model/API's currently verified context/input ceiling after reserving the requested output allowance and required request overhead. Put mandatory application/Owner policy and the current user turn above optional context. Count project memory, structured state, retrieval results, recent turns and the current turn together—not in separate unaccounted buckets.
5. **Measure the actual final request.** Call Vertex CountTokens for the exact assembled contents and the exact selected model/API. If it does not fit, remove optional context deterministically from lowest priority upward and re-count. Never remove mandatory security policy or silently truncate the current user turn. If mandatory content plus the user turn cannot fit, return a clear actionable error before committing the prompt mutation or starting generation.
6. **Preserve M4.1 accounting order.** Only after successful exact preflight, reserve prompt plus permitted output capacity atomically in D1, then commit the prompt mutation according to the current M4.1 ordering. A concurrent generation cannot over-reserve the chat.
7. **Use the existing provider path.** Pass the same final effective content, selected model and supported thinking level that were measured to the current Vertex REST/SSE adapter. Do not switch providers/models, expose thought parts, or add a tool/parser loop as part of the replicator's first slice.
8. **Persist and account independently of context selection.** Save user/assistant/partial transcript rows and usage settlement in D1. Prompt assembly must never truncate, rewrite or compact the canonical transcript. Exact historical retrieval always resolves back to D1 message IDs and records their source/provenance.
9. **Make memory writes explicit and durable.** Ordinary turns do not silently write GitHub memory. Save, rollover and compaction jobs first create an Owner-scoped idempotent D1 outbox record; a dedicated Queue/Workflow performs retryable external work. A GitHub status becomes Synced only after the expected commit is read back and verified. D1 handoff remains usable if GitHub is down.

The context replicator must preserve the adapter's role/message contract and treat all Project Memory and historical user content as untrusted reference data. Imported prompt-injection text cannot change application policy, authorization or the chosen model. Cache support (M4.8) may optimize stable prefixes only; cache expiry/miss must produce the same logical request through an uncached path.

#### Bounded-input and quadratic-growth solution

Let **B** be the selected model/API's effective maximum *input* token budget for one request after mandatory output capacity and required overhead have been reserved. For every generated turn (i), the final CountTokens result must satisfy:

`inputTokens(i) ≤ B`

For (N) turns, cumulative prompt input sent through the provider is therefore bounded by:

`P(N) = Σ inputTokens(i) ≤ N × B = O(N)`

This is the desired scaling property for a fixed model and fixed request budget. With naive full-history replay, if each new turn contributes an average of (c) tokens and every later prompt repeats all earlier turns, aggregate prompt input is approximately:

`c × (1 + 2 + … + N) = c × N(N + 1) / 2 = O(N²)`

The existing 200,000-token M4.1 lifetime ledger alone does **not** solve this repeated-context problem: it limits the cumulative cost of one chat but does not prevent a growing transcript from being resent on every turn. The Replicator solves it by bounding each assembled prompt and retrieving older records selectively, not by deleting history.

This is an upper-bound claim about **prompt input tokens** under a fixed per-request budget. It is not a guarantee of exact historical recall, response-token volume, fixed latency or a particular invoice amount. A different selected model may have a different B. Project memory, retrieved history and summaries must all be included in the same B; they cannot become an unmetered second context window. The M4.7 compaction workflow manages durable project-memory growth, while exact per-request CountTokens remains the final authority.

### 6.1 Prompt layers

Build each request in deliberate priority order:
1. Immutable Owner/application security and behaviour instructions.
2. Minimal neutral Owner workspace instruction.
3. Selected project memory (manifest-approved active paths only), clearly delimited as untrusted reference data.
4. Compact project state with decisions, progress and next task, each linked to source notes/messages.
5. Relevant exact historical D1 message pairs retrieved on demand.
6. A token-aware recent suffix of the current conversation.
7. Current user turn.

The actual provider adapter must preserve its required message ordering/role contract. Do not concatenate project documents or historical user content into trusted system instructions. Imported files and retrieved messages can contain prompt injection; treat them as data and enforce application policy independently.

### 6.2 Recent context and compaction strategy

Retain recent conversational turns based on relevance and actual token fit, not a universal 4-turn/14-turn rule. The current implementation has a bounded recent suffix; when M4.6 is implemented, improve this to a token budget while retaining the existing valid role sequencing and failed/empty assistant filtering.

A structured summary is a navigation aid, never a replacement for source records. Maintain at least:
- `LOCKED_DECISIONS`
- `CODE_AND_SCHEMAS`
- `STRICT_CONSTRAINTS`
- `CURRENT_PROGRESS`
- `OPEN_QUESTIONS_AND_BLOCKERS`
- `NEXT_ACTION`

Every item should cite its source note path/commit and, where it came from chat, conversation/message IDs. If source evidence conflicts, surface the conflict rather than silently choosing one. Never claim perfect/100% historical recall.

### 6.3 Historical search

Start with Owner-scoped exact/lexical search over D1, preferably FTS5 where appropriate. Search must be constrained by the selected project/topic and may search Scratchpad history only when explicitly requested or when no project scope is in force.

Return exact source message pairs/IDs and fetch those rows from D1 for the prompt. Do not use a generated summary as the only source when the original messages are available. A later semantic layer may rank candidates but must still fetch authoritative source messages.

Do not add a Gemini function tool or parser loop in the first implementation slice. The existing custom Vertex REST/SSE adapter currently parses user-facing text deltas and filters thought parts; adding function calls requires a separately scoped and tested provider protocol change, bounded tool iterations, safe allowlisting, function-response handling, thinking/signature preservation and exact token accounting.

### 6.4 Scaling acceptance for the Replicator

When M4.6 is implemented, add deterministic CountTokens-backed tests that use scripted histories of 10, 50, 100 and 200 turns. Hold the selected model, budget B, project snapshot and representative turn sizes constant so the tests can distinguish bounded context from full-history replay. Assert that:

- Every final request, including mandatory instructions, active project data, retrieved turns, recent suffix and current turn, measures at or below B.
- Once the recent suffix and selected retrieval set have saturated, increasing the number of older transcript rows does not increase the assembled request beyond B or cause the builder to resend the full transcript.
- The sum of prompt input tokens over N test turns is no greater than N × B. The same scripted workload's full-history replay baseline should exhibit the expected triangular/quadratic growth.
- The exact final contents passed to GenerateContent are the contents measured by CountTokens; no character-count or turn-count estimate substitutes for the final check.
- The complete D1 transcript is unchanged; retrieved historical turns resolve to exact D1 message IDs and retain provenance.
- Retrieval timeout/empty/error paths still produce a safe bounded prompt or a clear preflight failure; they never claim perfect recall or silently change model.
- A turn whose mandatory content cannot fit is rejected before prompt persistence/generation. Optional context may be reduced only through the deterministic priority policy.
- Project/history text stays outside trusted system policy; prompt-injection fixtures cannot override Owner/application instructions.

These are planned architecture acceptance tests, not test results from the documentation finalization. The O(N) bound applies while B is fixed; model changes or a deliberately changed budget require a separately measured series.

## 7. Memory compaction and forks

### 7.1 Compact Memory

When the combined active memory for a project reaches 40,000 measured tokens, show a warning only. Token count should be measured for the selected model/API rather than inferred from characters.

Compaction flow:
1. Read only the app-managed memory root and active manifest files.
2. Identify stale, duplicate or superseded material while preserving current decisions and constraints.
3. Draft a master context targeting below 10,000 tokens where the source justifies that reduction.
4. Retain source paths, original commit and source conversation/message IDs for every material conclusion.
5. Show the new master and file diff to the Owner.
6. In one versioned commit, archive superseded app-managed notes under `archive/` and update the manifest.
7. Verify the resulting commit before reporting success.

Never silently delete original notes, rewrite unrelated repository docs, or force an under-10K target when it would remove necessary detail. Archives stay searchable on demand and are excluded from default prompts.

### 7.2 Fork Chat

A fork creates a child conversation linked to its parent and independent 200K budget. Default fork context is the pinned project snapshot plus structured state and a recent selected suffix. Allow a future "fork from message" point, but do not duplicate and resend the full parent history automatically.

The parent stays untouched. The child is an experiment and does not write to the main project memory until the Owner explicitly saves or merges its result. Conflicting memory updates must be compared and resolved before a main-branch commit.

## 8. Background jobs, reliability and idempotency

A save/rollover/compaction may involve model work and several GitHub API operations. Do not rely on an unawaited Promise or post-response waitUntil for work that must survive disconnects or outlast the runtime's short post-response window. Cloudflare documents a 30-second waitUntil window after an HTTP response/client disconnect and recommends Queues or Workflows for work needing durable retries: [Workers Context / waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).

When implementation reaches this point:
- Write an Owner-scoped D1 outbox/job record first, with unique idempotency key, payload version and expected Git commit SHA.
- Dispatch to a dedicated Owner memory Queue/Workflow (do not mix jobs with student AI work); retries must be idempotent and bounded.
- Store status/attempt count/safe error/created/updated timestamps. A duplicate delivery must not create duplicate memory commits.
- Complete the user-facing action only after the durable job reports its verified result. For rollover, D1 handoff is enough to open the successor even while GitHub sync retries.
- Provide a safe manual retry and conflict-resolution path.

Do not add the new Queue, binding or Workflow until the live account/repo configuration is inspected and the required resource is justified. Use existing Cloudflare deployment patterns and update release docs before provisioning.

## 9. Proposed D1 entities (implementation proposal)

All records remain scoped to the configured Owner principal and are additive to the current Owner tables. Use stable UUIDs and explicit creation/update timestamps.

- `owner_intelligence_topics`: topic UUID, owner ID, title/slug, selected repository owner/name, branch, memory root, current manifest revision/commit SHA, lifecycle/status and optional explicit retention settings.
- Extend `owner_intelligence_conversations`: nullable topic ID (null = Scratchpad), session kind, lifecycle status, optional expires/trash timestamps only when the recoverable retention feature is approved, parent conversation ID/fork lineage, and pinned project-memory snapshot reference.
- `owner_intelligence_project_memory_snapshots`: topic/repository/branch/commit SHA, selected paths, source token estimate and creation timestamp.
- `owner_intelligence_memory_jobs`: Owner/topic/conversation IDs, job type (save/rollover/compact/index), idempotency key, status, attempt count, base/expected SHA and safe diagnostics.
- Keep current `owner_intelligence_session_usage`, `owner_intelligence_token_reservations` and generation metadata semantics independent per conversation.

Do not implement these schema names/columns until the current migrations and D1 initialization are inspected. Preserve backward compatibility and provide a migration/rollback strategy. Existing chats must not be reset to zero or silently assigned unrelated project context.

## 10. Delivery sequence and gates

The work is nested under M4 and must not replace original milestones.

| Order | Sub-milestone | Main deliverable | Gate |
|---|---|---|---|
| 0 | Existing M4/M4.1 acceptance | Authenticated Owner interaction and token-meter/boundary checks | Must pass first |
| 1 | M4.2 | Scratchpad/topic schema and UX foundation | Existing chats preserved; tests and docs updated |
| 2 | M4.3 | GitHub App auth and reviewed Save to GitHub | Least privilege; conflict-safe verified commit |
| 3 | M4.4 | Project Memory manifest and pinned snapshot loading | Prompt token fit and reference-data security |
| 4 | M4.5 | 180K/190K rollover, D1-safe handoff and fresh conversation | 200K limit remains enforced |
| 5 | M4.6 | Token-aware prompt builder and exact historical recall | Correct CountTokens/usage accounting |
| 6 | M4.7 | Previewable compaction and isolated forks | Originals/provenance retained |
| 7 | M4.8 | Measured cache/retrieval optimisations | Real metrics show worthwhile benefit |

After M4.8, continue with the original M5 voice-dictation milestone, then the existing M6 native Gemini API capabilities, M7 usage/cost visibility and M8 security/quality/production acceptance. BRɅIN context remains a separate optional add-on.

## 11. References and verification discipline

- [Google Agent Platform pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing) — model/API/date-specific input/output/cache billing. Re-check on every pricing-related implementation.
- [Google context caching overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview) — currently supported models, minimum token thresholds and TTL can change; re-check exact model/API/region at implementation.
- [Cloudflare waitUntil documentation](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil) — post-response work has a bounded lifetime; use a durable queue/workflow for work that must survive disconnects.
- This design makes no universal claim about pricing cliffs, context sizes, caching discounts, or model availability. The configured project's live capability and the exact selected model remain authoritative.



## 3.3.1 M4.3 implementation checkpoint

The implementation is on PR #346 / branch feat/owner-intelligence-m4-3-github-app-auth. The private GitHub App asks for exactly repository Metadata read and Contents write and no webhook events. Its private key and client secret are AES-GCM encrypted in Owner-scoped D1 with a vault key derived from the server session secret and Owner principal. Hashed one-use states bind manifest, installation and GitHub user-authorization callbacks. The installation callback's installation ID is untrusted until the Owner completes GitHub web authorization with PKCE and the authorized user's installation list confirms the exact App and installation IDs. The temporary GitHub user token is discarded.

Repository discovery and attachment use short-lived Contents read tokens restricted to one repository ID. The Worker rechecks the App and installation IDs, exact permission set and selected-only installation state when issuing tokens. The write-scoped Contents token is issued only after explicit Save confirmation.

The Save preview is a metered Gemini operation. It preserves the workspace's currently selected model and thinking level; uses Vertex CountTokens for the exact source contents plus the fixed system instruction; reserves prompt plus a bounded output allowance in the same conversation's D1 200,000-token ledger; and settles from Vertex usage metadata (or conservatively charges the reservation when final usage is unavailable). The UI refreshes the meter after the attempt. No alternative model/provider or separate unmetered summarizer is used.

The preview reads existing Markdown by one pinned branch-head commit, combines that memory with bounded D1 transcript excerpts carrying message IDs, and asks Gemini to return three complete Markdown documents: stable project memory, progress, and accepted decisions. It preserves the existing index and adds a dated session-note candidate. The Owner sees and edits all five files and their destination, base SHA, selected model/thinking level and draft token cost. Common private-key, GitHub token, Google API key, OAuth access-token, Bearer-token and labelled secret patterns are redacted best-effort before model input and before proposed files are persisted; this cannot guarantee detection of every possible secret, so Owner review remains mandatory. The draft output is untrusted model output and must be parsed/validated as the expected JSON shape and then edited by the Owner.

Each preview is D1-persisted, Owner-scoped, expires after 30 minutes, and allows only its exact five paths with per-file and aggregate size limits. Confirmation requires confirmed=true and all exact files. A branch-head change produces Conflict. The Worker creates one Git tree and commit, records the commit SHA in D1 before the non-force branch ref update, and recovers from an interrupted committing/verifying state without creating a second commit. It reads back the commit and every expected file at the exact commit SHA and compares content byte-for-byte before D1 marks Synced. Only then is the existing Scratchpad conversation associated with its topic and the topic's current commit metadata updated. No D1 transcript rows are edited or deleted by the save; only the metered generation affects the existing usage ledger.

M4.3 is merged and deployed, but its authenticated live Owner acceptance remains pending. Production release [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed; deployed versions: parmar-ai `393f0844-3f65-4275-90b1-f6d5cca4f2d3` and brvin-service `d43a9f7b-32b3-486f-9845-75ed11811165`, both at 100% traffic. The Owner must still create/install the dedicated GitHub App on selected repositories and run the preview/edit/confirm/save/read-back and stale-branch-conflict acceptance. M4.3 does not load Project Memory into ordinary chat prompts, pin a prompt snapshot for future turns, or implement archive search/compaction/rollover/fork/background sync; those remain M4.4–M4.8.


## M4.3 production release evidence

PR #346 merged as `4291a8a63d44bdc035a97d4a72b9edafda24b60c`. Current-head validation [44382449397](https://github.com/ashini-x/parmar-ai/actions/runs/44382449397) passed TypeScript/check, 505 Vitest tests/74 files, 62 Node tests/9 files and all three Worker dry-runs. Production workflow [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed. PR #346 merged as `4291a8a63d44bdc035a97d4a72b9edafda24b60c`; validation [44382449397](https://github.com/ashini-x/parmar-ai/actions/runs/44382449397) passed TypeScript/check, 505 Vitest tests/74 files, 62 Node tests/9 files and three Worker dry-runs. Production release [44383000092](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092) passed paired deployment and root/health, BRVIN binding, Fatman retrieval and release-acceptance checks. `parmar-ai` version `393f0844-3f65-4275-90b1-f6d5cca4f2d3` and `brvin-service` version `d43a9f7b-32b3-486f-9845-75ed11811165` are at 100% traffic; artifact [14464228113](https://github.com/ashini-x/parmar-ai/actions/runs/44383000092/artifacts/14464228113).

Only the live Owner acceptance journey remains. M4.4 is still unimplemented and must separately add manifest-selected prompt loading and per-conversation pinned repository/branch/commit snapshots.

## 2026-11-19 architecture amendment — central hub and AI collaboration

The canonical role split, exchange artifact lifecycle, project hierarchy, permissions, collaboration example and implementation/report contracts are specified in [OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md](OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md). This amendment supersedes the earlier assumption that each project owns a separate GitHub repository.

One private `owner-memory-hub` holds multiple projects. Projects may contain workstreams and optional features. A project may reference multiple source-code repositories, but no source code is copied into the hub. During the M4.3 transition, the existing flat topic model can attach multiple topics to the same hub repository with unique memory-root paths. M4.4 adds stable hierarchical IDs, versioned manifests, exact pinned hub snapshots and scoped loading.

Gemini Owner Intelligence is the architect/planner/reviewer and curator of approved documents. ChatGPT Software Engineer, through separate Owner-authorized GitHub/deployment connections, is the code/test/PR/merge/deploy executor after the Owner approves an implementation brief. The Owner alone accepts decisions and authorizes work. GitHub is a document-mediated exchange layer; there is no automatic wake-up, private transcript exchange or self-approval.

Preserve the original M4.1 200,000-token cumulative conversation budget unchanged. The M4.6 Cloudflare Owner Context Replicator still owns the quadratic-growth fix: one complete per-request budget B, exact CountTokens of the final prompt, selective project/workstream/collaboration memory and historical D1 retrieval, per-request input ≤ B and aggregate prompt input ≤ N × B = O(N) for fixed B. Collaboration artifacts are included in B, not given a separate context allowance. All seven Owner scenarios already recorded in this architecture remain acceptance requirements.

M4.3's strict branch-head Conflict behavior remains in force until path-aware multi-writer preconditions are implemented. Future unrelated-path rebasing must verify all touched-file and governing-manifest blob SHAs, use bounded retries and a non-force ref update. Same-path or manifest conflicts require review. No application code, new repository, hierarchical loader or collaboration automation is created by this architecture amendment.
