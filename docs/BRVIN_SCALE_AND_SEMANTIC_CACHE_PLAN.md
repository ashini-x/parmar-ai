# BRVIN Capacity, Retrieval Economics and Semantic Cache Plan

**Decision date:** 14 November 2026  
**Status:** APPROVED PRODUCT/CAPACITY TARGET AND DESIGN REQUIREMENTS — IMPLEMENTATION NOT YET COMPLETE  
**Owning repository:** ashini-x/parmar-ai  
**Coordinating consumer:** ashini-x/brvin-teachers  
**Authority:** This document records the approved scale target and cache design constraints. The live implementation state remains governed by the master plan, system reference, migration plan and verified repository/Cloudflare state.

## 1. Product capacity objective

Design BRVIN and its first consumer workload to support at least:

| Measure | Target |
|---|---:|
| Daily active aspirants | 1,000 |
| Student questions per aspirant per day | 10 |
| Questions per day | 10,000 |
| Questions per 30-day month | 300,000 |
| Planning assumption | Every question may require BRVIN retrieval |

This is a conservative retrieval-capacity target: do not assume that some questions will avoid BRVIN retrieval when sizing the system. The average over a full day is approximately 0.1167 requests/second, but this average is not a concurrency target. Load testing must include realistic bursts and peak-hour concentration, not merely a 24-hour average.

The current student-facing allowance of 10 questions per user per day, with the configured India-time reset behavior, is a separate application-level product limit. Preserve it unless a separate product decision changes it. It is not the same as BRVIN's shared per-project monthly retrieval quota.

The user experience must not be weakened by an arbitrary backend quota that is much smaller than the approved audience target. Capacity, fair-use protection and abuse controls must be designed separately.

## 2. Retrieval-provider decision

The target production retrieval provider is **Qdrant Cloud**, using the approved unified hybrid path:

- Vertex AI embeddings, with the current M15 benchmark baseline remaining Gemini Embedding 001 at 768 dimensions unless a measured comparison approves a replacement.
- Dense vector retrieval plus BM25/sparse retrieval.
- Reciprocal-rank fusion (RRF) in Core.
- One unified, math-aware corpus for theory, symbols/formulas, worked examples and numerical problems.
- Optional reranking only when a representative benchmark proves that it materially improves grounded relevance enough to justify its latency and operating cost.

The objective is to remove Cloudflare AI Search's small included monthly query allowance from the production retrieval path. Cloudflare's current published limits list 1,000 included semantic queries and 1,000 included full-text queries per month on both Workers Free and Paid plans. Excess use is metered; this is not documented as a hard service stop at query 1,000. Current published semantic/vector/hybrid overage pricing is $0.75 per 1,000 queries. See the [Cloudflare AI Search limits and pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/).

