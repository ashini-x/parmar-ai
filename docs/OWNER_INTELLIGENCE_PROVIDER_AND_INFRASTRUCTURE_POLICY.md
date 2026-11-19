# Owner Intelligence — Provider and Cloudflare Infrastructure Policy

**Status:** Approved architecture and operational reliability policy; runtime reliability implementation tracked in the corresponding M4.3 fix PR  
**Approved:** 2026-11-19 IST  
**Applies to:** Owner Gemini Intelligence in `ashini-x/parmar-ai`  
**Parent:** [Owner workspace roadmap](OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md)  
**Memory/context design:** [Memory and Context Architecture](OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md)  
**Collaboration:** [AI Collaboration Protocol](OWNER_INTELLIGENCE_AI_COLLABORATION_PROTOCOL.md)

## 1. Locked decision

### 1.1 One AI provider inside Owner Intelligence

**Google Gemini through Vertex AI is the sole AI provider for the Owner Intelligence runtime.**

- All Owner chat generation, CountTokens preflight, memory drafting, rollover/compaction drafting and any later model-backed Owner operation must use the approved Vertex AI adapter and the exact Owner-selected, server-verified Gemini model and supported thinking level.
- A memory draft is not a free background summarizer: it is a metered generation using the selected model/thinking level and the same conversation's M4.1 D1 token reservation/settlement ledger.
- Do not add Cloudflare Workers AI, another model provider, a second hidden summarizer/classifier/reranker, or automatic provider/model fallback.
- No silent model, thinking-level, API-surface, region or provider switch is allowed after an error. Surface the failure, preserve saved messages/drafts/job state and allow an explicit retry.
- M4.6 historical recall begins with Owner-scoped D1 FTS5/keyword retrieval. Embeddings, semantic reranking or another model-backed retrieval step are not prerequisites and require a separately approved design; any approved model-backed Owner operation must remain within the Google Vertex AI provider boundary and explicit token/cost accounting.
- BRɅIN context remains optional and off by default. The student-facing परमार्थAI flows and their existing Gemini usage are separate from the Owner workspace's scope and limits.

### 1.2 Cloudflare is the deterministic application/backend layer

Cloudflare Workers and D1 execute the application logic around Gemini; they do not provide Owner Intelligence inference.

Cloudflare responsibilities include Owner authentication and authorization, same-origin mutation checks, request validation, model selection enforcement, D1 transcript and usage persistence, the M4.1 reservation/settlement ledger, context selection/assembly, CountTokens orchestration, streaming transport, GitHub API access, conflict detection, commit/read-back verification, durable outbox state, retries and operational telemetry.

GitHub is the versioned destination for Owner-reviewed curated memory and collaboration artifacts. The Worker uses only its dedicated, least-privilege Owner Memory App credentials. ChatGPT Software Engineer is a separate, Owner-authorized engineering executor with separate credentials; it is not a runtime fallback provider and its connector credentials are never available to Cloudflare.

Do not provision Workers AI, R2, KV, Vectorize, AI Search, a new Queue or another Cloudflare product merely because it exists. Use the current Worker + D1 + existing Vertex REST/SSE adapter and D1 FTS5/keyword search first. A new resource requires a task-specific design, verified account availability, capacity/cost justification and explicit Owner approval.

### 1.3 Owner generation request reliability

