import type { DurableObjectNamespace, Queue } from "@cloudflare/workers-types";

/**
 * Runtime configuration for the Worker.
 *
 * Secrets live in Cloudflare Worker Secrets and are intentionally absent from
 * GitHub. Queue/DO bindings are provisioned by wrangler.jsonc.
 */
export interface Env {
  ENVIRONMENT?: "development" | "staging" | "production";
  APP_VERSION?: string;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_SETUP_SECRET?: string;

  GCP_PROJECT_ID?: string;
  GCP_CLIENT_EMAIL?: string;
  GCP_PRIVATE_KEY?: string;
  GCP_PRIVATE_KEY_ID?: string;

  GEMINI_MODEL?: string;
  GEMINI_LOCATION?: string;
  MAX_OUTPUT_TOKENS?: string;
  MAX_QUESTION_LENGTH?: string;
  VERTEX_TIMEOUT_MS?: string;
  DAILY_QUESTION_LIMIT?: string;
  BURST_QUESTION_LIMIT?: string;
  BURST_WINDOW_SECONDS?: string;

  QUESTION_QUEUE: Queue<QuestionJob>;
  JOB_DEDUPE: DurableObjectNamespace;
}

export interface QuestionJob {
  version: 1;
  updateId: number;
  chatId: number;
  question: string;
  messageId: number;
  requestId: string;
  createdAt: number;
  statusMessageId?: number;
}

export function getConfig(env: Env) {
  return {
    environment: env.ENVIRONMENT ?? "development",
    version: env.APP_VERSION ?? "1.0.0",
    model: env.GEMINI_MODEL ?? "gemini-3.8-flash",
    location: env.GEMINI_LOCATION ?? "global",
    maxOutputTokens: parsePositiveInt(env.MAX_OUTPUT_TOKENS, 1_200),
    maxQuestionLength: parsePositiveInt(env.MAX_QUESTION_LENGTH, 4_000),
    dailyQuestionLimit: parsePositiveInt(env.DAILY_QUESTION_LIMIT, 100),
    burstQuestionLimit: parsePositiveInt(env.BURST_QUESTION_LIMIT, 5),
    burstWindowSeconds: parsePositiveInt(env.BURST_WINDOW_SECONDS, 10),
  } as const;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
