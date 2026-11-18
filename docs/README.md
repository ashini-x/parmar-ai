# Parmar AI Engineering Documentation

This directory contains the engineering, operational, security, data, release, and verification documents that describe the implemented Parmar AI system.

The current source baseline is **v2.8.0**.

## Start here

| Document | Purpose |
|---|---|
| [REPOSITORY_MAP.md](REPOSITORY_MAP.md) | Where major source, config, tests, prompts, and operational assets live. |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | High-level system architecture and failure boundaries. |
| [TELEGRAM_BOT_ARCHITECTURE.md](TELEGRAM_BOT_ARCHITECTURE.md) | Locked as-built Telegram runtime, latency boundaries, operational invariants and reusable blueprint for the next bot. |
| [AI_PIPELINE.md](AI_PIPELINE.md) | Gemini/Vertex execution, response contracts, quiz semantics, and usage accounting. |
| [TEST_PLAN.md](TEST_PLAN.md) | Production-oriented automated and manual verification matrix. |
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | Diagnosis and recovery procedures. |
| [RELEASE_PROCESS.md](RELEASE_PROCESS.md) | Source approval, verification, deployment, and release recording. |
| [VERSIONING.md](VERSIONING.md) | Version and compatibility discipline. |

## Data and security

| Document | Purpose |
|---|---|
| [DATA_GOVERNANCE.md](DATA_GOVERNANCE.md) | Runtime-data handling, retention, deletion, and repository boundaries. |
| [DATA_MODEL.md](DATA_MODEL.md) | D1 and Durable Object data structures and relationships. |
| [SECURITY_MODEL.md](SECURITY_MODEL.md) | Trust boundaries, authentication, authorization, and secret handling. |

## API and source references

- [API.md](API.md): supported HTTP/webhook/admin surface and request expectations.
- [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md): tracked source/assets and their roles.
- [DOCUMENTATION_POLICY.md](DOCUMENTATION_POLICY.md): documentation maintenance requirements.

## Telegram bot runtime — locked source of truth

**For any future Telegram bot built from this codebase, start with [TELEGRAM_BOT_ARCHITECTURE.md](TELEGRAM_BOT_ARCHITECTURE.md).** It records the production webhook/`/start` fast path, Durable Object admission and recovery, Queue hand-off, runtime D1 schema boundary, Gemini stream, progress retry policy, observability and the reuse checklist. [../ARCHITECTURE.md](../ARCHITECTURE.md) is the short overview only.

The generic Telegram runtime should be copied independently from Parmar's SSC/Fatman/BRVIN business logic. Every new bot gets isolated Cloudflare resources, secrets and application data.

## BRVIN — current source of truth

**For every new BRVIN chat, start with [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md).** It is the current continuation handoff, not an archive or aspirational plan. It points to the only active product-scope, architecture, contract and operator references.

