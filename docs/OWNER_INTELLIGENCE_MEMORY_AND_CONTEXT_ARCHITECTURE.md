# Owner Intelligence — Memory and Token-Aware Context Architecture

**Status:** Approved design; not implemented  
**Approved:** 2026-11-18  
**Parent roadmap:** [OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md](OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md)  
**Continuation:** [OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md](OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md)  
**Scope:** Owner-only workspace in `ashini-x/parmar-ai`

## 1. Purpose and implementation boundary

Extend the deployed Owner Gemini chat so a project discussion can be saved, reopened after weeks, continued across independent chats, compacted safely, forked for experiments, and rolled over before the per-chat budget is exhausted.

This is a design specification, not a claim that these capabilities exist today. The current workspace still has manual Markdown checkpoints only. No GitHub runtime credential, topic selector, automatic memory sync, project-memory loader, rollover workflow, historical recall tool, compaction or chat fork is currently shipped.

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

GitHub stores concise Markdown that represents durable project knowledge, not a verbatim dump of every turn. Each project has an Owner-selected repository, branch and memory root. A suggested layout is:

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

Preferred approach: a dedicated GitHub App installed only on repositories the Owner chooses, with the minimum Contents read/write permissions required. Create short-lived installation tokens server-side. Keep the App private key and tokens in protected server-side configuration/storage; never return them to the browser, logs or prompts. Repository, branch and path access must be validated on every request against the recorded installation and Owner selection.

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

