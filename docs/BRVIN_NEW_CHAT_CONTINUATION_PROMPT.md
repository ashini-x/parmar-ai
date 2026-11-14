# BRVIN New-Chat Continuation Prompt

**Copy the prompt below into any new ChatGPT conversation to resume BRVIN work.** The prompt deliberately points to live GitHub documents instead of hard-coding a milestone, commit or deployment that will become stale.

---

Continue BRVIN's retrieval-provider modernization and scale-readiness work across both repositories:

- Core: ashini-x/parmar-ai
- Consumer: ashini-x/brvin-teachers

## First: recover the actual current state

Read the latest versions on the default branch before making changes:

1. Core docs/BRVIN_2_MASTER_PLAN.md
2. Core docs/BRVIN_RETRIEVAL_PROVIDER_MIGRATION.md
3. Core docs/BRVIN_2_PRODUCT_SCOPE_AND_FINAL_MILESTONES.md
4. Core docs/BRVIN_SYSTEM_REFERENCE.md
5. Core docs/BRVIN_SCALE_AND_SEMANTIC_CACHE_PLAN.md
6. Core docs/BRVIN_2_RPC_V2_CONTRACT.md
7. Core docs/BRVIN_NEW_CHAT_CONTINUATION_PROMPT.md
8. Core docs/BRVIN_M15_FATMAN_538_TWO_AGENT_EVALUATION.md
9. Teachers docs/REPOSITORY_GUIDE.md
10. Teachers docs/BRVIN_RETRIEVAL_PROVIDER_COMPATIBILITY.md

Then inspect the latest commits and relevant open/merged PRs, issues, CI/workflow runs, code, deployed Worker versions, provider selectors, bindings and production health. Use the connected GitHub and Cloudflare tools for repository/account state. Do not rely on remembered deployment IDs or an old chat transcript. Treat the Core master plan as the continuation entry point, the system reference as the as-built authority, the migration plan as the provider gate authority, and the scale/cache plan as the capacity and caching decision authority. If those documents conflict, inspect the code and live infrastructure and reconcile the canonical docs.

Do not hard-code the next milestone or assume the last chat's next action is still current. Derive it from the latest docs, GitHub state, test receipts and deployed state. **Latest live continuation checkpoint — 15 November 2026:** M13 merged; M14 complete as the scoped non-production Vertex/Qdrant Physics pilot; M15 active on the owner-approved full 538-page Fatman comparison. Core main is `05398fbbde195e1c806ba6590769ccfa96092f1b`; Release Validation run [#43632139823](https://github.com/ashini-x/parmar-ai/actions/runs/43632139823) and staging workflow [#43632139797](https://github.com/ashini-x/parmar-ai/actions/runs/43632139797) passed. Cloudflare latest 100% deployments: staging `parmar-ai-m14-staging` v109 (`753462ad-adba-485c-946a-60bc62314580`, deployment `319f13bc-d61e-431b-9b77-f40d351c6f46`); production `parmar-ai` v817 (`e7546e07-c0a6-45f0-b3d5-be1f2098620f`, deployment `0111c946-c34a-4130-b356-b95b2c2a86bc`) and `brvin-service` v171 (`6f18206b-599b-44be-8294-1bacb69fe874`, deployment `fb20db5e-43bd-4ce2-bede-428f2c916d22`); Teachers v12 (`68d6694c-6371-4cae-8a25-4af40ca15706`, deployment `31ff2a01-b0f4-4be8-92d3-63e2d91adddf`). Both production selectors remain `cloudflare-ai-search`; Fatman remains 800/month; `BRVIN_CORPUS_MANIFEST_ENABLED=false`; Qdrant/Vertex is staging-only. The paired production deployment and smoke/acceptance passed. The live staging D1 checkpoint is 538/538 OCR exports, 1,606 chunks, Qdrant 280/538 pages (854 points), staging AI Search 0/538, state `qdrant_indexing`; next physical page 281; the legacy item inventory has pages 1–538; no paired Fatman run exists. A 14 November `POST /admin/m15/fatman/prepare` returned HTTP 503 with `outcome=exceededCpu` at 11 ms and D1 did not advance. Active staging v109 still has no explicit `limits.cpu_ms`; settings/version metadata do not reveal the effective cap; Billing Read is unavailable through the connected OAuth, so plan/cap remains unconfirmed. **Do not click Build or call prepare again until the plan and effective CPU budget are verified and resolved.** See the M15 runbook; then resume at page 281 without re-uploading or rerunning Vision OCR.