| Active document | Purpose |
|---|---|
| [BRVIN_2_MASTER_PLAN.md](BRVIN_2_MASTER_PLAN.md) | Single current-state and new-chat continuation entry point. |
| [BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md](BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md) | Approved product boundary and active M6–M17 milestone/acceptance ledger. |
| [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) | Current as-built architecture, infrastructure, D1 model, trust boundary and production state. |
| [BRVIN_2_ARCHITECTURE_DECISIONS.md](BRVIN_2_ARCHITECTURE_DECISIONS.md) | Accepted architecture decisions; historical evidence is labelled and is not a task list. |
| [BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md](BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md) | Approved M12–M17 provider modernization plan, current implementation/acceptance status, unified math-aware hybrid retrieval, compatibility and rollback gates. |
| [BRVIN_SCALE_AND_SEMANTIC_CACHE_PLAN.md](BRVIN_SCALE_AND_SEMANTIC_CACHE_PLAN.md) | Approved 1,000-DAU capacity target, Qdrant economics, semantic-cache design, quota redesign and load/rollout requirements. |
| [BRVIN_NEW_CHAT_CONTINUATION_PROMPT.md](BRVIN_NEW_CHAT_CONTINUATION_PROMPT.md) | Copyable, self-refreshing new-chat prompt that recovers current status from GitHub and Cloudflare. |
| [BRVIN_2_RPC_V2_CONTRACT.md](BRVIN_2_RPC_V2_CONTRACT.md) | Current private v2 retrieval and connection-proof contract. |
| [BRVIN_INTEGRATION_GUIDE.md](BRVIN_INTEGRATION_GUIDE.md) | One-time integration of a same-account consumer Worker. |
| [BRVIN_ADMIN_RUNBOOK.md](BRVIN_ADMIN_RUNBOOK.md) | Day-to-day administrator instructions. |
| [BRVIN_OPERATIONS_RUNBOOK.md](BRVIN_OPERATIONS_RUNBOOK.md) | Engineering/operator procedures, API references and troubleshooting. |
| [BRVIN_PRIVATE_RETRIEVAL_API.md](BRVIN_PRIVATE_RETRIEVAL_API.md) | Legacy v1 contract for existing Fatman compatibility only. |
| [BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md](BRVIN_M15_V2_AUTHORIZATION_STAGING_RUNBOOK.md) | Protected Core v2 Qdrant authorization/revocation operator action and persisted receipt (passed 8/8). |
| [BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md](BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md) | Protected second-source preparation and paired Core v2 AI Search/Qdrant staging evaluation. |
| [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) | Current as-built architecture and verified Core/Teachers/Cloudflare deployment snapshot, including M15 staging. |

The active architecture is the shared `parmar-ai` admin/ingestion plane plus private `brvin-service` retrieval Worker. New consumers use the v2 trusted application/environment identity and project grants. Consumer applications own end-user authentication and model generation.

**Superseded plans:** the autonomous Project Factory proposal and the old M3 connector/reference-client design were removed from the active documentation tree. Do not recreate their milestones or the retired `brvin-test-client`. Past text remains recoverable from Git history, not as active requirements.

## BRVIN Teachers — downstream application platform

**BRVIN Teachers** is the separate downstream multi-tenant application platform in `ashini-x/brvin-teachers`, not BRVIN core and not a replacement for Parmar AI. Its protected Operator Console, Core management binding and private v2 retrieval binding are deployed; the real Physics source has passed useful retrieval, page provenance, grant-revocation denial and retrieval restoration acceptance. Student-facing channel/model runtime remains a separate workstream. Its application architecture and UI are maintained in that repository.

The BRVIN retrieval-provider modernization is coordinated across both repositories: Core owns Vertex AI/Qdrant ingestion and retrieval; Teachers preserves the same Operator Console and student-facing contract without direct provider access. See [BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md](BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md) and the consumer's [provider compatibility plan](https://github.com/ashini-x/brvin-teachers/blob/main/docs/BRVIN_RETRIEVAL_PROVIDER_COMPATIBILITY.md). The existing Parmar AI SSC application remains standalone; no code or production-data transfer is part of this project.

## Owner Gemini Intelligence — private Owner workspace (active; M4.1 deployed; continuity design approved)

The Owner-only general-purpose Gemini workspace is built inside the existing protected Admin Control Center and remains separate from the student-facing परमार्थAI tutor. Start every implementation chat with [OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md](OWNER_INTELLIGENCE_WORKSPACE_ROADMAP.md) and copy the current handoff from [OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md](OWNER_INTELLIGENCE_WORKSPACE_CONTINUATION_PROMPT.md). The approved but not-yet-implemented long-session design is in [OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md](OWNER_INTELLIGENCE_MEMORY_AND_CONTEXT_ARCHITECTURE.md); it now explicitly defines the Cloudflare Owner Context Replicator, a bounded per-request context budget with an O(N) aggregate prompt-input target for fixed budget B, and all seven Owner workflows. The required deterministic 10/50/100/200-turn acceptance suite is planned, not run. M4 interaction acceptance and M4.1 meter/concurrency browser checks are Owner-reported passed. The exact 200,000-token boundary and same-chat reservation race passed deterministic tests against local D1 in PR #341; M4.1 is complete. M4.2 is the next implementation milestone. The Owner chooses a project/location-verified Gemini model and asks open-ended questions by typing or by speaking into dictation that becomes editable text. Both use the same text-generation path. Gemini Live, real-time audio/video, assistant voice output and media generation are explicitly out of scope. Useful Gemini API tools may be added only after verifying support for the selected model/API/project and a concrete Owner use case. BRɅIN context is a separate opt-in add-on, off by default.

