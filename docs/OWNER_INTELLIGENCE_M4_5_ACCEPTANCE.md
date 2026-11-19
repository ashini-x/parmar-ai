# M4.5 — Automatic rollover and handoff acceptance

**Current status (2026-11-20 IST):** M4.5 is merged and production deployed. Automated CI, production release acceptance and read-only D1 schema verification passed. Authenticated Owner browser verification remains pending; do not close M4.5 until it passes.  
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

- Final reconciled PR head SHA: `f481d0141969d59dd562efe303d43c85d13d964b`.
- PR validation: [Release validation #44620484798](https://github.com/ashini-x/parmar-ai/actions/runs/44620484798) succeeded on the reconciled head.
- Post-merge main commit: `a712a69cc46b5d9c4d249871a89e4084edd95b36`; PR [#375](https://github.com/ashini-x/parmar-ai/pull/375) merged.
- Production workflow: [Release validation #44620959101](https://github.com/ashini-x/parmar-ai/actions/runs/44620959101) succeeded.
- Automated validation: TypeScript passed; **522 Vitest tests / 76 files** passed; **62 Node tests / 9 files** passed; dry-run builds for `brvin-service`, `parmar-ai` and isolated `brvin-web` passed.
- `parmar-ai`: version `d3ce5347-b00d-45d7-88eb-7ef69322eedf`, deployment `5a19528f-83c6-4a68-83ed-14e531d8ad31`, **100% traffic**.
- `brvin-service`: version `feb592eb-7356-486f-a746-4116a1d7d182`, deployment `923dea74-a28c-4125-8ed9-b630bdd0e42f`, **100% traffic**.
- Production release smoke: root, health, BRVIN connectivity and Fatman source readiness passed. Release acceptance artifact: [14576848791](https://github.com/ashini-x/parmar-ai/actions/runs/44620959101/artifacts/14576848791). Source release artifact: `14577800205`.
- Production D1 `parmar-ai-admin-prod` (`1c033fb8-10aa-4bee-a294-4dbc899c09f7`) was inspected read-only. `owner_intelligence_conversations`, `owner_intelligence_handoffs` and `owner_intelligence_memory_jobs` exist. Both new owner-scoped lookup indexes and uniqueness autoindexes exist. The two schema queries reported 154 and 158 rows read respectively, **0 rows written**, and `changed_db=false`.

## Owner generation reliability correction — 2026-11-20

Before the authenticated rollover walkthrough, the Owner separately reported a Gemini stream ending with "Vertex AI completed without a text response." The code audit found an 8,192-token application chat-output reservation and an 8-minute application streaming timeout. The selected Gemini 4 Hydrogen model supports a 65,536-token single foreground output segment, and XHIGH reasoning tokens count against the output allowance. The generic parser error did not preserve `finishReason` or usage metadata.

A dedicated correction is being validated on branch `fix/owner-intelligence-response-limits`:
- Ordinary chat reserves the selected model's single-request maximum, bounded by the unchanged 200,000-token session balance.
- Application-owned 8-minute streaming and 90-second non-stream generation deadlines are removed. Stop/disconnect cancellation and bounded preflight checks remain.
- Empty-response errors retain `finishReason` and actual usage metadata; `MAX_TOKENS` is diagnosed explicitly and the D1 ledger settles reported usage when available.
- Provider ceilings remain. Gemini 4 Hydrogen's current streaming single-segment output ceiling is 65,536 tokens; the app does not claim infinite output or implement long-decode continuation.

Update this section with PR, CI, merge, production worker versions and release acceptance only after verified completion. The M4.5 200K per-conversation meter, 180K warning, 190K rollover threshold and rollover data invariants are unchanged.

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

**Automated closure gates:** current-head CI, PR merge, paired Worker production deployment/smoke, and read-only production D1 schema/index verification have all passed on 2026-11-20 IST.

**Remaining closure gate:** authenticated Owner browser acceptance is still pending. The Owner must hard-refresh `/admin/intelligence`, confirm the deployed welcome/sidebar appearance, then verify a safe eligible rollover journey if a conversation already meets the threshold without altering production usage to manufacture one. Confirm the original chat is read-only and intact, the linked successor begins at 0 / 200,000, the pinned snapshot and source provenance are retained, and the handoff appears in the new chat. Do not confirm the GitHub Save preview on the Owner's behalf. M4.5 remains deployed but in progress until this walkthrough is recorded.