The post-PR-247 five-case paired Core v2 staging evaluation passed under fa1b8076-9375-480b-bb4b-e22d1c13d9bb: Qdrant covers 7/7 distinct expected source/page locations and 8/8 query-specific positive targets; AI Search is 7/7 distinct and 7/8 query-specific. The expanded 12-query receipt 0f5f9769-452a-466e-b5ae-735ddba6378a also passed page-target/provenance checks: 12/12 queries for both providers, 11/11 page-target instances across seven distinct source/page pairs, zero provenance violations, and staging usage 21→45. AI Search returned zero candidates for both expected no-match prompts; Qdrant returned five unrelated candidates. Sequential p50/p95 was 3,333/6,762 ms for AI Search and 1,162/1,216 ms for Qdrant/Vertex; this is not load/SLO evidence. Page targets are not independent passage/span qrels.

The initial offline relevance-gate feasibility test is complete. On the owner-waived 109-candidate, one-subject fixture: RRF >=0.38 keeps 12/12 positive queries but clears only 3/4 out-of-corpus controls; RRF >=0.42 clears 4/4 but loses P02. A leave-one-query-out lexical coverage proxy clears 4/4 negatives but loses P06 (11/12 positive queries); The fixed RRF cutoffs retain H01, but the lexical proxy also suppresses its source-correcting passage. This is not independent human qrels and not a production calibration. No gate, threshold or reranker has been selected or deployed. Read `docs/BRVIN_M15_RELEVANCE_GATE_ABLATION.md`.

The expanded 12-query Physics evaluation is historical and complete (receipt `0f5f9769-452a-466e-b5ae-735ddba6378a`): both providers completed 12/12, found 11/11 page targets, and had zero provenance violations; Qdrant returned five unrelated candidates on two no-match prompts while AI Search returned none. These are page-target and retrieval-only results, not human passage qrels or answer-correctness/load evidence. Do not rerun this endpoint. The active M15 provider decision is the full 538-page Fatman two-agent benchmark in `docs/BRVIN_M15_FATMAN_538_TWO_AGENT_EVALUATION.md`; human review is explicitly waived and must not be requested.

## Approved target and scale objective

The approved retrieval target is Vertex AI embeddings plus Qdrant Cloud hybrid retrieval: dense vectors + BM25/sparse retrieval + Core-side RRF. Keep reranking optional and add it only if representative benchmarks justify its quality, latency and cost. Qdrant is intended to replace Cloudflare AI Search as the production retrieval provider after every migration gate passes.

Design for at least 1,000 daily active aspirants with up to 10 questions each per day: 10,000 questions/day and 300,000 questions per 30-day month. Assume every question may require retrieval. Test representative peak bursts; daily average throughput is not sufficient proof of capacity.

Qdrant does not have Cloudflare AI Search's small included monthly query allowance on its resource-based Standard tier, but it is not literally unlimited: provisioned CPU, memory, disk, topology, concurrency and upstream embedding capacity bound throughput. Use Qdrant Free for isolated staging and experiments only; do not claim that it proves production capacity or availability. Size a production Standard cluster using measured load. Keep Vertex embedding and Gemini generation costs visible; Qdrant does not eliminate those costs.

## Semantic caching requirements

Caching is an approved efficiency direction, not yet an implemented production capability:

- Start with exact normalized-question caching.
- Add semantic answer caching only after labelled positive/near-miss evaluation and a conservative measured threshold.
- Reuse the same question embedding for cache lookup and normal Qdrant retrieval; do not make duplicate embedding calls.
- Final-answer caching belongs to each consumer's application layer (Fatman in Parmar AI; any future Teachers answer cache in Teachers), not BRVIN Core, because Core returns evidence and the consumer owns Gemini answer generation.
- Core may separately implement a retrieval-result cache, but D1 authorization/readiness/grant checks must run before any cache response. Revalidate source/page provenance on a hit.
- Scope entries by consumer/tenant, authorized project and source scope, corpus/source generation, retrieval/model version, and for final answers the answer model and prompt/policy version.
- Source changes, permission changes, grant revocation, model/prompt changes and corpus generation changes must invalidate or make old entries unreachable. Never let cache entries cross tenant/project/source boundaries.
- Bypass semantic answer reuse for calculations, changed numbers/units/assumptions, time-sensitive or personalized questions, context-dependent follow-ups, ambiguous queries and uncalibrated no-match cases. A numerical exact-cache key must include every operand, unit and assumption; otherwise bypass.
- Preserve source titles and physical PDF page citations. Cache outages must fall back to ordinary retrieval/generation.

