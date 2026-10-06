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