- A Save-to-GitHub memory draft must verify only the exact Owner-selected model; it must not fan out fresh CountTokens probes across the entire model catalogue immediately before GenerateContent.
- Owner chat and model-backed memory generation have **no application-owned wall-clock generation deadline**. Streaming remains active while the Owner's client remains connected. The Stop control and an actual client disconnect still cancel the upstream request. A 60-second heartbeat refreshes the D1 reservation lease while the request is active; stale-reservation recovery expires it only after ten minutes without a heartbeat. A Worker crash/runtime restart stops heartbeats, so abandoned reservations remain recoverable. A network/provider failure, browser shutdown or process crash can still end a request; this is not a promise of an immortal connection.
- The Owner chat's per-turn output reservation is derived from the selected model's output ceiling and the remaining 200,000-token conversation budget. The former fixed 8,192-token chat reservation is removed. All registered Gemini 4 models (Hydrogen, Carbon and Argon) use the documented `v1beta1` long-decode continuation path when the funded Owner chat output allowance exceeds 65,536 tokens. Each follows every returned continuation token and streams visible text as segments arrive. Gemini 4 Carbon and Argon have 65,536-token streaming segments (their 32,768-token non-streaming direct-HTTP limit remains separate). The registered Gemini 3.x models use their full native 65,536-token output allowance; they do not use continuation tokens because Google documents long decode for Gemini 4, not Gemini 3. Each Gemini 4 segment repeats the original prompt, so D1 pre-reserves the prompt cost once per segment plus the complete output allowance before sending the first request. This keeps actual aggregate usage within the unchanged 200K conversation cap. Reasoning/thinking tokens count against `max_output_tokens` for the relevant models and can consume a segment before visible text appears.
- The separate memory-draft task remains purpose-bounded to 4,096 output tokens because it produces a concise editable Markdown delta, not a general chat answer.
- Control-plane checks remain bounded: Google access-token acquisition uses 12 seconds and the Count Tokens availability/preflight probe uses 8 seconds. They happen before generation and are not deadlines on an accepted Gemini answer.
- Only an explicit initial HTTP 429/RESOURCE_EXHAUSTED capacity rejection may be retried (maximum three stream-open attempts, or the existing bounded non-stream retry path) with truncated exponential backoff and jitter. Never replay an accepted stream, a 408/5xx response, a timeout from the provider/network, or a lost connection because the provider may already have generated and billed the request.
- If a completed response contains no visible text, preserve the provider's finish reason and usage metadata. Settle the D1 reservation using actual reported `totalTokenCount` when available; use the reserved estimate only when the provider did not return usable usage metadata. Surface `MAX_TOKENS` distinctly, because the model may have spent its output allowance on reasoning before producing user-facing text.
- A definitive validation, authentication, model-not-found or capacity rejection (400/401/403/404/429) releases the unused D1 token reservation. A lost connection or ambiguous server failure remains conservatively accounted when exact provider usage is unavailable.
- A 429/RESOURCE_EXHAUSTED response must be diagnosed before changing Cloud billing or quotas. It can mean project/model quota exhaustion or temporary shared serving capacity (DSQ). A quota increase helps only when the applicable quota metric is actually exhausted; it does not create shared model capacity. Prefer the global endpoint when supported by the selected model; do not silently change the configured location. See Google's [429 troubleshooting guidance](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deploy/error-code-429).

- The shared Worker's existing `VERTEX_TIMEOUT_MS=25000` and `MAX_OUTPUT_TOKENS=1200` settings remain scoped to the separate student/bot `src/ai/gemini.ts` request path. Owner Intelligence calls its dedicated `src/admin/intelligence-provider.ts` adapter and does not read either setting. Do not remove or relax the student-path settings as part of Owner generation work; this deployment intentionally preserves them.

### 1.4 Non-negotiable accounting and reliability boundaries