## Quotas and student experience

Preserve the student-facing 10-question daily allowance and its configured reset behavior unless separately approved. Do not confuse this per-user product limit with BRVIN's shared project-level retrieval quota. Production remains configured at 800 queries/month; the current Core code maximum of 300,000 reached production in run #43553840291 after PR #272, while staging is configured for 300,000 with the emergency breaker disabled. This is quota plumbing, not capacity proof or the completed policy redesign. Production still needs a tested capacity-aware project/application policy, fair-share controls, usage and spend alerts, and representative peak-load/cost evidence. Preserve D1 authorization and usage accounting, burst/abuse protection, and the owner-controlled emergency circuit breaker. Changing only a Cloudflare variable remains insufficient until the deployed code supports the configured value.

## Architecture invariants

Keep Cloudflare Workers, D1, Workflows, private Google Cloud Storage and Google Vision OCR initially. D1 remains authoritative for identity, grants, source readiness, quota reservations and audit. Preserve the existing private BRVIN v2 contract and consumer-owned Gemini answer generation. Do not give BRVIN Teachers direct Qdrant/Vertex access, credentials, SDKs, embeddings or provider routes.

Preserve the Core Admin and BRVIN Teachers Operator Console experience: teacher/project/collection management, secure PDF upload, the same five visible stages, automatic page-count detection, page-by-page physical-page map, persisted progress/errors, retry/resume, Core-owned READY gating and source/page citations. Allow only small provider-neutral wording or authenticated advanced-diagnostic changes. Do not redesign either UI as part of the provider migration.

## Delivery and safety rules

- Work from evidence; distinguish implemented, merged, deployed, live-verified, planned and blocked states.
- Do not re-upload or re-run Vision OCR when an existing immutable OCR/source artifact can be reused.
- Do not change the private v2 contract unless a real, demonstrated requirement makes a backward-compatible Core-first change necessary.
- Do not migrate production until retrieval quality, formula/mixed-content grounding, no-match calibration, authorization/isolation/revocation, retry/recovery/throttling, load/latency, cache correctness, quota capacity, cost visibility, UI/consumer parity and rollback gates pass.
- Keep Cloudflare AI Search available as the rollback provider through the required 14-day production soak. Do not delete its index, credentials or rollback code before the soak and explicit retirement review.
- Update the canonical documentation in both repositories for every material decision or implementation change, in the same PR/change set. Keep the master plan current and the system reference strictly as-built.
- Run relevant tests and CI. Verify deployment and production state separately from code merge and CI success. Never say "deployed" based only on a merged commit or green CI.
- Do not ask the user to perform routine repository inspection or repeat information already present in the current docs. Make the next safe, evidence-backed change directly; ask only when an actual approval or missing input is required.
- Do not lower the student allowance just to hide backend cost or capacity problems. The goal is a reliable, high-quality student experience at the 1,000-DAU planning target.

Start at the exact next unfinished action recorded by the current canonical documents and verified GitHub/Cloudflare state. Update this prompt document whenever the continuation requirements materially change.

## Historical checkpoint — expanded M15 Physics page-target run (superseded by Fatman handoff below)

Latest Core main includes PR #276 (merge `6d7e9d0faa0fba85f5baaac1cc841e025c0c23f7`), which added an offline independent-passage-qrels validator; its post-merge Release Validation run #43553840291 deployed both Core production Workers and passed health/acceptance. A subsequent unrelated main commit `cd95d139286321278fea0bdd81cf0bbcdde417d9` changed Telegram admin-contact copy/tests; Release Validation run #43561006258 passed full checks, paired production deployment and post-deploy health/source-readiness acceptance. Cloudflare read-back confirms production parmar-ai v793 and brvin-service v160, staging v104 and Teachers v12, all at 100%. Production selectors remain Cloudflare AI Search with the 800/month setting; deployed code supports a 300,000 ceiling. This is not a BRVIN retrieval change or provider cutover. Earlier M15 receipts remain: the expanded two-source staging run persisted as 0f5f9769-452a-466e-b5ae-735ddba6378a for benchmark brvin-m15-core-v2-multisource-expanded-v1. It used 24 reservations, completed 12/12 for both providers, found 11/11 page-target instances across seven source/page pairs, and had zero provenance violations.

