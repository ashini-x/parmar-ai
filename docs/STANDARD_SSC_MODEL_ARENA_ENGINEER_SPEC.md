# Standard SSC Model Arena — Arena Engineer specification

**Status:** Approved direction; documentation complete; implementation not started  
**Checkpoint:** 2026-11-21 IST  
**Repository:** ashini-x/parmar-ai  
**Scope:** Isolated Model Arena staging Worker only  
**Feature name:** Arena Engineer  
**UI action:** Engineer

This document is the detailed product and engineering specification for adding a separate Gemini-powered engineering analysis agent to the Standard SSC Model Arena. It describes future behavior, not shipped functionality. The current Arena remains stateless until the persistence work in this specification is implemented and accepted.

## 1. Purpose and intended outcome

The existing Arena generates two answers to the same Standard SSC question: the Vertex AI baseline and a selectable FreeModel candidate. A separate on-demand Gemini blind judge compares the anonymous outputs and returns a weighted scorecard.

Arena Engineer extends that evaluation loop:

1. Generate the Vertex and FreeModel answers.
2. Persist the benchmark run in the dedicated Arena staging database.
3. Run the existing blind judge without changing its rubric or behavior.
4. Persist the completed judge scorecard against the same run.
5. When FreeModel loses to Vertex and the judged result is durably saved, enable the owner-only Engineer action.
6. On an explicit click, call a separate Gemini engineering-analysis agent.
7. Save the engineering report and a detailed implementation-ready prompt for a coding agent.
8. The owner reviews and copies that prompt into a repository-aware coding agent. The coding agent inspects the actual repository, implements a validated change, and returns to the Arena for a new comparison.

The intended loop is:

**Benchmark → Persist → Blind Judge → Persist Scorecard → Engineer → Review Diagnosis → Copy Coding-Agent Prompt → Implement Separately → Benchmark Again.**

The feature should help FreeModel improve speed, answer quality, routing, reliability and architecture based on observed evidence. One run does not prove a general model weakness or guarantee that FreeModel can beat Vertex. Subsequent benchmarks must measure whether a proposed change actually helped.

## 2. Product boundary and naming

- Product surface: existing Standard SSC Model Arena in the private admin dashboard.
- Button label: **Engineer**.
- Agent/report identity: **Arena Engineer**.
- Generated handoff section: **Coding-Agent Implementation Prompt**.
- Engineer is an independent second-stage Gemini call with its own system instruction, request validation, output schema, model configuration, timeout and error handling.
- Engineer is not part of the blind judging request, does not vote on the winner, cannot revise scores and never runs automatically.
- Engineer may know which side is Vertex and which side is FreeModel because its purpose is post-judgment diagnosis. The blind judge must remain blind and unchanged.
- “Independent” means a separate agent invocation and analytical role, not a claim of statistically independent truth. Prefer a different, stronger supported Gemini reasoning model when available; verify availability and permissions rather than guessing a model ID.
- Initial scope is owner/admin-triggered analysis of a saved run where FreeModel underperforms. Do not add autonomous code changes, repository writes, PR creation, deployment or production mutation.

## 3. Exact activation rules

### 3.1 Required preconditions

Engineer may be enabled only when all are true:

1. Both candidate-generation outcomes and the original question are saved in an Arena run record.
2. The blind judge completed with a valid scorecard.
3. The full judge result and weighted overall scores were successfully written to the same durable run record.
4. The run can be loaded by its opaque ID through an authenticated same-origin admin request.
5. The saved record uses a supported schema and environment.

A browser-held scorecard, successful HTTP response without a successful D1 write, or unsaved result is not sufficient. The UI must never enable Engineer on optimistic client state alone.

### 3.2 When FreeModel loses

The primary activation condition is a judged, persisted result where Vertex is the winner and the weighted FreeModel score is lower than the Vertex score. Implementation must use the saved provider-side mapping and weighted scores, not assume a fixed anonymous A/B order.

