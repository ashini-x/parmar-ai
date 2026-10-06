# Source Inventory

| Area | Files | Responsibility |
|---|---|---|
| Worker | `src/index.ts` | Telegram webhook, routing, Queue producer/consumer, delivery, admin routes |
| Gemini | `src/ai/gemini.ts` | Prompt construction, model request, grounding, structured parsing, retries |
| Profile/job state | `src/core/job-store.ts` | Durable Object state, rate limits, profile, context, dedupe |
| Config/types | `src/config/env.ts` | Environment contract and domain types |
| Google auth | `src/auth/google.ts` | Service-account token acquisition |
| Telegram | `src/telegram/api.ts` | Telegram API requests/actions |
| Analytics | `src/analytics/db.ts` | D1 schema/projection/cleanup |
| Admin | `src/admin/*.ts` | Admin login/session/dashboard |
| Utilities | `src/core/*.ts`, `src/http/*.ts` | Logging, request IDs, JSON responses |
