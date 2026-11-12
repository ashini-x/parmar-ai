# BRVIN M15 Core v2 Qdrant authorization staging runbook

**Environment:** isolated `parmar-ai-m14-staging` Worker and `parmar-ai-m14-staging` D1 only  
**Source:** M15 Physics benchmark, eight physical PDF pages  
**Provider:** Qdrant + Vertex AI, query-only adapter  
**Production:** unchanged; `BRVIN_RETRIEVAL_PROVIDER=cloudflare-ai-search`

## Purpose

This runbook executes the actual Core `retrieveBrvinForApplicationV2` service function against the isolated M15 Qdrant collection. It is not the earlier shadow runner, and it is not a synthetic unit test. The staging function resolves the registered application environment, application, active project grant, ready source/page registry and quota through isolated D1 before calling Qdrant.

## One-time operator action

1. Open the existing isolated staging operator page: `https://parmar-ai-m14-staging.thenewtongs.workers.dev/admin/m14`.
2. Enter the existing `BRVIN_M14_ADMIN_TOKEN` only into that page's password field. Never paste it into chat or a GitHub issue.
3. Click **Run Core v2 Qdrant authorization + revocation proof** once. The page shows the JSON result. The result is also saved into the staging-only D1 table `m15_v2_authorization_runs`; no need to copy the JSON into chat.
4. Tell the engineering agent that the button completed. The agent can read back the most recent receipt directly from the staging D1 database and calculate the M15 gate outcome.

The receipt table is initialized lazily by this action when it prepares the fixed staging fixture. Before the first run, a read-only query for `m15_v2_authorization_runs` may return `no such table`; this is expected and does not indicate a failed deployment. Do not manually create the table or run the action repeatedly.

Do not click repeatedly while a run is in progress. One authorized retrieval increments one project-scoped staging quota counter; denied requests must not increment it.

## Checks performed

The protected action seeds/validates fixed temporary M15 staging rows in the staging D1 only, then runs:

1. Active application environment + project grant: one real Core v2 retrieval against Qdrant.
2. Source/project/page provenance and expected physical page four presence.
3. Unknown project without a grant: `PROJECT_NOT_AUTHORIZED` before quota reservation.
4. Revocation of the temporary staging grant: the same v2 request is denied as `PROJECT_NOT_AUTHORIZED` before quota reservation/provider retrieval.
5. Exact Qdrant point count while the grant is revoked: points must remain present; authorization must not delete vectors.
6. Grant restoration in a `finally` block.
7. Exactly one authorized query quota reservation; neither denied request consumes quota.

The fixture is fixed to application `brvin-m15-staging-evaluator`, environment key `staging`, the dedicated M15 Physics project/source and their known IDs in the isolated staging D1. It does not use production application/environment identities.

## Read-back receipt

The action records:
- `receiptId`
- `status`: `running`, `passed` or `failed`
- `result_json`: check outcomes, passage count/pages, quota before/after and exact Qdrant point count
- start/completion timestamps

Read-only query (Cloudflare D1 ID is the isolated M14 staging database):

```sql
SELECT id, status, result_json, started_at, completed_at
FROM m15_v2_authorization_runs
ORDER BY started_at DESC
LIMIT 5;
```

A `running` row indicates the action began but did not reach receipt finalization. Do not mark the gate passed based only on a route response status; inspect every named check in the saved JSON.

## Side-effect boundary

Expected: the temporary application/environment/project/grant fixture, one staging project quota counter, and the receipt table/row.

Not expected: production D1 access, production identity rows, production provider selection, production traffic, source PDF or raw OCR changes, corpus manifest/index writes, AI Search changes, Qdrant upserts/deletes, Gemini answer generation, v2 contract changes or Teachers runtime changes.

The Qdrant adapter remains query-only. Corpus upsert/delete migration is a separate acceptance gate.


## Live execution result — 12 November 2026

The operator action completed at `2026-11-12T17:13:38.529Z` and its persisted receipt `e305a581-3d3c-469c-b2b5-093598783df4` has status `passed`.

All eight named checks were true:

- Authorized Core v2 Qdrant retrieval succeeded and returned three passages from physical pages 4, 5 and 8 of the eight-page source.
- Source/project/page provenance was valid; the expected physical page four was returned.
- The unknown-project request returned `PROJECT_NOT_AUTHORIZED` without incrementing quota.
- The request after revoking the staging grant returned `PROJECT_NOT_AUTHORIZED` before provider retrieval and without incrementing quota.
- All 14 Qdrant points for the eight-page source remained present while the grant was revoked.
- The temporary staging grant was restored in the `finally` path.
- Exactly one authorized query reservation was recorded: usage moved from 0 to 1; the denied requests left it at 1.

The saved result reports no Qdrant upserts/deletes, no source/OCR changes, no production provider changes and no production D1 access. This closes the live Core v2 authorization/revocation subgate for this fixed staging fixture; it does not close M15 overall.

**Next gate:** after the M15 multi-source staging code is merged and the isolated staging Worker has deployed it, prepare the second source and run the paired two-provider Core v2 evaluation using [BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md](BRVIN_M15_MULTI_SOURCE_CORE_V2_STAGING_RUNBOOK.md).