Qdrant does not impose that same fixed included monthly query count on its Standard resource-based tier. This must **not** be described as literally unlimited search. Practical throughput is constrained by provisioned CPU, memory, storage, topology, request concurrency, payload/index shape, embedding-provider capacity and network latency. Qdrant Cloud Standard is billed by resource use and offers dedicated resources, scalable clusters, backups and a published 99.5% uptime SLA; see [Qdrant pricing](https://qdrant.tech/pricing/) and [Cloud cluster tiers](https://qdrant.tech/documentation/cloud/create-cluster/).

**Qdrant Free is for staging, evaluation and prototypes, not the production availability commitment.** Its published envelope is one node, 0.5 vCPU, 1 GB RAM and 4 GB disk, with no uptime SLA and version upgrades that can cause downtime. It is appropriate for the isolated M14/M15 work and controlled experiments. Do not claim that the Free cluster has proven the 1,000-DAU production target. Select Standard capacity from measured M15 load and storage results.

Qdrant removes the AI Search per-query allowance as the limiting retrieval model; it does not remove Vertex embedding charges, Gemini answer-generation charges, Cloudflare Worker/Queue costs or Qdrant's own resource costs. Do not switch the current 768-dimensional Gemini embedding corpus to a different free hosted embedding model merely to avoid embedding charges. Different embedding models are not vector-compatible; any model change requires a new collection, full re-embedding and paired quality evaluation. Keep model/region/data-handling implications explicit in the benchmark.

## 3. Application and Core ownership boundaries

BRVIN Core remains the shared knowledge and retrieval authority:

- Core owns ingestion/indexing, Qdrant writes and searches, source manifests, project/source grants, source readiness, trusted application/environment identity, audit and retrieval usage accounting.
- D1 remains authoritative for identity, project/source permissions, readiness and quota decisions.
- The private BRVIN v2 RPC contract remains the consumer boundary.
- Core returns bounded evidence and physical PDF page provenance; it does not generate the student's final answer.
- BRVIN Teachers and other consumers must not receive Qdrant/Vertex credentials, SDKs, embeddings or direct provider routes.

The final answer belongs to the calling application. Therefore:

1. A **retrieval-result cache**, if implemented inside BRVIN, is Core-owned. It may cache validated evidence/results only within an exact authorized project/source scope and retrieval/index version.
2. A **final-answer semantic cache** belongs in the consumer's question/answer orchestration. For the existing Fatman flow, that means the Parmar AI application layer, not the private BRVIN retrieval Worker. A future Teachers answer cache would likewise belong to the Teachers application.
3. Do not move final-answer generation or answer-cache ownership into BRVIN Core as part of this provider migration.

## 4. Semantic cache design

Caching is an efficiency layer, not an authorization layer and not a substitute for correct retrieval.

### 4.1 Rollout order

1. **Exact normalized-question cache first.** Normalize safe formatting differences, then require an exact key match. This is the lowest-risk initial cache.
2. **Retrieval-result cache next, if measured useful.** Cache bounded passages, their source/page IDs and retrieval metadata only after Core authorization. Re-check grants, source READY state and physical source/page references on every cache read.
3. **Semantic answer cache only after an offline labelled evaluation.** A nearest-neighbour similarity score alone is not proof that two questions have identical intent. Establish a conservative threshold against positive matches and adversarial near-miss pairs; report false-hit rate, not just hit rate.

Where a semantic cache uses an embedding, reuse the question embedding already generated for Qdrant retrieval whenever possible. Do not make a second embedding request solely for cache lookup. On a cache miss, reuse that same embedding for normal hybrid retrieval.

### 4.2 Cache identity and invalidation

A cache entry must be scoped by all dimensions that can change the answer or the caller's rights. At minimum, include or bind the entry to:

- Consumer/application and tenant identity where applicable.
- Authorized project and collection/source scope.
- Current source-manifest or corpus generation, including source updates/removals.
- Embedding model/version and retrieval-policy/index generation when retrieval evidence is cached.
- Answer model/version, system prompt/version, answer-policy version and relevant language/locale when final answers are cached.
- Any question parameters or conversation context that materially affect the answer.

Re-run the authoritative D1 authorization/readiness checks before serving any answer or evidence cache entry. A revoked app-project or source grant must immediately prevent cache reuse, even if the cache entry remains stored. Invalidate or make entries unreachable when sources change, permissions change, the corpus generation changes, or the consumer's model/prompt/policy version changes. Use bounded TTLs as a second safety measure, not as a replacement for event/version invalidation.

Never allow cache entries to cross teacher, tenant, application, project or source authorization boundaries. Do not trust a caller-supplied cache key, collection name or Qdrant filter as proof of permission.

### 4.3 Safe and unsafe reuse

Good initial candidates are stable factual explanations whose evidence and intended answer are equivalent.

Bypass semantic answer reuse by default for:

- Numerical calculations or questions with changed values, units, signs, dates, assumptions or constraints.
- Multi-step math, formula substitution, unit conversion and answer checking unless all operands and assumptions match exactly and a separate test proves safe behavior.
- Time-sensitive, current-affairs, personalised or user-context-dependent questions.
- Follow-ups whose meaning depends on earlier conversation turns.
- Ambiguous questions, uncertain OCR/formula evidence and no-match/abstention cases until calibrated.
- Questions for which source permissions, source readiness or citation validity cannot be re-confirmed.

For numerical questions, an exact cache may be considered only when the parsed operation, every operand, units, assumptions and relevant answer-policy version are identical. If parsing or equivalence is uncertain, bypass the answer cache and run normal retrieval/generation.

A cache hit must retain valid source titles and physical PDF page citations. Never return a cached answer with citations to a changed, deleted, not-READY or no-longer-authorized source.

### 4.4 Privacy, observability and quality controls

- Keep cached content private, bounded and retention-controlled; avoid unnecessary personal or sensitive user data in keys or values.
- Protect cache storage and access like other application data; do not log full cached answers or user prompts merely to compute metrics.
- Record exact/semantic hit and miss counts, cache bypass reasons, false-hit review outcomes, hit latency, source-generation invalidations, model/prompt-version invalidations and estimated Gemini tokens/cost avoided.
- Evaluate cache hit rate together with answer correctness, citation validity and near-miss false-hit rate. A high hit rate is not success if answer correctness degrades.
- Add a safe cache bypass switch and a way to purge/rebuild entries. Cache outages must fall back to the ordinary retrieval and generation path rather than make questions unavailable.

The specific cache store, eviction policy, TTLs and similarity threshold remain implementation decisions. Choose them after the M15/M16 evaluation; do not add a cache technology or threshold by guesswork.

## 5. Quota and fair-use policy

The live production `brvin-service` v156 has a shared **800 queries/month per project** allowance and an effective code-level maximum of 800, enforced by D1 reservation before retrieval. This is independent of the student-level 10 questions/day allowance. At the approved planning load of 300,000 monthly questions, an 800-query project cap represents only about 0.27% of the monthly target and is not a viable production allowance. Core PR #272 raised the code maximum to 300,000 and deployed the change only to isolated M14/M15 staging v104 at 100%, configured with a 300,000 monthly limit and the opt-in emergency breaker disabled. Production remains at v156 with an 800 limit. This staging deployment does not establish a capacity-aware quota policy or production capacity.

Before the production Qdrant cutover:

- Keep the production-configured default at 800 until all rollout gates pass. The staging-scoped code change raises the maximum to 300,000 so the configured planning ceiling can be exercised without changing the live production allowance; a Cloudflare variable change alone remains insufficient until the production code is deliberately deployed with the intended policy.
- Replace the tiny project-wide ceiling with a capacity-aware project/application policy whose tested headroom supports at least the 300,000-question/month planning target for the intended workload, plus measured burst capacity.
- Preserve D1 as the source of truth for authorization and usage accounting. Do not remove quota reservation ordering or allow unauthorised cache hits.
- Keep the student-level 10/day limit and abuse/burst protections. Add fair-share controls so one abusive account or project cannot starve others.
- Add operational usage visibility, capacity alerts and spend alerts. Use soft warnings and owner-visible escalation for ordinary growth; reserve a separately controlled emergency circuit breaker for genuine runaway traffic or provider incidents.
- The emergency breaker is an opt-in Core environment setting, currently disabled in staging and not configured in production. When enabled, Core checks current authorization and source readiness first, then returns its existing retryable unavailable response before reserving quota or calling a retrieval provider. It does not replace ordinary fair-share or capacity controls.
- Do not silently lower a student's allowance to compensate for a backend capacity problem. Any change to the visible student quota is a separate product decision.

Exact quota values, per-tenant fairness rules and alert thresholds must be tested and recorded before release; the capacity target above is the minimum acceptance scenario, not a claim that current production supports it.

## 6. Acceptance and rollout requirements

Treat the following as required acceptance work within the existing M15–M17 sequence, not as milestones already complete:

- **Completed 14 November:** the expanded 12-query paired Core v2 evaluation is persisted as 0f5f9769-452a-466e-b5ae-735ddba6378a. Both providers completed 12/12 with 11/11 page-target instances across seven distinct source/page pairs and zero provenance violations; staging usage moved 21→45 for 24 reservations. AI Search returned no candidates on both expected no-match queries; Qdrant returned five unrelated candidates. Sequential n=12 timing is not load/SLO evidence and page targets are not human passage qrels. Earlier five-case receipt fa1b8076-9375-480b-bb4b-e22d1c13d9bb remains a separate passed score-floor verification.
- **Initial gate feasibility checked 14 November:** no runtime gate is selected. RRF >=0.38 preserves 12/12 positives but clears only 3/4 no-match controls; >=0.42 clears 4/4 but loses P02. A leave-one-query-out lexical coverage proxy clears 4/4 but loses P06. These owner-waived single-source results are exploratory, not human qrels. Next obtain broader independently labelled multi-document/query-family evidence, then perform a source-group held-out multi-feature ablation. Do not treat RRF as calibrated probability or choose a universal threshold from MN01 alone.
- Expand mixed-content, exact-symbol, numerical and claim-to-passage grounding tests; add independent human passage relevance labels for representative evaluation.
- Verify authorization, grant revocation, source deletion/update invalidation and cache-isolation behavior, including cache-hit requests.
- Exercise transient retries, provider errors, throttling, backpressure and recovery without duplicate chunks or unnecessary Vision OCR.
- Load-test at least 10,000 questions/day equivalent plus representative peak bursts; measure Qdrant CPU/RAM/disk, query throughput, p50/p95/p99 latency, queue wait/backlog, Vertex request/concurrency/429 behavior, cache hit/miss, error rate and total cost.
- Test exact cache, semantic cache and retrieval cache with adversarial near-miss cases, changed numerical operands, changed source versions, revoked grants, tenant/project isolation and citation validity.
- Record the Qdrant resource tier and sizing rationale from measured load. Free-tier success alone does not pass production capacity or availability.
- Complete the coordinated Core Admin and Teachers Operator Console parity/consumer checks in M16.
- Use a controlled M17 production canary with monitoring and a tested rollback. Keep Cloudflare AI Search fully available as the rollback provider through the required 14-day production soak. Do not retire its index, code or bindings before the soak and explicit legacy-retirement decision.

## 7. Current checkpoint (14 November 2026)

- M13 is merged; M14 is complete only as the scoped non-production Vertex/Qdrant Physics pilot.
- M15 remains in progress. Core PR #247's IEEE-754 score-boundary fix is merged/deployed behind the unchanged production selector and passed the paired Core v2 staging receipt `fa1b8076-9375-480b-bb4b-e22d1c13d9bb`.
- Qdrant covers all 7/7 distinct expected page locations and all 8/8 query-specific positive targets, including MS03 M15 pages 2/3; AI Search covers 7/7 distinct locations and 7/8 query-specific instances. Both have zero provenance violations, and all seven structural/authorization/quota checks passed.
- Qdrant still returns three unrelated candidates for the two-source MN01 no-match query while AI Search returns none.
- **Initial offline gate feasibility:** fixed RRF >=0.38 retains 12/12 positive queries but clears only 3/4 out-of-corpus controls; >=0.42 clears 4/4 but falsely abstains on P02. A leave-one-query-out lexical coverage proxy clears 4/4 but falsely abstains on P06. The fixed RRF cutoffs retain H01's source-correcting passage, but the lexical proxy removes it. No gate, threshold or reranker is selected; the 109-candidate pool is owner-waived AI assessment, not independent human qrels. See `BRVIN_M15_RELEVANCE_GATE_ABLATION.md`.
- Next: broaden independently labelled multi-document/query-family evidence, then run source-group held-out multi-feature ablation. Only benchmark a named reranker after labels and candidate budget are appropriate. Do not use a universal RRF cutoff or treat rank-fusion scores as probabilities.
- Five sequential latency samples are not a load test, capacity result or production SLO. M15 still requires broader formula/claim grounding, retry/recovery/throttling, HNSW-aware peak-load testing, repeatable latency/throughput/cost, quota redesign and rollback rehearsal.
- Production Core still selects Cloudflare AI Search; production Qdrant/Vertex retrieval bindings and corpus migration remain disabled.
- No semantic answer cache, cache invalidation path or scale-quota redesign is claimed as implemented.
- BRVIN Teachers remains a private v2 consumer without direct Qdrant/Vertex credentials or runtime dependency. Its Operator Console, five-stage source lifecycle, physical page map, Core-owned READY gate and citations remain unchanged.

## 8. Official provider references

- [Cloudflare AI Search limits and pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
- [Qdrant Cloud pricing](https://qdrant.tech/pricing/)
- [Qdrant Cloud cluster types and resource limits](https://qdrant.tech/documentation/cloud/create-cluster/)
