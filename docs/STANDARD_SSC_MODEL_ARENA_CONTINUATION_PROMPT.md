# New-chat continuation prompt — Standard SSC Model Arena + Arena Engineer

Continue work in the Standard SSC Model Arena in ashini-x/parmar-ai. The immediate goal is to implement the approved **Arena Engineer** feature described in docs/STANDARD_SSC_MODEL_ARENA_ENGINEER_SPEC.md. This is the implementation session; the prior chat completed design documentation only.

## Mandatory first steps

1. Read AGENTS.md.
2. Read docs/STANDARD_SSC_MODEL_ARENA_ENGINEER_SPEC.md completely.
3. Read docs/STANDARD_SSC_MODEL_ARENA_STAGING_HANDOFF.md completely.
4. Read docs/README.md and this continuation prompt.
5. Inspect latest main, branches, PRs, commit history, CI/workflow runs and current source. Do not assume historical SHAs or deployment versions below are still current.
6. Re-check the live Cloudflare Worker parmar-ai-arena-staging: environment, workers.dev route, dedicated D1 binding, latest deployed version and secret binding names. Never retrieve, print or expose secret values.
7. Reconcile repository, GitHub Actions and Cloudflare facts. Record discrepancies in the handoff before coding.

## Current verified baseline at the documentation checkpoint — 2026-11-21

