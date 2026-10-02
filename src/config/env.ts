/**
 * Runtime configuration for the Worker.
 * Secrets will be added in later phases. Keep configuration access centralized.
 */
export interface Env {
  ENVIRONMENT?: "development" | "staging" | "production";
  APP_VERSION?: string;

  // Phase B/C bindings (declared here before they exist so the application
  // structure stays stable as integrations are added).
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  GEMINI_API_KEY?: string;
  ADMIN_SECRET?: string;
}

export function getConfig(env: Env) {
  return {
    environment: env.ENVIRONMENT ?? "development",
    version: env.APP_VERSION ?? "0.1.0"
  } as const;
}