M0–M3 are complete and deployed, including the live Owner-session model-picker check. M4 implementation is merged and deployed in commit `2912d55cde147c48d1cc608b4b318b51487697ba`; workflow [44168257509](https://github.com/ashini-x/parmar-ai/actions/runs/44168257509) passed TypeScript checks, 482 Vitest tests, 62 Node tests, three Worker dry-runs, paired production deployment, root/health smoke tests, BRVIN/Fatman readiness and release acceptance. Deployed versions: `brvin-service` `44acfa29-199c-4468-8b4a-23fefeaef363`; `parmar-ai` `10c630d6-ec4c-4407-8059-39193290e1ba`. Release manifest artifact: `14367310746`. Authenticated production generation is verified on Gemini 4 Carbon HIGH and Hydrogen HIGH/XHIGH; automatic in-place stream reconnection is not implemented and is deferred. The 2026-11-18 model-picker liveness fix is deployed in commit `15c2de6c484af03e0ca1a06d34d1f81ce5f04c58`; workflow [44175875966](https://github.com/ashini-x/parmar-ai/actions/runs/44175875966) passed. Model discovery now has 12-second token, 8-second per-probe and 45-second browser deadlines, plus a Retry state. The frontend startup fix is also deployed in commit `df48b707cfc953b68cc6e099818b5c68965e6c58`; workflow [44179978046](https://github.com/ashini-x/parmar-ai/actions/runs/44179978046) passed. The workspace app is now a protected same-origin `/admin/intelligence.js` asset (no inline app script); conversation API requests have a 15-second deadline and the history/New chat UI shows retryable errors. The 2026-11-18 chat UX/activity improvement is deployed in commit `dff54f783d660c7ac397b6f6670b7eee92ecaf98`; workflow [44188273089](https://github.com/ashini-x/parmar-ai/actions/runs/44188273089) passed. The workspace now uses user bubbles, assistant cards, model/thinking badges, observable request/stream activity, green completion status and response metadata. Expired catalogue checks now re-verify only the selected model before generation. The cross-model history fix is deployed in commit `252622df4a8429448252471dd61ce0cc48adc092`; workflow [44195976369](https://github.com/ashini-x/parmar-ai/actions/runs/44195976369) passed. Generation now removes failed/empty turns, normalizes role order and sends a bounded recent transcript while preserving the full D1 history. Model-list Count Tokens eligibility is explicitly distinguished from GenerateContent permission. The follow-up PR #331 (`9acd131b48336f0584cd9173837017651741a4e6`) is deployed in workflow [44200720507](https://github.com/ashini-x/parmar-ai/actions/runs/44200720507); it distinguishes Count Tokens probe failures from GenerateContent failures and surfaces only safe Google status/reason/permission codes. Production context verification succeeded on Hydrogen HIGH and XHIGH in the same conversation after a failed Carbon HIGH attempt; the post-PR #333 Carbon retry initially failed with Worker 502 from upstream Vertex 401/403, but a later Carbon HIGH request in the same conversation succeeded at 00:50:52 UTC on 2026-11-18; D1 confirms 7,673 prompt tokens, 61 output tokens, 8,011 total tokens and 11,486 ms elapsed. The earlier denial's exact stage/reason remains unknown. The 200,000-token cumulative per-chat budget is now merged and deployed by PR [#335](https://github.com/ashini-x/parmar-ai/pull/335), merge commit `109e21b155b794ec2ac1cc29274d5513e56c6762`. Exact CountTokens preflight, D1 prompt/output reservation, Vertex usage settlement, legacy usage backfill, read-only enforcement and a visible meter with manual GitHub Markdown checkpoint handoff are live. Each new chat receives a fresh budget; GitHub checkpoint import remains manual. PR validation [44221814569](https://github.com/ashini-x/parmar-ai/actions/runs/44221814569) passed typecheck, 494 Vitest tests/72 files, 62 Node tests/9 files and three Worker dry-runs. Production release [44222082173](https://github.com/ashini-x/parmar-ai/actions/runs/44222082173) passed paired deploy, root/health smoke, BRVIN service binding, Fatman retrieval readiness and release acceptance. Versions: `parmar-ai` `e94b142b-5ddf-448e-a51b-0c9709bfb7f1`; `brvin-service` `44547ea0-830e-41f8-97cb-95594959cae2`; manifest artifact `14391366648`. Owner-reported authenticated production acceptance has since passed for M4 waiting/streaming, Stop/partial retention, Edit/resubmit, Regenerate, usage-meter/in-flight reservation and cross-tab concurrency (independent chats may run in parallel; same-chat simultaneous generation is blocked). The exact 200,000-token hard-boundary test remains outstanding. PR #333 (`46d8d4a738d7f2d6d9c2fe37d9899caf8d8c6bd5`) is now deployed in workflow [44205352694](https://github.com/ashini-x/parmar-ai/actions/runs/44205352694). Owner errors name `StreamGenerateContent` precisely and safely extract a permission/reason from Google's formatted error message when supplied. The post-PR #333 Carbon HIGH retry occurred at 00:24:02 UTC on 2026-11-18 in the same conversation and failed with zero tokens; the matching Worker generation request returned HTTP 502 after 7,339 ms on deployed version `8ae9c848-28a1-4ec7-9c5a-001f8380d7f9`. The Worker mapped that failure from upstream Vertex 401/403, but D1/Cloudflare telemetry did not retain the response, so the exact stage and denied permission/reason remain unknown. A later Carbon HIGH call succeeded; the old denial is intermittent and does not justify a blind IAM change.
## Current feature documentation

The v2.8.0 implementation includes:

- Telegram-first SSC doubt solving.
- Durable Object conversation and job state.
- Cloudflare Queue processing with retry/DLQ behavior.
- Structured Gemini/Vertex answer generation and validation.
- Semantic native Telegram quiz mode.
- Generic-MCQ topic clarification without random topic invention.
- Independent native Telegram quiz batches of up to 10 items.
- Per-quiz answer/session persistence.
- Quiz-result conversation context for follow-up explanations.
- D1 AI usage and analytics accounting.
- Protected admin controls and auditability.

### Native quiz contract

The current native quiz flow is intentionally different from ordinary text answers:

1. A genuine quiz intent is classified as quiz mode.
2. A generic quiz request without a topic anchor is intercepted before model generation and asks for a topic.
3. A topic reply continues the original requested quiz quantity.
4. The model returns validated quiz item(s).
5. Each batch item is delivered as its own Telegram native quiz/poll.
6. The selected answer is persisted against the quiz session.
7. Telegram's native result/explanation remains the student-facing vote result; Parmar does not send a duplicate result message.
8. The result is retained in short conversation context for subsequent explanation/follow-up questions.

## Documentation maintenance rule

Documentation must describe **deployed behavior, not aspirations**.

Whenever a change affects security, data handling, access control, Telegram behavior, persistence, AI contracts, quota/limits, admin operations, testing, or release procedures, update the relevant documentation in the same release.

Do not document unshipped Battle Arena, squad, social graph, ranking, economy, or other future systems as current product capabilities.

For repository-wide legal/security rules, see:

- [../LICENSE](../LICENSE)
- [../SECURITY.md](../SECURITY.md)
- [../PRIVACY.md](../PRIVACY.md)
- [../AI_USAGE_POLICY.md](../AI_USAGE_POLICY.md)
- [../TRADEMARKS.md](../TRADEMARKS.md)
- [../GOVERNANCE.md](../GOVERNANCE.md)
- [../CONTRIBUTING.md](../CONTRIBUTING.md)
- [../SUPPORT.md](../SUPPORT.md)