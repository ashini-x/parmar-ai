# M4.5 — Automatic rollover and handoff acceptance

**Status at creation:** implementation under review; production deployment and authenticated Owner verification are pending.  
**Milestone:** M4.5 — Automatic rollover and handoff  
**Repository:** `ashini-x/parmar-ai`  
**Implementation PR:** [#375](https://github.com/ashini-x/parmar-ai/pull/375)  
**Implementation branch:** `feat/m4-5-owner-intelligence-rollover`

## Approved behavior

- Warn at 180,000 cumulative tokens (committed plus in-flight reservation).
- Offer Roll Over at 190,000; no optional 195K urgency state was added.
- Preserve the source conversation, complete transcript, generation metadata and old 200,000-token ledger as read-only.
- Create exactly one linked successor with an independent zeroed 200,000-token budget.
- Preserve the selected topic and clone the source conversation's immutable active Project Memory snapshots and exact repository/branch/commit/file-blob provenance.
- Persist a deterministic, provenance-rich handoff in D1 containing the current goal, candidate Owner decisions, constraints, technical/file references, unresolved-state mentions, next action, source conversation ID and ordered source message IDs.
- Include the handoff as labelled untrusted reference data in the successor's UI and exact selected-model Vertex CountTokens / GenerateContent prompt.
- Persist a unique D1 `owner_intelligence_memory_jobs` rollover outbox row. GitHub Save is an explicit Owner-reviewed persistence path, not a prerequisite for opening the successor.
- Only set GitHub sync to Synced after the existing reviewed Save flow includes the full handoff Markdown file, confirms the commit and verifies exact file read-back. Strict branch-head Conflict behavior remains unchanged.

## Automated test coverage added

- Below-190K server-side rollover rejection.
- In-flight reservation refusal.
- Successful rollover at 190K.
- Source chat archived and successor linkage verified.
- Source transcript message IDs and old usage ledger remain unchanged.
- Fresh successor has an independent 200,000-token ledger with zero used/reserved.
- Active pinned Project Memory snapshot and blob provenance are cloned.
- Handoff contains source IDs and pinned commit provenance.
- D1 rollover job/outbox uses unique `rollover:<source-id>` idempotency key and begins `pending_review`.
- Retry returns the same successor and does not create a duplicate.
- Archived source message writes and model generation are rejected.
- Handoff is present in the exact Vertex CountTokens prompt for the successor.
- Existing 200K final-fill, over-budget and reservation-race tests remain in the suite.

## CI and production deployment

Fill these fields only from the final current PR head and corresponding workflow records.

- Final PR head SHA: pending
- PR validation workflow: pending
- TypeScript / Vitest / Node tests / three Worker dry runs: pending
- Merge commit: pending
- Production release workflow: pending
- `parmar-ai` Worker version/deployment: pending
- `brvin-service` Worker version/deployment: pending
- Production smoke/release acceptance artifact: pending
- Read-only D1 schema confirmation: pending

## Authenticated Owner acceptance — pending

After deployment, hard-refresh `/admin/intelligence` and verify:

1. Open an existing conversation in the 180K–189,999 used-plus-reserved range. Confirm the warning explains the remaining allowance and no Roll Over action appears yet.
2. Open a test conversation at 190K or above with zero in-flight reservation. Confirm Roll Over appears. Do not spend 190K production tokens solely to test this: deterministic local-D1 tests cover the exact threshold.
3. Use an eligible test conversation to roll over. Confirm the new successor opens and shows the handoff at the top; confirm the original remains in history as Rolled over and opens read-only with an Open successor action.
4. Confirm the selected topic/project and pinned project commit/file provenance remain attached to the successor, and its session meter begins at 0 / 200,000.
5. Confirm the handoff is labelled as historical reference material and Gemini can use it while continuing in the successor.
6. Confirm the GitHub Save preview includes the complete `handoffs/<date>-<successor-prefix>.md` file. Do not confirm a GitHub Save unless the Owner has reviewed the complete preview. Synced must follow commit and exact read-back, not merely preview creation.

Do not repeat M4.3 stale-preview conflict acceptance or M4.4 Project Memory attach/read acceptance. Do not modify production D1 usage rows to manufacture threshold evidence.

## Scope exclusions and invariants

- The 200,000-token cumulative per-conversation hard limit and existing CountTokens/reservation/settlement ordering are unchanged.
- Vertex AI remains the only Owner Intelligence inference provider. No hidden summarizer or model fallback was added; rollover handoff construction is deterministic.
- No Cloudflare Queue, Workflow, database, R2, KV, Durable Object, Workers AI or paid-plan resource was provisioned. The D1 handoff and memory-job rows are durable source records; M4.6-P0 remains the capacity/durability gate before M4.6.
- No student-facing परमार्थAI Telegram, BRVIN retrieval, model registry, IAM, billing, Google Cloud quota or location setting changed.
- No path-aware GitHub multi-writer rebasing was added. The existing branch-head Conflict check remains strict.

## Closure criteria

M4.5 can be closed only when current-head CI passes, PR #375 is merged, the paired Worker production release and acceptance checks pass, production D1 handoff/outbox schema is confirmed, and the authenticated Owner confirms the visible successor/read-only continuity journey. Until then, M4.5 remains in progress.
