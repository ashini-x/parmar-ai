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
8. Teachers docs/REPOSITORY_GUIDE.md
9. Teachers docs/BRVIN_RETRIEVAL_PROVIDER_COMPATIBILITY.md

Then inspect the latest commits and relevant open/merged PRs, issues, CI/workflow runs, code, deployed Worker versions, provider selectors, bindings and production health. Use the connected GitHub and Cloudflare tools for repository/account state. Do not rely on remembered deployment IDs or an old chat transcript. Treat the Core master plan as the continuation entry point, the system reference as the as-built authority, the migration plan as the provider gate authority, and the scale/cache plan as the capacity and caching decision authority. If those documents conflict, inspect the code and live infrastructure and reconcile the canonical docs.

Do not hard-code the next milestone or assume the last chat's next action is still current. Derive the next task from the latest docs, GitHub state, test receipts and deployed state. At the 14 November 2026 checkpoint, M13 is merged, M14 is complete only as a scoped non-production Vertex/Qdrant Physics pilot, and M15 remains in progress. Core PR #247's machine-precision-only score-floor fix is merged/deployed without changing the configured 0.2 floor, RRF weights or production provider selector. Cloudflare read-back confirms active production parmar-ai v779 and brvin-service v156, isolated staging parmar-ai-m14-staging v103, and Teachers v12, all at 100%. Both production Core selectors remain cloudflare-ai-search; Qdrant/Vertex remains staging-only. The Core production health probe is healthy, the staging M15 benchmark health probe is ready, and Teachers health returns ok.

The post-PR-247 five-case paired Core v2 staging evaluation passed under fa1b8076-9375-480b-bb4b-e22d1c13d9bb: Qdrant covers 7/7 distinct expected source/page locations and 8/8 query-specific positive targets; AI Search is 7/7 distinct and 7/8 query-specific. The expanded 12-query receipt 0f5f9769-452a-466e-b5ae-735ddba6378a also passed page-target/provenance checks: 12/12 queries for both providers, 11/11 page-target instances across seven distinct source/page pairs, zero provenance violations, and staging usage 21→45. AI Search returned zero candidates for both expected no-match prompts; Qdrant returned five unrelated candidates. Sequential p50/p95 was 3,333/6,762 ms for AI Search and 1,162/1,216 ms for Qdrant/Vertex; this is not load/SLO evidence. Page targets are not independent passage/span qrels.

The initial offline relevance-gate feasibility test is complete. On the owner-waived 109-candidate, one-subject fixture: RRF >=0.38 keeps 12/12 positive queries but clears only 3/4 out-of-corpus controls; RRF >=0.42 clears 4/4 but loses P02. A leave-one-query-out lexical coverage proxy clears 4/4 negatives but loses P06 (11/12 positive queries); The fixed RRF cutoffs retain H01, but the lexical proxy also suppresses its source-correcting passage. This is not independent human qrels and not a production calibration. No gate, threshold or reranker has been selected or deployed. Read `docs/BRVIN_M15_RELEVANCE_GATE_ABLATION.md`.

A separate expanded 12-query page-target evaluation has been added for the two existing fingerprint-pinned READY Physics sources. Its operator endpoint is /admin/m15/benchmark/multi-source/evaluate-expanded; it uses the real private Core v2 resolver for both staging providers, consumes 24 staging query reservations, and persists a separately tagged receipt. The suite covers first-law/inertia, Newton's third law, worked numerics, work-energy, inclined planes, momentum/impulse and a spring-sign correction, plus two out-of-corpus controls. The query-to-page targets were checked against the immutable PDFs, but are not independent human passage/span qrels. First confirm the isolated staging deployment, then execute this new endpoint once and review per-query target coverage, missing pages and both negative-control candidate texts. Do not repeat the earlier five-case paired evaluation or re-Prepare sources. After reviewing the expanded run, broaden to other subject families and obtain independent passage/span qrels before selecting a multi-feature gate or reranker. No runtime gate, score floor, RRF weight, production selector, private v2 contract or Teachers boundary may change at this stage.

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

Preserve the student-facing 10-question daily allowance and its configured reset behavior unless separately approved. Do not confuse this per-user product limit with BRVIN's shared project-level retrieval quota. The live Core production project cap and deployed code maximum remain 800/month, far below the 300,000/month planning target. A staging-scoped change in progress raises the supported code maximum to 300,000 while leaving the production-configured limit at 800; this is quota plumbing, not the full policy redesign. Production still needs a tested capacity-aware project/application policy, fair-share controls, usage and spend alerts, and representative peak-load/cost evidence. Preserve D1 authorization and usage accounting, burst/abuse protection, and the owner-controlled emergency circuit breaker. Changing only a Cloudflare variable remains insufficient until the deployed code supports the configured value.

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

## Current handoff — 14 November 2026 (after expanded M15 run)

Latest Core main includes PR #268 (merge d2bcae3fa9bffaec6b88c9bffaef744897ce2e50) and PR #270’s receipt update (commit 1b0ca3c17ee3aec9ac10e10626a6e26e34a63aea). The expanded two-source staging run persisted as 0f5f9769-452a-466e-b5ae-735ddba6378a for benchmark brvin-m15-core-v2-multisource-expanded-v1.

M15 remains IN PROGRESS. Next work: complete independent human passage/span qrels without overwriting the existing owner-waived AI labels; expand beyond the two Physics sources to another approved subject/source family and hold out source/query groups; explicitly assess no-match/near-miss candidate precision; then perform representative concurrency, throughput, recovery, capacity and cost tests. The current staging registry contains only the two Physics sources, and the prepared 109-candidate review pack has blank independent reviewer fields. Progress beyond this gate needs independent human reviewers and an approved non-Physics source/artifact. Reuse immutable source/OCR artifacts where possible. Do not choose an RRF cutoff, evidence gate or reranker, and do not migrate production from Cloudflare AI Search. A staging-scoped Core change in progress raises the supported service-code maximum to 300,000/month and adds an opt-in owner emergency breaker, while production stays configured at 800/month; this is not a passed capacity/quota gate. M16 remains later Teachers/admin parity; M17 remains controlled canary plus 14-day rollback soak.

Teachers remains a private Core v2 consumer only. No Qdrant/Vertex credentials, SDKs, embeddings or provider endpoints belong in Teachers. Preserve the existing Operator Console, upload/index UX and private v2 boundary.
