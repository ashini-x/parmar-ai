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

Do not hard-code the next milestone or assume the last chat's next action is still current. Derive the next task from the latest docs, GitHub state, test receipts and deployed state. At the 14 November 2026 documentation checkpoint, M13 was merged, M14 was complete only as a scoped non-production Vertex/Qdrant Physics pilot, and M15 was still in progress. Core PR #247 merged the floating-point score-boundary tolerance and regression test without changing the configured floor, RRF weights or production selector. A live 14 November Cloudflare read-back found Core production `parmar-ai` v779 and `brvin-service` v156, isolated staging `parmar-ai-m14-staging` v102, and Teachers `brvin-teachers` v12, all at 100%. Production remains on `cloudflare-ai-search`; Qdrant/Vertex remains staging-only.

The staging D1 contains only the original paired five-case receipt `18728f63-e13d-4e73-880f-a2b980844d04` from 12 November 2026, before PR #247. It still records Qdrant missing the MS03 M15 physical page-2 target (6/7 unique page targets) and three unrelated candidates on MN01; November project usage is 11. No post-fix paired receipt exists. Therefore do not claim MS03 recovery from the merged code, green CI or deployment alone. The exact next action remains the protected five-case paired Core v2 staging evaluation on v102 (ten staging query reservations). The operator requires `BRVIN_M14_ADMIN_TOKEN` entered locally in the staging page's password field; never retrieve, paste, or commit that secret. Do not repeat Prepare, re-upload the PDF, rerun Vision OCR or rerun the already-completed component diagnostic.

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

Preserve the student-facing 10-question daily allowance and its configured reset behavior unless separately approved. Do not confuse this per-user product limit with BRVIN's shared project-level retrieval quota. The last verified Core system reference records an 800-query/month project cap and a code maximum of 800; this is far below the 300,000/month planning target and must be redesigned in Core before production cutover. Changing only a Cloudflare variable is insufficient while the code cap remains. Preserve D1 authorization and usage accounting, burst/abuse protection and fair-share controls. Use capacity alerts and owner-visible spend escalation rather than arbitrary backend caps that degrade legitimate students; keep an owner-controlled emergency circuit breaker for genuinely abnormal usage.

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