Repository: ashini-x/parmar-ai  
Latest main at checkpoint: f6b59c96f2fd7938277c81ca3be4319c679a1d0a (PR #407)  
Arena Worker: parmar-ai-arena-staging  
URL: https://parmar-ai-arena-staging.thenewtongs.workers.dev/admin/login  
Config: wrangler.arena-staging.jsonc  
Environment: staging  
Dedicated D1: parmar-ai-arena-staging  
D1 ID: 30df9bf6-e852-4f15-8fd7-43bd96cb1cdf  
Google project: project-90db7be4-619f-4ed7-89b  
Blind judge: gemini-3.8-flash, HIGH thinking  
FreeModel configured primary candidate: claude-sonnet-5-5

### Merged Arena PRs at this checkpoint

- #404 added the on-demand randomized blind Gemini judge and kept judging separate from candidate generation.
- #405 surfaced nested judge failure diagnostics.
- #406 fixed auth/inference timeout accounting, set a 60-second actual inference timeout and added path-filtered automatic staging deployment.
- #407 raised judge maxOutputTokens to 8,192 while preserving Gemini 3.8 Flash + HIGH thinking.

PR #407 merge commit: f6b59c96f2fd7938277c81ca3be4319c679a1d0a.  
Staging deploy run: #44894387927, success.  
Post-merge release validation: #44894387886, success.  
Cloudflare staging Worker version at checkpoint: 14, version ID c8154ec7-a1e3-4993-8ea2-636d85d6efbd, 100% traffic. Re-verify before relying on these historical facts.

**Important qualification:** CI, staging deployment and login smoke test passed. A successful authenticated scorecard after the PR #407 8,192-token fix has not yet been confirmed in the recorded checkpoint. Do not claim end-to-end judge acceptance until a real scorecard is observed.

## Exact product goal

Build a separate on-demand Gemini engineering-analysis agent named **Arena Engineer**, launched by an **Engineer** button after a completed blind-judged run has been durably saved.

The Engineer is not another judge. It must not alter winner, rubric, scores, randomization or candidate responses. The judge remains blind; Engineer runs afterwards and may know which side is Vertex and which side is FreeModel.

When Vertex beats FreeModel under the saved weighted score, or FreeModel fails while Vertex provides judgeable evidence, the owner can click Engineer. Do not enable it if judging failed, the scorecard was not durably saved, required evidence is missing, or FreeModel won/tied under the current judge policy.

Engineer uses a separate Gemini call, dedicated system instruction, response schema, model setting, timeout and output budget. It reads a canonical saved run from D1 and generates:
- Evidence-based diagnosis of why FreeModel underperformed.
- Speed/latency and router/failover analysis using actual telemetry only.
- Answer quality, accuracy, completeness, SSC fit and AnswerPacket analysis.
- Model selection and routing recommendations.
- Reliability and architecture improvements.
- A prioritized P0/P1/P2/P3 roadmap with confidence, trade-offs, effort and acceptance tests.
- A complete copyable Coding-Agent Implementation Prompt for Codex, Claude Code or another repository-aware coding agent.

Engineer is advisory and read-only. It must not edit repository files, access production infrastructure, create PRs, change secrets or deploy. The generated coding-agent prompt must require the coding agent to inspect the actual repository and verify recommendations before implementing them. One run is not proof of general superiority; use repeatable multi-question benchmark evidence before claiming FreeModel is better overall.

## Critical architectural fact: current Arena is stateless

At the documentation checkpoint, POST /admin/api/arena/run and POST /admin/api/arena/judge both explicitly return persistence: stateless.

The run handler generates both sides and returns candidate outputs to the browser. The judge handler receives the question/context and candidate packets from the browser. Neither handler stores the run or scorecard in D1.

Do not build Engineer on browser localStorage or trust client-supplied scores/answer packets. E1 and E2 must establish canonical persistence before Engineer is implemented.

## Required staging-only boundaries

- All Arena code, D1 records, migration scripts, tests, history and reports belong to parmar-ai-arena-staging.
- Use only dedicated Arena D1 ID 30df9bf6-e852-4f15-8fd7-43bd96cb1cdf.
- Add a separately configured Arena-only migration directory and make the deployment workflow apply migrations only to that staging database after inspecting current Wrangler conventions.
- The staging route guard allows only /admin and /admin/* when ENVIRONMENT is staging.
- Preserve admin-session authorization and same-origin/CSRF checks on every state-changing endpoint.
- Never add production D1, Telegram Queue, Durable Object namespace, BRVIN service, AI Search or any production binding to the Arena Worker.
- Never change live Telegram/student routes, production prompts, profiles, quotas, production D1, production secrets or production deployments.
- The Arena deployment workflow automatically deploys only when these Arena-specific paths change on main: src/ai/arena.ts, src/admin/dashboard.ts, wrangler.arena-staging.jsonc, .github/workflows/arena-staging-deploy.yml. Manual workflow_dispatch remains as a fallback with explicit confirmation. Documentation-only changes do not trigger a Worker deployment.
- Merge and deployment are distinct. After a relevant merge verify the isolated staging deploy and that production deployment jobs were skipped.

## Implementation order — follow the specification

### E0 — Revalidate
Inspect all current source and live state. Start with:
- AGENTS.md
- docs/STANDARD_SSC_MODEL_ARENA_ENGINEER_SPEC.md
- docs/STANDARD_SSC_MODEL_ARENA_STAGING_HANDOFF.md
- docs/STANDARD_SSC_MODEL_ARENA_CONTINUATION_PROMPT.md
- src/ai/arena.ts
- src/admin/dashboard.ts
- src/index.ts
- src/config/env.ts
- wrangler.arena-staging.jsonc
- .github/workflows/arena-staging-deploy.yml
- existing D1 migrations and tests

Verify whether the real blind judge completes an authenticated scorecard with the deployed 8,192-token budget. If not observed, keep that qualification explicit. Do not infer success from deployment alone.

### E1 — Persist Arena runs
Design the staging-only D1 schema/migrations. Persist question, bounded recent conversation, both candidate outputs, safe model/failure metadata, actual timing/token/cost estimates and prompt provenance under an opaque run ID. Add paginated list/load/delete support and saved-run UI. Bound input/row sizes and add retention/deletion rules. Never store credentials or arbitrary environment values.

### E2 — Persist judge results
Refactor judging to accept a saved run ID, load canonical candidate packets on the server, preserve blind randomization and the current rubric exactly, and persist the result/weighted scores before reporting the run as judged. Implement safe idempotency/recovery. If the judge succeeds but persistence fails, clearly report the unsaved state and never enable Engineer.

### E3 — Implement independent Gemini Engineer
Inspect model availability and project/location support before choosing a distinct strong Gemini model. Do not invent a model ID or silently switch providers. Use separate Engineer prompt/schema/timeout/output budget. Assemble input from the saved run, judge result and a small versioned architecture context. Use actual metrics only and label missing metrics unavailable. Treat every candidate/question field as untrusted data. Save the report and full coding-agent prompt before returning success.

### E4 — UI and report history
Add Engineer eligibility logic, button, in-progress state, safe error/retry, View Report state, report view, prompt copy and reopenable saved history. Include deletion with confirmation. Ensure responsive mobile UI. Do not add code-edit or deployment buttons.

### E5 — Acceptance
At minimum test:
- Vertex wins → persisted result → Engineer enabled.
- FreeModel wins or tie → Engineer unavailable by default.
- Judge failed or save failed → Engineer unavailable.
- FreeModel generation failure with a valid Vertex candidate → diagnosis path.
- Missing run, corrupted/oversized record, stale schema and unauthorized/cross-origin request → fail closed.
- Repeated/concurrent clicks → no duplicate uncontrolled Gemini calls.
- Gemini malformed output, timeout, auth failure and D1 report-save failure → safe state and retry.
- Candidate prompt injection → treated as untrusted data.
- Report/prompt reopen after page reload.
- Delete run → report and access removed.
- Only staging D1 receives writes.

Review real report quality: diagnosis must cite evidence, separate facts from hypotheses, avoid made-up latency/cost/percentages and produce a practical coding-agent prompt. Use multiple questions for claims of general performance improvement.

### E6 — close
Update the spec, staging handoff, continuation prompt and docs/README.md after every material update. Record exact PR, merge SHA, test workflow IDs, staging deployment/version, live verification and next task. Distinguish CI, merge, deploy, smoke test and authenticated acceptance.

## Documentation maintenance is mandatory

After each material implementation/design/test/deployment/acceptance update:
1. Update docs/STANDARD_SSC_MODEL_ARENA_ENGINEER_SPEC.md with status, decisions and a dated change-log entry.
2. Update docs/STANDARD_SSC_MODEL_ARENA_STAGING_HANDOFF.md with verified current state and exact next action.
3. Update this continuation prompt with the latest exact checkpoint and next task.
4. Update docs/README.md when the index/status/starting point changes.
5. Update tests, comments, migration/runbook documentation and release notes where behavior requires it.

Do not let these documents contradict one another. State precisely what is proposed, implemented, merged, deployed and authenticated.

## Working instructions

- The user wants the assistant to carry out repository work autonomously: inspect, implement, test, open PR, merge and verify isolated staging deployment without asking the user to run GitHub workflows or do routine engineering steps.
- Do not ask for approval again for staging-safe implementation, tests, PR, merge or staging-only deploy already authorized.
- Never make production changes.
- Never expose secrets or request that the user paste credentials.
- Do not give CLI steps to the user; any owner acceptance should use beginner-friendly browser instructions.
- Keep changes small, reversible and test-led.
- Do not repeat questions already answered in this prompt or repository docs.
- If an external blocker exists, complete safe independent work and state exactly what remains.

## First response in this new chat

Acknowledge that the design documentation is in main and begin E0 repository/live-state revalidation. Do not ask the user to restate the feature. Continue autonomously.