The earlier Physics passage-qrels plan is historical. The owner explicitly waived human review for the current M15 provider decision; the blank 109-candidate human-review fixture is optional research only and is not a blocker. Do not ask for human reviewers or manual labels. The active next action is to resume the full Fatman staging index from the D1 checkpoint below, then run the paired two-agent 12-case evaluation. After reviewing that receipt, complete the still-required authorization/revocation, recovery/throttling, representative concurrency/throughput, capacity, latency/cost and rollback checks before production cutover. Do not select a new RRF cutoff or reranker from the Fatman result alone.

Teachers remains a private Core v2 consumer only. No Qdrant/Vertex credentials, SDKs, embeddings or provider endpoints belong in Teachers. Preserve the existing Operator Console, upload/index UX and private v2 boundary.

## 14 November 2026 — owner instruction: no human-review dependency

The project owner explicitly directed that no human review will be performed or required for the M15 provider comparison. Do not ask the owner to arrange reviewers, annotate passages, run scripts or perform GitHub/Cloudflare operations. Two separate AI assessors must independently grade the same evidence for both providers; a third AI adjudicator resolves material disagreement. Describe this honestly as owner-authorized AI evaluation, not independent human qrels.

Core PR #285 (https://github.com/ashini-x/parmar-ai/pull/285) implemented and merged the full 538-page Fatman comparison. The actual legacy source has 538 completed text page items. Its original completed import job is 6b94a848-c642-4be3-8718-3ae5a7d25b35, original SHA-256 8b183803fe8ee53087d731f7319519af9ac5bb62b39b2d3110acc3fe0ab59886, original Vision operation projects/project-90db7be4-619f-4ed7-89b/operations/7358e7d1e97523c3, original source object fatman/imports/6b94a848-c642-4be3-8718-3ae5a7d25b35/source.pdf, and size 115,395,596 bytes. Reuse the existing completed .txt page items; do not re-upload the PDF or rerun Vision OCR. The production legacy AI Search index and production D1 are read-only during preparation.

PR #285 builds separate staging indexes: brvin-m15-fatman-legacy-v1 with settings matched to production Fatman AI Search, and Qdrant collection brvin_m15_fatman_538_v1. It preserves the exact production legacy source ID fatman-legacy-538 and fatman/pages/ key namespace. The protected staging operator is /admin/m15/fatman on parmar-ai-m14-staging. After the latest PR CI passes and PR merges, deploy/verify only the staging Worker, then use the operator to prepare all 538 pages and run the fixed 12-case paired Core v2 benchmark.

Two agents: Agent A gemini-4-argon; Agent B gemini-3.8-flash; adjudicator gemini-4-argon on material disagreement. The result compares retrieval relevance, answer correctness, source grounding and citation accuracy, with deterministic Fatman QA, critical-error and out-of-book abstention guardrails. Qdrant wins only if both agents score it higher, adjudicated score is higher, and guardrails are not worse. AI Search wins under mirrored criteria; otherwise report no clear winner. Retrieval, answer generation and assessor latency are reported separately. Sequential 12-case timings are not load/SLO evidence.

Production remains on Cloudflare AI Search until the paired comparison is complete. The release workflow deployed the paired Core Workers, but production remains configured on Cloudflare AI Search; no production provider selector, Qdrant collection or Vertex/Qdrant retrieval binding was enabled by this benchmark. If Qdrant wins, proceed promptly to production migration/canary with D1 authorization and immediate AI Search rollback preserved; do not introduce another human-review or lengthy qrels staging blocker. Preserve the frozen v2 contract and Teachers provider boundary.
## Historical deployment handoff — PR #285/#286 (superseded by the v108 checkpoint below)

Core PR #285 merged as `66a087f48cd7a61c4fa2eaa4c39035e41fc5c486`; Core PR #286 merged as `81a61eec626996dbb170900d07e0e721678f554c`. Both PR CI workflows passed. PR #285 deployed the isolated Fatman benchmark operator; PR #286 deployed the optional staging-only secondary bearer-token support. Latest Cloudflare read-back: `parmar-ai-m14-staging` v106 (100%), `parmar-ai` v803 (100%), `brvin-service` v164 (100%), Teachers v12 (100%). Release Validation run #43614178611 passed full tests, paired Core production deployment and production smoke test.

Production remains on `cloudflare-ai-search` for both Core Workers. Production Fatman monthly limit remains 800; `BRVIN_CORPUS_MANIFEST_ENABLED=false`; `brvin-service` has no Qdrant/Vertex retrieval bindings. Teachers remains a private Core v2 consumer with no direct Qdrant/Vertex credentials or SDKs. Staging v106 has the dedicated Fatman AI Search binding `brvin-m15-fatman-legacy-v1`, source export binding to the existing read-only production Fatman AI Search catalogue, Qdrant collection `brvin_m15_fatman_538_v1`, and distinct assessor models `gemini-4-argon` and `gemini-3.8-flash`.