Also allow Engineer when FreeModel generation failed but Vertex completed and the judge saved an evidence-backed result identifying the failure. This allows diagnosis of routing, timeout, rate-limit, fallback and provider integration failures as well as answer-quality losses.

### 3.3 When Engineer is unavailable

- Judge was not run.
- Judge failed, timed out or returned an invalid scorecard.
- Judge result has not been durably saved.
- Both candidates failed and no meaningful comparison exists.
- FreeModel won or the result is tied under the current judge policy. For v1, hide or disable Engineer by default. A future explicit “analyze anyway” option is outside scope.
- Required evidence is missing or fails integrity/size validation.

The current judge reports a tie when weighted overall scores differ by 4 points or less. Reuse the saved judge winner and score calculation; do not invent a second scoring policy for the Engineer action.

## 4. Existing implementation facts to preserve

At the 2026-11-21 checkpoint:

- Arena lives in the existing admin dashboard and uses the production Standard SSC prompt builder and shared AnswerPacket validation.
- Vertex AI/Gemini is the baseline; FreeModel is the candidate.
- Both candidate calls run in parallel and receive the same production-built user prompt. Vertex can additionally use configured Google Search grounding for eligible current-fact prompts; FreeModel has no equivalent search tool attached. Engineer must account for this benchmark asymmetry when relevant.
- Candidate generation is POST /admin/api/arena/run. It returns provider results, prompt metadata and persistence: stateless.
- Blind judging is a separate explicit POST /admin/api/arena/judge. It receives question, recent conversation and validated candidate packets, then returns the judge output with persistence: stateless.
- The blind judge uses Gemini 3.8 Flash, HIGH thinking, a 60-second inference timeout after OAuth token acquisition and an 8,192 max output-token budget.
- The blind rubric is fixed at accuracy 30%, relevance 20%, completeness 15%, SSC fit 15%, clarity 10%, and AnswerPacket/Telegram format 10%.
- The blind judge randomizes Candidate A/B, excludes provider/model identity and candidate operational metrics from its prompt, and maps results back to Left/Right after scoring.
- FreeModel output includes headline latency, model latency, router/failover latency, token metrics, model used and failover model details where available. Vertex provides its own latency, token, model and estimated-cost information.
- Arena cost figures are estimates, not provider invoices.
- The isolated Worker is parmar-ai-arena-staging, uses wrangler.arena-staging.jsonc and has a dedicated D1 binding named DB.
- Dedicated staging D1: parmar-ai-arena-staging, ID 30df9bf6-e852-4f15-8fd7-43bd96cb1cdf.
- The staging route guard exposes only /admin and /admin/* when ENVIRONMENT is staging.
- Current Arena runs and judge results are not persisted to D1, KV, Durable Objects or Queues. Browser session turns and local votes/export are client-side.
- PR #407 is merged and its isolated staging deployment was verified at Worker version 14 with 100% traffic. The new judge budget is deployed, but a successful real post-change scorecard has not yet been confirmed in the recorded handoff checkpoint.

Treat these facts as the starting point only. The next chat must re-inspect main, recent PRs/workflows and live Cloudflare state before coding.

## 5. Persistence design — required foundation

A key prerequisite is replacing the current stateless-only comparison flow with durable staging-only run records. The owner wants judging to finish and the data to be saved before Engineer can be clicked. This must be enforced by the backend, not merely by a UI condition.

### 5.1 Database boundary

Use only the already dedicated staging D1 binding in wrangler.arena-staging.jsonc. Do not use the production DB binding or any production data store. Create a clearly isolated Arena staging migration directory and configure it explicitly in the Arena Worker config. The deployment workflow must apply only Arena staging migrations to the exact staging D1 database before deploying the staging Worker. Inspect existing Wrangler/D1 conventions before choosing the final directory and command.

Never point the Arena migration command at the production database. Add tests and workflow assertions that make the database target explicit. Keep schema changes out of the shared production migration sequence unless separately reviewed and explicitly required.

### 5.2 Suggested data model

Use a parent Arena run record and a child Engineer report record, or an equivalent normalized schema that preserves these invariants.

**Arena run record**
- Opaque random run ID (UUID or equivalent); never expose sequential database IDs.
- Creation/update timestamps, schema version and environment marker.
- Original question and bounded recent conversation needed to understand follow-up questions.
- Requested FreeModel target (Auto-Router or pinned model).
- Left and right generation outcomes, including validated AnswerPackets where present.
- Safe provider metadata: success/failure, safe error code/message, actual model ID, latency fields, token usage, estimated cost and estimate basis, grounding status, failover model IDs and prompt metadata where available.
- Production prompt-builder identifier/version or other safe provenance, without copying secret configuration.
- Run state such as generated, judged, judge_failed or persistence_failed.
- Complete saved judge result, weighted scores, winner, confidence and judge timing/usage where available.
- Created/updated time and optional expiry time.

**Engineer report record**
- Report ID and parent run ID.
- Request status: running, completed or failed.
- Model identifier and thinking configuration used.
- Creation/completion timestamps, latency, token usage and estimated cost when available.
- Validated structured diagnosis JSON.
- Complete Markdown coding-agent implementation prompt.
- Safe failure code/message if analysis fails.
- Report schema/prompt version for reproducibility.

Use foreign-key integrity where supported and indexes for recent-run history and run-to-report retrieval. Decide whether one report per run is sufficient or whether regeneration creates a new immutable report row; preserve previous successful reports rather than overwriting them if regeneration is supported.

### 5.3 Lifecycle and save semantics

Recommended lifecycle:

1. POST /admin/api/arena/run performs existing two-provider generation, validates/bounds the result and saves a run row with state generated. The response includes the opaque run ID and confirms the run is saved.
2. POST /admin/api/arena/judge accepts the run ID. The server loads the stored question, conversation and candidate packets from D1. Do not trust a browser-resubmitted answer packet as canonical evidence. The judge still receives randomly mapped anonymous candidates and no provider metadata.
3. After the judge returns a valid result, persist the full scorecard and weighted provider-mapped scores to the run row, then transition it to judged. Return persistence confirmation only after the D1 write succeeds.
4. If judging fails, preserve the generated run as judge_failed or generated-with-safe-error so it remains inspectable, but do not expose Engineer.
5. If Gemini judging succeeds but the D1 update fails, report “judging completed but result not saved”; do not enable Engineer. Provide a safe recovery/retry mechanism.
6. Engineer is invoked only with a run ID. The backend loads the saved judged record and verifies the activation condition again.
7. Save the Engineer report and coding-agent prompt before returning a completed state. A lost browser response must not produce duplicate untracked reports; use an idempotency/concurrency strategy.

An alternative endpoint sequence is acceptable only if it preserves the same trust boundary: the backend owns the persisted canonical run and judge data, and Engineer consumes only that persisted record.

### 5.4 Data minimization and retention

- Store only context required to reproduce and diagnose the benchmark. Never store secrets, access tokens, API keys, cookies, service-account JSON, private keys or arbitrary environment dumps.
- Treat the question and conversation content as owner-supplied benchmark data that may still contain personal information. Keep the dashboard admin-only and provide no public read path.
- Bound question, conversation, AnswerPacket and combined serialized-record sizes. Check D1 row and request constraints in implementation; reject oversized payloads safely.
- Provide a way to inspect and delete saved Arena runs/reports from the admin UI, with a clear confirmation for destructive deletion.
- Proposed v1 retention: 90 days for Arena benchmark records and generated reports, with explicit manual deletion available sooner. Implement deterministic expiry cleanup on a safe staging-only path; do not add a production cron or cross-environment cleanup.
- Display that records are staging benchmark data and estimated costs are not invoices.

## 6. Arena Engineer analysis contract

### 6.1 Invocation

- Add a new explicit same-origin POST route, for example POST /admin/api/arena/engineer, accepting only a saved run ID and a bounded idempotency key if required.
- Enforce admin session, same-origin/CSRF protection, ENVIRONMENT === staging and dedicated D1 access.
- Server loads the saved run and judge record. Do not accept canonical scores, outputs or provider labels from the browser.
- Run only on explicit owner click. Never execute automatically after judging.
- Keep Engineer separate from the blind judge endpoint. Never add engineering instructions to the blind judge prompt or change its scoring weights, randomization, labels or tie policy as part of this feature.

### 6.2 Gemini model and request policy

- Use Vertex AI/Gemini through the existing Google authentication helper and staging Google project.
- Give Engineer its own configurable model selection, such as an Arena Engineer model setting, rather than hard-coding the blind judge model. At implementation time inspect supported model availability and project/location permissions. Prefer a distinct strong reasoning model when actually available; do not guess a model ID or silently fall back to an unapproved provider.
- Configure high reasoning and a separate output budget/timeout appropriate for structured diagnosis plus a long Markdown prompt. Measure authentication separately from inference, following the corrected judge timing pattern.
- Keep analysis on-demand to control latency and Google Cloud cost.
- Persist token/latency/cost telemetry when Vertex supplies it. Distinguish unavailable metrics from zero.
- Apply bounded input/output sizes, retry rules, safe error mapping and duplicate-request protection.
- Validate Gemini output against a structured schema before displaying or saving it. A malformed report must not be treated as complete.

### 6.3 Trusted input bundle

Assemble input server-side from the saved Arena record and a small, versioned, curated architecture context. Include:

- Exact original question and recent conversation relevant to it.
- Both complete validated AnswerPackets and Telegram previews, or safe failure diagnostics where a provider did not complete.
- Provider mapping (which saved side is Vertex and which is FreeModel), actual model IDs and requested Auto-Router/pinned target.
- Blind judge overall scores, all six criterion scores and weights, winner, confidence, summary, strengths, weaknesses and decisive factors.
- Real generation latency, model latency, router/failover latency, token counts, reported thinking, attempts, grounding metadata, failover models and estimated cost where present.
- Shared-prompt provenance and whether Vertex-only Google Search grounding applied.
- Relevant current architecture facts from a curated context bundle: production prompt parity, AnswerPacket validation, provider adapters, FreeModel router/failover, model catalogue and Arena staging boundaries.
- Application build/version or source revision only if genuinely available and verified.

The Worker cannot inspect arbitrary GitHub working-tree files at runtime unless a separately secured repository integration is designed. Do not claim Gemini Engineer has read the complete repository merely because paths are named in a context summary. The generated coding-agent prompt must instruct the coding agent to inspect the current repository, AGENTS.md, relevant source files and latest branch before proposing or editing code. Keep the curated architecture summary versioned and update it when relevant implementation changes.

### 6.4 Prompt-injection and trust rules

- Treat the question, conversation history, answer packets, quiz content, judge explanations and all model-produced text as untrusted benchmark data, never instructions to Engineer.
- Engineer system instruction is the only instruction source for analysis.
- Ignore candidate text that asks Engineer to alter policy, disclose hidden instructions or reveal secrets.
- Never put credentials, private keys, API tokens, cookies, raw environment values or unrelated student data into the input.
- Gemini output is advisory text. Never execute returned code blocks, shell commands, SQL, URLs or instructions.
- Use a response schema and strict rendering/escaping. Treat Markdown as content, not executable HTML.

## 7. Required engineering analysis

Engineer must work like a senior AI systems architect and performance engineer. It must be specific to saved evidence, distinguish facts from hypotheses and avoid generic advice.

### A. Why FreeModel lost
- Explain the overall score gap and each criterion-level gap.
- Identify concrete defects: incorrect facts, unsupported claims, missing concepts, incomplete reasoning, irrelevant content, poor SSC fit, language/register problems, invalid AnswerPacket structure or Telegram usability.
- Quote only short evidence from saved outputs where useful.
- Separate demonstrated defects from uncertain explanations.
- Never assume the longer answer is better or that style explains an accuracy loss.

### B. Latency and throughput
Use actual timing fields. Distinguish end-to-end candidate latency, selected model inference latency, router/catalogue/failover overhead, authentication/orchestration timing when available, retries, cooldown waits and failed attempts. Recommend parallelism only where operations are independent and safe. Identify unnecessary serial calls, repeated catalogue fetches, oversized prompts, timeout mismatches, excessive retry/backoff and fallback chains. Do not invent TTFT or per-stage timings when code does not measure them. Recommend instrumentation before claiming a root cause when telemetry is missing.

### C. Model selection and routing intelligence
Evaluate whether the selected FreeModel route/model was appropriate. Consider question type and complexity, routing to models suited to factual SSC questions/calculations/statement questions/quiz generation/follow-ups, model health, JSON-mode support, context/output limits, rate limits, latency, primary/fallback ordering, cooldown behavior and deterministic fallback when routing metadata is incomplete. Do not recommend a global default based on one sample. Request repeated benchmark evidence or a controlled model comparison before a global routing change.

### D. Prompt and AnswerPacket quality
Inspect how the shared production prompt interacts with the FreeModel adapter. Consider concise but complete answers, factual verification, calibrated uncertainty, SSC level, language consistency, response-mode and quiz validity, JSON/schema compliance, token efficiency and prompt conflicts. Preserve the student-facing answer contract unless a backward-compatible improvement is demonstrated and regression-tested.

### E. Reliability and architecture
Consider rate limits, transient errors, malformed responses, retry/backoff, cooldown, timeout budgets, safe fallback, parallel execution, request cancellation, provider isolation, safe observability and caching only where correctness and user isolation are preserved. Never recommend bypassing validation, weakening auth, leaking provider identity to the blind judge or changing unrelated production infrastructure.

### F. Prioritized plan
Every recommendation includes:
- Problem statement.
- Observed evidence and exact source field/output supporting it.
- Confidence: high, medium or low.
- Proposed fix and affected subsystem.
- Expected benefit, qualitative unless measured evidence supports a number.
- Quality, latency and cost trade-offs.
- Implementation effort.
- Regression/security risk.
- Concrete acceptance test.

Priorities:
- **P0:** correctness, broken requests, serious reliability or security defects.
- **P1:** high-confidence quality/routing/latency improvements with meaningful impact.
- **P2:** advanced optimizations with good evidence but lower immediate impact.
- **P3:** exploratory opportunities requiring separate benchmark/proof.

Do not invent “30% faster”, “10 points more accurate” or cost-saving promises. State hypotheses and how to verify them.

## 8. Generated coding-agent prompt — mandatory output

The report must contain a complete copyable Markdown prompt suitable for Codex, Claude Code or another repository-aware coding agent. It must include:

1. Mission and measurable objective: improve FreeModel relative to Vertex on the identified failure mode.
2. Exact Arena run ID and benchmark evidence, provider/model identity, scores, outputs, failures and real telemetry.
3. Evidence-based diagnosis and confidence labels.
4. Proposed P0/P1/P2 changes, trade-offs and rejected alternatives.
5. Repository inspection instructions: read AGENTS.md and relevant docs; inspect current main/branch, tests, CI and deployment state; verify every proposed file/function against current code.
6. Explicit files/subsystems to inspect; never fabricate line numbers or claim files were checked when they were not.
7. Small, reversible implementation sequence.
8. Unit, integration, regression and Arena benchmark tests.
9. Acceptance criteria measuring correctness, quality, latency and cost without weakening the student-facing contract.
10. Production and data-safety boundaries.

The prompt must state:
- Treat Engineer analysis as a hypothesis until confirmed by source inspection and tests.
- Do not blindly apply every suggestion.
- Preserve the blind judge and use the same benchmark conditions for before/after comparisons.
- Use a representative multi-question benchmark set, not one question alone, before claiming FreeModel is better overall.
- Keep all Arena work in isolated staging Worker and dedicated staging D1.
- Do not deploy or alter production Telegram/student traffic, prompts, profiles, quotas, production D1, production secrets, queues or Durable Objects.
- Do not commit secrets or copy sensitive student/owner data into test fixtures.
- Do not claim victory without repeatable comparative evidence.

Provide a one-click copy action for the entire prompt. Keep structured diagnosis and implementation prompt independently viewable. If the prompt is too large for one UI block, provide a safe copy/download mechanism without truncation.

## 9. Report structure and UI

After successful analysis, present an owner-focused engineering workspace:

1. **Diagnosis summary** — winner, weighted score gap and key reason FreeModel lost.
2. **Evidence** — criterion scores, short candidate excerpts and measured metrics.
3. **Why FreeModel underperformed** — facts separated from hypotheses.
4. **Speed engineering** — measured latency decomposition and missing instrumentation.
5. **Intelligence and answer quality** — accuracy, completeness, SSC fit, reasoning and format.
6. **Routing and model strategy** — selected model/failover behavior and recommended logic.
7. **Architecture opportunities** — reliability, orchestration, caching and observability.
8. **Prioritized roadmap** — P0/P1/P2/P3 with expected benefit, confidence, risk and tests.
9. **Coding-Agent Implementation Prompt** — full copyable Markdown handoff.
10. **Run/report provenance** — saved run ID, report timestamp, model, thinking mode, latency, tokens and estimated cost.

UI behavior:
- Engineer visible/enabled only for eligible saved runs.
- Show a clear working state and prevent duplicate clicks.
- On completion change the action to **View Report**; allow retry only after failure, with idempotency/concurrency protection.
- Saved run history must reopen previous runs and Engineer reports after reload/new admin session.
- Include safe delete for a saved run and child reports, with confirmation.
- Provide separate copy controls for coding prompt and optionally full report.
- Maintain current dark/compact Arena visual language and responsive mobile layout.
- Never use browser localStorage as canonical report storage.

## 10. API and security contract

Inspect the existing protected /admin/api dispatcher and follow its established admin-session and same-origin/CSRF checks.

Suggested API surface (names may be refined to repository conventions):

| Operation | Suggested route | Purpose |
|---|---|---|
| Generate and save run | Existing POST /admin/api/arena/run | Generate both sides and persist a generated record |
| Judge saved run | Existing POST /admin/api/arena/judge | Load candidate packets by run ID, judge blindly, persist scorecard |
| List saved runs | GET /admin/api/arena/runs | Bounded, paginated owner-only history |
| Load saved run | GET /admin/api/arena/runs/:id | Load run, judge and report metadata |
| Run Engineer | POST /admin/api/arena/engineer | Analyze persisted eligible run ID; save report |
| Delete saved run | DELETE /admin/api/arena/runs/:id | Delete run and associated reports after confirmation |

Requirements:
- Every API route is admin-session protected, state-changing requests are same-origin checked, and every route is staging-only.
- Fail closed when ENVIRONMENT is not staging, D1 is absent, schema is unsupported or run is not accessible.
- Use parameterized D1 statements; bound IDs and payloads; reject malformed JSON and oversized inputs.
- Do not accept client-supplied scores/outputs as canonical Engineer inputs.
- Avoid sequential IDs and raw database error leakage.
- Use idempotency and a run-level lock/status transition so concurrent Engineer clicks cannot create duplicate paid calls.
- Validate saved JSON/schema versions before use.
- Do not log raw question/answer content, tokens, keys or full Gemini prompts. Log safe request IDs, run IDs, stage and sanitized error codes only.
- Keep staging D1 table namespace and migration path isolated from production migrations.
- Do not change production route guard, Telegram behavior, production D1, secrets or student runtime.

## 11. Acceptance criteria

Do not close the feature until applicable checks pass.

### Persistence
- A generated run receives an opaque ID and is saved to dedicated staging D1.
- A page reload does not lose saved runs/results.
- Judge result is persisted before UI considers the run judged.
- Failed persistence never exposes enabled Engineer.
- Saved runs can be loaded and inspected later.
- Deleting a run deletes report records and prevents future Engineer calls for that ID.
- Retention cleanup is bounded, deterministic and staging-only.

### Judge isolation
- Blind judge still receives randomized anonymous candidates.
- Provider IDs, models, metrics and side labels remain excluded from judge prompt.
- Six weights, four-point tie rule, current model, HIGH thinking and timeout/output-budget corrections remain unchanged unless a separate evidenced task is approved.
- Engineer cannot mutate a judge result.

### Engineer
- Engineer accepts only eligible persisted run IDs.
- Backend reloads canonical data from D1.
- Engineer uses its own Gemini call, prompt and response schema.
- Candidate text and question are untrusted data.
- Report and prompt are validated, saved and reopenable.
- Concurrent/repeated clicks do not create uncontrolled duplicate calls.
- Errors are safe, visible and retryable without falsely marking a report complete.
- Test proves Vertex win enables Engineer and FreeModel win/tie, missing judge or unsaved result does not.

### Prompt quality
- Prompt contains evidence from selected run, actual available metrics and exact rubric breakdown.
- Missing metrics are labelled unavailable, never represented as zero.
- Diagnosis distinguishes observed facts from hypotheses.
- Recommendations are actionable, prioritized and include tests/trade-offs.
- Prompt tells coding agent to inspect current repository instructions and source before implementation.
- No fabricated file names, line numbers, benchmark results, cost savings or speedup claims.

### Staging and production safety
- Automated tests cover staging-only guards and unauthorized/cross-origin requests.
- Dedicated Arena D1 migration and deploy workflow target only parmar-ai-arena-staging.
- Arena deploy push trigger remains limited to Arena implementation/config/workflow paths; docs-only changes must not deploy a Worker.
- CI includes typecheck, Vitest, Node tests, formatting where required and current dry-run builds.
- Production runtime classification passes and production deploy jobs remain skipped.
- No production runtime, Telegram behavior, student prompt, profile, quota, secret, D1 or queue changes.

## 12. Implementation sequence for the next chat

Follow this order, updating this spec, staging handoff and continuation prompt after every material implementation or acceptance milestone.

**E0 — Repository and live-state revalidation**
- Read AGENTS.md, this spec, current handoff, continuation prompt and docs/README.md.
- Inspect main, recent commits, open PRs, CI and Cloudflare staging version/config.
- Verify PR #407 version 14 is still deployed or record the current actual version.
- Do not use historical deployment facts as a substitute for live checks.

**E1 — Persistence foundation**
- Design isolated D1 schema and migration path.
- Persist generated benchmark runs with bounded safe payloads and opaque IDs.
- Add list/load/delete operations and browser history.
- Add tests before connecting Engineer.
- Keep all writes in dedicated staging D1.

**E2 — Durable blind judging**
- Change judge request to load canonical saved candidate data by run ID.
- Preserve blind randomization and rubric exactly.
- Persist completed scorecard and provider mapping.
- Gate UI state on confirmed D1 persistence.
- Add failure/retry/idempotency tests.

**E3 — Independent Arena Engineer backend**
- Verify chosen Vertex Gemini model and project/location support.
- Implement separate Engineer system instruction, input bundle, schema, timeout, output budget, auth/inference timing and safe error mapping.
- Load canonical evidence from D1.
- Validate, save and reopen report and prompt.
- Test failure cases and prompt injection.

**E4 — Engineer report UI**
- Add eligible-state action, progress, error/retry, report view, copy prompt and saved report access.
- Verify desktop/mobile and authenticated history.
- Do not add direct code-edit or deployment controls.

**E5 — Benchmark-led acceptance**
- Test at least one Vertex-winning run, one FreeModel-winning run, one tie/non-eligible run, a generation-failure run, and a judge/persistence failure path.
- Review diagnosis and prompt for accuracy, specificity and safe missing-data handling.
- Use a representative set for claims about general model superiority.

**E6 — Close and handoff**
- Update this spec's implementation status and change log.
- Update staging handoff, continuation prompt, docs index and affected code/operations references.
- Record PR/merge SHA, test workflow IDs, staging deployment ID/version, live verification and remaining owner acceptance.
- Clearly distinguish CI, merge, deploy, smoke test and real authenticated Engineer acceptance.

## 13. Documentation update discipline

After every material update, including design decisions, schema changes, endpoint changes, model/prompt revisions, tests, PR creation, merge, deploy and acceptance:

1. Update this specification with current status, decisions, changed scope and a dated change-log entry.
2. Update the staging handoff with verified implementation/deployment state and exact remaining task.
3. Update the continuation prompt so the next chat starts from the latest real checkpoint.
4. Update docs/README.md if document links, feature status or the starting point changes.
5. Update relevant code comments, tests, migration/runbook docs and changelog when behavior warrants it.
6. Never mark a milestone complete based on PR merge alone. Record test, deployment and authenticated acceptance separately.

## 14. Current status and decisions

| Item | Status at 2026-11-21 |
|---|---|
| Product concept | Approved direction |
| Feature name / button | Arena Engineer / Engineer |
| Separate Gemini agent | Specified; not implemented |
| Saved benchmark history | Required; not implemented |
| D1 schema/migrations | Not implemented; E1 |
| Judge result persistence | Not implemented; existing judge is stateless |
| Engineer report persistence | Not implemented |
| Engineer UI | Not implemented |
| Coding-agent prompt generation | Specified; not implemented |
| Acceptance tests | Specified; not implemented |
| Production impact | Prohibited |

### Confirmed design decisions

- Keep the current blind judge separate and unchanged.
- Engineer is a separate, explicit, on-demand Gemini call after a valid judge result is durably saved.
- Persist canonical benchmark data on the server in isolated Arena staging D1.
- Engineer consumes a saved run ID, not browser-supplied score/output JSON.
- Enable Engineer only when Vertex beats FreeModel by weighted score, or FreeModel fails while Vertex supplies usable judgeable evidence.
- Save the report and complete coding-agent prompt for later viewing/copying.
- Engineer is advisory and read-only. It never writes code, opens PRs, changes secrets or deploys.
- Use measured evidence; distinguish fact from hypothesis; make no fabricated performance promises.
- Keep implementation, persistence, tests and deployment isolated from live Telegram/student production.

### Open implementation details to verify, not assume

- Exact D1 migration directory and Wrangler migration command after inspecting current repository conventions.
- Best supported distinct Gemini model for Engineer in staging project/location.
- Exact output schema and maximum prompt/report sizes after measuring representative AnswerPackets.
- Whether v1 permits one report per run or immutable report history for each regeneration.
- Final UI placement/history layout after inspecting the current dashboard.
- Exact retention cleanup mechanism that remains bounded and does not require a production cron.

## 15. Change log

- **2026-11-21:** Initial detailed Arena Engineer specification approved as the next implementation workstream. Current Arena generation and judging remain stateless; no feature code has been written. Specification covers D1 persistence, post-judge eligibility, independent Gemini diagnosis, generated coding-agent prompt, staging-only safety and milestone-by-milestone documentation maintenance.
