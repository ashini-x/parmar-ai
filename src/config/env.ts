/**
 * Runtime configuration for the Worker.
 *
 * Secrets are configured in Cloudflare and are never stored in GitHub.
 */
export interface Env {
  ENVIRONMENT?: "development" | "staging" | "production";
  APP_VERSION?: string;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_SETUP_SECRET?: string;

  GEMINI_API_KEY?: string;
  ADMIN_SECRET?: string;

  DB: D1Database;
}

export function getConfig(env: Env) {
  return {
    environment: env.ENVIRONMENT ?? "development",
    version: env.APP_VERSION ?? "0.1.0",
  } as const;
}