- Preserve M4.1's exact **200,000 cumulative tokens per conversation**, CountTokens preflight, atomic D1 reservation, selected-model/API output ceiling, usage settlement, concurrency controls and read-only hard lock. This is distinct from model context-window limits, per-request budget B, Google quotas and billing.
- No provider can supply literally unlimited output. All registered Gemini 4 models support a 1,048,576-token unified input/output ceiling and long decode through `v1beta1`; each streaming foreground segment is limited to 65,536 tokens. The registered Gemini 3.x models retain their provider maximum of 65,536 output tokens per request and do not use the Gemini 4 continuation loop. The effective Owner maximum is always lower where necessary to reserve repeated prompt cost and total output inside the remaining 200,000-token conversation budget. Google model/API constraints, network/provider failures, browser disconnects and Worker runtime interruptions still apply.
- M4.6's per-request input budget B is separate. Project memory, retrieved D1 history, recent turns, collaboration artifacts, instructions and the current turn all share one exact selected-model/API-specific B and final Vertex CountTokens measurement.
- D1 remains the canonical full transcript, token ledger and Owner memory-job/outbox store. Do not make Queue messages or Workflow instance state the only copy of a job or handoff.
- Normal chat turns do not silently write to GitHub. GitHub operations happen only through an explicit Owner action/approval and the reviewed memory workflow.
- Background work that needs durable retry must be idempotent and recoverable from D1. Queue/Workflow delivery is transport/execution, not the source of truth.

## 2. Cloudflare Free-plan baseline

**Owner-confirmed account plan:** Workers Free as of 2026-11-19 IST. This is the plan supplied by the Owner; the exact live account usage, billing configuration and remaining headroom have not been inspected as part of this documentation change.

The following published values were checked against Cloudflare's official documentation on 2026-11-19. They are planning references, not a measurement of this account. Quotas and prices may change; re-check the linked documentation and the actual dashboard immediately before M4.6 capacity approval.

| Service | Workers Free baseline | Workers Paid reference |
|---|---|---|
| Workers | 100,000 requests/day; 10 ms CPU time per HTTP request; 50 subrequests/request | $5/month minimum account subscription; 10M requests/month included, then $0.30 per additional million; 30M CPU milliseconds/month included, then $0.02 per additional million; 30 seconds default CPU per invocation, configurable up to 5 minutes |
| D1 | 5M rows read/day; 100K rows written/day; 5 GB storage/account; 500 MB maximum per database; 50 D1 queries per Worker invocation | 25B rows read/month and 50M rows written/month included before overage pricing; 5 GB-month included storage; 10 GB maximum per database; 1,000 D1 queries per Worker invocation |
| Queues | 10,000 operations/day; 24-hour message retention, not configurable on Free | 1M operations/month included, then $0.40 per million; 4-day default retention, configurable up to 14 days |
| Workflows | 3,000 steps/day; 10 ms CPU time per step; 1 GB-month storage; completed instance state retained 3 days by default; maximum 100 concurrent instances | 500,000 steps/month included, then $0.80 per additional 100,000; 1 GB-month included storage; 30 seconds default CPU per step, configurable up to 5 minutes; 7-day default completed-state retention, configurable up to 30 days; maximum 50,000 concurrent instances |

Important interpretation:

- Workers Paid is not a single unlimited bundle. The $5 is the minimum Workers Paid account subscription. Requests/CPU over the included amount are metered; D1, Queues and Workflows have their own usage dimensions and charges.
- A paid request allowance of 10M/month is included usage, not a reason to assume all workloads are free or that every other service is unlimited. Configure and verify spending limits/alerts before enabling metered overages.
- D1's published single-database execution model remains single-threaded on either plan. Paid quotas do not remove query latency, schema/index design or per-database throughput considerations.
- Free daily allowances are shared with existing workloads in the Cloudflare account. Do not attribute the full account allowance to Owner Intelligence or infer headroom from a Worker-specific request count.
- D1 Free daily row-read/write limits are enforced: after an account exceeds either daily limit, queries fail until the reset at 00:00 UTC. A D1 failure can interrupt Owner chat persistence and unrelated applications sharing the account.
- Queue messages on Free expire after 24 hours. Retries and each read/write/delete operation consume operations. Workflow instance state has a finite retention period too. Neither Queue nor Workflow state is the durable record of an Owner task.