The 538-page preparation **has not started**: staging D1 has no `m15_fatman%` tables and no Fatman run/receipt. No PDF upload or OCR rerun has happened. The failed one-time automation workflow created no job, token or request and has been removed. No temporary automation secret exists; the existing `BRVIN_M14_ADMIN_TOKEN` remains untouched.

At the v106 handoff snapshot, the operator action was to open the page and start the build. That snapshot is superseded: the current v108 checkpoint below already has all 538 pages exported and resumes at Qdrant page 12. Follow only the v108 instruction at the end of this prompt.

After the paired receipt completes, compare both independent assessor scores, adjudicated composite scores, deterministic QA, critical errors and out-of-book abstention. A no-clear-winner result does not authorize a provider switch. A Qdrant win advances to production migration preparation, not an automatic selector flip; preserve the immediate AI Search rollback and run the separately required capacity/security/recovery/cost checks.

## Historical operator diagnostic — v107 (superseded by staging v108)

The owner tried **Build** and received an HTML-as-JSON parse error (`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`). This means the API call returned HTML; the precise source has not yet been established. PR #287 (`44571ae900687c2a4bbf836657f91eed929ea20b`) is merged and updates the Fatman operator to expose HTTP status, content type, redirect flag, final response URL and a bounded response preview when an endpoint returns non-JSON. It sends `Accept: application/json` and uses no-store. Both M14 staging validation and Release Validation passed.

The active staging operator is now `parmar-ai-m14-staging` v107 (100%). Current production deployment read-back after the paired release workflow is `parmar-ai` v805 and `brvin-service` v165, both 100%; selectors remain Cloudflare AI Search, Fatman allowance remains 800/month, corpus manifest writes remain false, Teachers v12 is unchanged. No temporary automation secret exists.

The first preparation did not initialise staging D1: there are no `m15_fatman%` tables and no run/receipt. No successful corpus export/index request is confirmed. Historical v107 retry instruction: it was superseded by PR #288 and subsequent v108 indexing progress. Do not follow this old instruction; use the latest v108 checkpoint below.

## Latest continuation — 14 November 2026, v108 indexing and CPU-limit incident

The owner first encountered Cloudflare's per-Worker subrequest limit during Qdrant indexing; PR #288 reduced each invocation to one Qdrant page and four AI Search pages. Continued v108 work later reached 280/538 Qdrant pages (854 points). A subsequent prepare request returned HTTP 503 from `exceededCpu` at 11 ms CPU; no D1 checkpoint advance occurred. Do not re-export, upload the PDF or rerun Vision OCR. Resolve the effective CPU budget before resuming.

Core PR #288 merged as `0992af5cfe85539c9a2f589309ab40ffed4a7a01`; staging Worker v108 uses one Qdrant page per invocation and four staging AI Search pages per invocation. M14 staging CI and Release Validation passed. Active staging is `parmar-ai-m14-staging` v108 (100%); production is `parmar-ai` v815 and `brvin-service` v170 (100%), Teachers v12 (100%). Both production Core selectors remain `cloudflare-ai-search`, production Fatman quota is 800/month and corpus-manifest writes remain disabled.

**Next action — CPU-budget gate first:** do not click Build yet. In Cloudflare Dashboard, open Workers & Pages → `parmar-ai-m14-staging` → Settings → CPU limits and confirm the Workers plan/effective CPU limit. The observed v108 prepare request returned HTTP 503 with `outcome=exceededCpu` at 11 ms CPU; the D1 checkpoint remains page 280. If the account is Free, 10 ms is the per-request CPU ceiling and needs Workers Paid or a redesigned under-10ms operation. If Paid, configure an appropriate `limits.cpu_ms` (30,000 ms is the normal paid default) in `wrangler.m14-staging.jsonc` and deploy a new staging version. The Billing Read permission required to inspect subscriptions is unavailable to the connected Cloudflare OAuth. After confirming the effective limit on the deployed staging version, refresh the [Fatman operator](https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m15/fatman), enter the existing staging token locally, and click Build. It resumes at Qdrant page 281; all 538 OCR exports, 1,606 chunks and 854 points are retained. Continue until both providers are READY at 538/538, then run the two-agent 12-case comparison. Human review remains waived.
