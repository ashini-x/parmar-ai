# Repository Map

```text
.
├── src/
│   ├── ai/              # Gemini/Vertex integration and answer validation
│   ├── admin/           # Admin authentication and dashboard
│   ├── analytics/       # D1 analytics projection
│   ├── auth/            # Google service-account auth helpers
│   ├── config/          # Environment and domain types
│   ├── core/            # Durable Object job/profile/rate-limit state
│   ├── http/            # Response helpers
│   ├── telegram/        # Telegram Bot API adapter
│   └── index.ts         # Worker entrypoint and routing
├── test/                # Release regression tests
├── docs/                # Architecture, security, data, API, ops, test docs
├── .github/             # CI, issue templates, dependency policy
├── migrations_0001_initial.reference.sql
├── wrangler.jsonc       # Public deployment template/config; no secrets
├── wrangler.example.jsonc
└── README.md
```

## Telegram runtime source map

Read [TELEGRAM_BOT_ARCHITECTURE.md](TELEGRAM_BOT_ARCHITECTURE.md) before changing or reusing the Telegram runtime. Key modules:

- `src/index.ts`: webhook authentication/routing, fast `/start`, question acknowledgement/admission, Queue publication and consumer.
- `src/telegram/bot-store.ts`: encrypted bot connections, hashed webhook secret lookup, short-lived cosmetic-token caches and lightweight credential schema.
- `src/telegram/api.ts`: Telegram Bot API adapter, retry/timeouts, final answer delivery and short-timeout progress edits.
- `src/telegram/progress.ts`: serialized status/answer updater with transient-failure recovery.
- `src/telegram/parallel-work.ts`: concurrent independent suspension/mode and profile/history reads.
- `src/core/job-store.ts`: per-chat Durable Object admission, quotas, dedupe, leases, conversation/profile state, typing and stale-job recovery.
- `src/core/typing-heartbeat.ts`: oldest-active-job heartbeat selection.
- `src/analytics/db.ts`: separate credential/runtime/full application schema boundaries.
- `src/ai/gemini.ts`: Vertex AI structured generation, adaptive thinking, SSE parsing and internal retry policy.
- `test/telegram-bot-store-schema.test.ts` and `test/telegram-progress.test.ts`: regressions for the fast schema boundary and bounded progress recovery.

## Standard SSC Model Arena source map

The Arena is a staging-only evaluation surface, not part of the student Telegram request path:

- **src/ai/arena.ts**: parallel Gemini/FreeModel orchestration, shared prompt parity, AnswerPacket response formatting and stateless run handler.
- **src/ai/freemodel.ts**: FreeModel credential access, model catalogue discovery, primary-model routing, candidate generation and failover.
- **src/auth/google.ts**: service-account JWT assertion and Vertex access-token authentication.
- **src/admin/dashboard.ts**: admin dashboard Arena UI, model selector, metrics, preview, raw AnswerPacket display, browser-session turns, local votes and export.
- **src/config/env.ts**: runtime environment bindings, including staging FreeModel and GCP secrets.
- **src/index.ts**: staging-only admin route guard and protected Arena endpoints.
- **wrangler.arena-staging.jsonc**: isolated staging Worker and dedicated D1 binding.
- **.github/workflows/arena-staging-deploy.yml**: manual-only staging deployment and admin-login smoke test.
- **test/arena-staging-route-guard.test.ts**: regression test for the staging admin-only path boundary.
- **docs/STANDARD_SSC_MODEL_ARENA_STAGING_HANDOFF.md**: implementation, infrastructure, deployment and provider-acceptance handoff.
- **docs/STANDARD_SSC_MODEL_ARENA_CONTINUATION_PROMPT.md**: copyable new-chat continuation instructions.

Read the Arena staging handoff before changing provider integration or staging resources. Preserve the production Telegram and production-resource boundaries.

## BRVIN-specific source map

BRVIN is implemented across both generic BRVIN modules and legacy Fatman-named ingestion modules:

- `src/brvin/admin.ts`: protected BRVIN admin workspace, project/collection governance and source management.
- `src/brvin/service-worker.ts`: private WorkerEntrypoint and default HTTP 404 handler.
- `src/brvin/service-core.ts`: trusted consumer resolution, quota and RPC orchestration.
- `src/brvin/retrieval.ts`: D1 grant resolution, exact-page lookup, AI Search filtering and passage validation.
- `src/analytics/db.ts`: shared D1 schema and compatibility migrations.
- `src/fatman/import.ts` and `src/fatman/workflow.ts`: current generic PDF upload/OCR/index/recovery lifecycle; legacy names are retained.
- `src/config/env.ts`: shared binding and RPC type contracts.
- `wrangler.jsonc`: `parmar-ai` caller/admin/ingestion Worker and its Fatman BRVIN Service Binding.
- `wrangler.brvin.jsonc`: private retrieval Worker.
- `test/brvin*.test.ts`: BRVIN retrieval/service/admin regression coverage.

Read [BRVIN_SYSTEM_REFERENCE.md](BRVIN_SYSTEM_REFERENCE.md) before changing this area. It records the complete responsibility split and the integration constraints.