Official references (checked 2026-11-19):
- [Workers pricing and plan inclusions](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers account and CPU limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/workers/platform/pricing/#d1)
- [D1 limits and single-database concurrency](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 Free daily-limit enforcement](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)
- [Queues pricing and message retention](https://developers.cloudflare.com/queues/platform/pricing/)
- [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Workflows pricing and retention](https://developers.cloudflare.com/workflows/reference/pricing/)
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)

## 3. Capacity and upgrade policy

Do not upgrade Cloudflare solely because M4.6 is planned, and do not assume Free is sufficient merely because Owner usage is expected to be occasional.

Before implementing M4.6, complete **M4.6-P0 — Cloudflare capacity and durability readiness**:

1. Confirm the account's actual Workers plan, billing status, spending-limit/alert settings and which production services share its quotas.
2. Capture account-wide and per-Worker request counts, CPU time/invocation distribution, errors/subrequest usage and peak-day patterns.
3. Capture D1 rows read/written, storage, database size, query latency and the high-cost queries/index coverage for the databases Owner Intelligence will use.
4. Capture Queue operations, retry/DLQ volume and expiry risk; capture Workflow invocations, steps, storage, retention and concurrency if those products are proposed.
5. Benchmark the expected Owner flows (ordinary turn, preview/save, context build, historical recall, rollover and recovery) against the actual Free limits. Include existing student/BRɅIN and other production workloads in the account-wide forecast.
6. Verify that D1 outbox records can recover/re-enqueue work after Queue message expiry, consumer failure, deployment or Workflow state expiry. A scheduled reconciler or equivalent recovery mechanism must be designed and costed before relying on asynchronous delivery.
7. Record a capacity decision: stay on Free with measured headroom and tested recovery, or recommend Workers Paid with a bounded cost estimate and spending controls. The Owner approves any plan change or new resource provisioning.

Upgrade evaluation is required when measurements show an existing or forecast workload will exceed a Free limit, repeatedly approach the chosen operating headroom, hit the 10 ms Worker/Workflow CPU ceiling, or cannot meet durable-job recovery/retention requirements within Free limits after code/query optimization. Do not solve quota exhaustion by silently dropping work, reducing transcript fidelity, disabling accounting, using a different AI provider or weakening security.

The upgrade decision must separately estimate Workers request/CPU, D1 row/storage, Queue operation, Workflow step/storage and any other product charges. A $5 base subscription is not a guaranteed all-in monthly cap. Set a spending limit only after understanding that Cloudflare documents it can block new invocations across Workers when the configured threshold is reached.

## 4. M4.6-P0 acceptance output

M4.6-P0 is a documentation/measurement and decision gate, not an application feature or automatic upgrade. Its accepted output is a dated capacity report containing:

- Confirmed plan and billing controls.
- Account-wide workload inventory and 7/30-day usage baseline where available, including peak-day values.
- Worker CPU/request and per-request subrequest measurements for representative Owner operations.
- D1 row-read/write/storage/query-latency baseline and index/query review.
- Queue and Workflow limits/usage/retention analysis for any proposed resources.
- A recovery test/design showing that D1 outbox state survives and can re-dispatch after transport or workflow retention expiry.
- Cost projection for expected Owner usage on Free and Paid, including service-specific overages and spending controls.
- Explicit Owner decision: proceed on Free, optimize first, upgrade, or revise the resource design.

No new Cloudflare binding, namespace, database, Queue, Workflow, R2 bucket, KV namespace, Vectorize index, AI binding or provider is provisioned by M4.6-P0 itself.

## 5. Change control

This policy applies only to Owner Gemini Intelligence and does not alter student-facing परमार्थAI/BRɅIN architecture, provider usage or quotas. Any proposed change to the single-provider decision, model/API fallback, Cloudflare AI product usage, D1 authority, 200K budget or infrastructure provisioning requires a separate written proposal and explicit Owner approval.

Update this policy, the roadmap, continuation prompt, memory/context architecture, collaboration protocol, test plan and documentation index whenever a material provider, plan, resource, limit or billing decision changes.
