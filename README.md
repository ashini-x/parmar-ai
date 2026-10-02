# Parmar AI — Phase A

Telegram-first backend foundation for the Parmar AI project.

## Phase A goal

Establish a clean, production-oriented Cloudflare Worker foundation before adding Telegram, Gemini, voice, database, or R2 integrations.

Current routes:

- `GET /` — foundation status
- `GET /health` — health check

## Stack

- Cloudflare Workers
- TypeScript
- Wrangler
- Vitest + Cloudflare Workers Vitest integration
- Prettier
- No website
- No external API integrations yet

Cloudflare recommends `wrangler.jsonc` for new Workers projects and its Workers-specific Vitest integration for testing. See the current docs for configuration, environment variables/secrets, and testing.

## Requirements

- Node.js 22+
- npm
- A Cloudflare account for deployment
- Git

## Install

```bash
npm install
npm run types
npm run check
npm test
```

## Local development

```bash
npm run dev
```

Wrangler will give you a local URL. Open:

```text
http://localhost:8787/health
```

Expected shape:

```json
{
  "ok": true,
  "service": "parmar-ai",
  "environment": "development",
  "version": "0.1.0",
  "timestamp": "..."
}
```

## Cloudflare login and deploy

```bash
npx wrangler login
npm run deploy
```

Wrangler will publish the Worker to a `workers.dev` URL because `workers_dev` is enabled in this initial configuration.

## Secrets policy

Never put API keys in `wrangler.jsonc` or commit `.dev.vars`.

Cloudflare's current documentation distinguishes ordinary variables from encrypted secrets. We will add production secrets only when the corresponding integration is implemented.

For local development later:

```bash
copy .dev.vars.example .dev.vars
```

Then add secrets such as the Telegram bot token or Gemini API key. Keep `.dev.vars` uncommitted.

## Project structure

```text
src/
├── config/
│   └── env.ts
├── core/
│   ├── logger.ts
│   └── request-id.ts
├── http/
│   └── response.ts
└── index.ts

test/
└── worker.test.ts

wrangler.jsonc
vitest.config.ts
tsconfig.json
```

## Next phase

Phase B will connect the Telegram Bot API to the Worker using a webhook, with request authentication and Telegram update parsing.

Phase C will connect Gemini after the Telegram loop is proven.
