import type {
  ExecutionContext,
  ExportedHandler,
  MessageBatch,
  DurableObjectStub,
} from "@cloudflare/workers-types";

import { generateGeminiAnswer, GeminiError } from "./ai/gemini";
import type { Env, QuestionJob } from "./config/env";
import {
  JobDedupe,
} from "./core/job-store";
import { logger } from "./core/logger";
import { addRequestId, getOrCreateRequestId } from "./core/request-id";
import {
  editTelegramMessage,
  sendTelegramMessage,
  TelegramError,
} from "./telegram/api";
import {
  internalServerError,
  json,
  methodNotAllowed,
  notFound,
} from "./http/response";

const QUEUE_MAX_RETRIES = 10;
const TELEGRAM_STATUS_TEXT = "✅ Sawal receive ho gaya. Answer bana raha hoon... 🤔";
const RATE_LIMIT_TEXT =
  "Bhai, ek saath bahut saare questions aa rahe hain. Thoda sa gap do, phir next doubt bhejo. 🙂";
const DAILY_LIMIT_TEXT =
  "Aaj ke liye tumhara question limit complete ho gaya hai. Kal phir continue kar lena. 🙌";
const FINAL_FAILURE_TEXT =
  "Bhai, is waqt AI service se answer nahi ban paaya. Tumhara sawal system mein retry hua hai; thodi der baad same doubt dobara bhej dena. 🙏";

interface TelegramMessage {
  message_id?: number;
  chat?: { id?: number };
  text?: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface BeginJobResponse {
  action: "new" | "duplicate" | "rate_limited" | "retry_ack" | "enqueue";
  statusMessageId?: number;
  notify?: boolean;
}

interface ClaimResponse {
  claimed: boolean;
  record?: {
    chatId: number;
    question: string;
    messageId: number;
    statusMessageId?: number;
    answer?: string;
  };
}

function withRequestId(response: Response, requestId: string): Response {
  return addRequestId(response, requestId);
}

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.length !== bBytes.length) return false;

  let result = 0;
  for (let index = 0; index < aBytes.length; index += 1) {
    result |= aBytes[index] ^ bBytes[index];
  }
  return result === 0;
}

function getJobStore(env: Env, chatId: number): DurableObjectStub {
  const id = env.JOB_DEDUPE.idFromName(String(chatId));
  return env.JOB_DEDUPE.get(id);
}

async function jobStoreRequest<T>(
  env: Env,
  chatId: number,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await getJobStore(env, chatId).fetch("https://job-store/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Job store returned HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function telegramSetup(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_SETUP_SECRET) {
    return withRequestId(
      json({ ok: false, error: "telegram_configuration_missing" }, 500),
      requestId,
    );
  }

  const url = new URL(request.url);
  const supplied = url.searchParams.get("key");

  if (!supplied || !safeEqual(supplied, env.TELEGRAM_SETUP_SECRET)) {
    return withRequestId(json({ ok: false, error: "unauthorized" }, 401), requestId);
  }

  const webhookUrl = `${url.origin}/telegram/webhook`;
  const telegram = await telegramApiSetWebhook(env, webhookUrl);

  logger.info("telegram_webhook_setup", { requestId, webhookUrl });

  return withRequestId(
    json({ ok: true, webhook: webhookUrl, telegram }),
    requestId,
  );
}

async function telegramApiSetWebhook(env: Env, webhookUrl: string): Promise<unknown> {
  const response = await sendTelegramMethod(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
    max_connections: 100,
  });

  return response;
}

async function sendTelegramMethod(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new TelegramError("Telegram bot token is not configured.");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let data: { ok: boolean; result?: unknown; description?: string };
  try {
    data = JSON.parse(raw) as { ok: boolean; result?: unknown; description?: string };
  } catch {
    throw new TelegramError(`Telegram returned invalid JSON (HTTP ${response.status}).`, response.status);
  }

  if (!response.ok || !data.ok) {
    throw new TelegramError(
      data.description ?? `Telegram request failed (HTTP ${response.status}).`,
      response.status,
      response.status >= 500 || response.status === 429,
    );
  }

  return data.result;
}

async function enqueueQuestion(
  env: Env,
  job: QuestionJob,
): Promise<void> {
  await env.QUESTION_QUEUE.send(job, { contentType: "json" });
  await jobStoreRequest(env, job.chatId, {
    action: "mark_queued",
    updateId: job.updateId,
  });
}

async function handleTelegramWebhook(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return withRequestId(json({ ok: false, error: "telegram_not_configured" }, 500), requestId);
  }

  const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!receivedSecret || !safeEqual(receivedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
    logger.warn("telegram_webhook_unauthorized", { requestId });
    return withRequestId(json({ ok: false, error: "UNAUTHORIZED" }, 401), requestId);
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return withRequestId(json({ ok: false, error: "INVALID_JSON" }, 400), requestId);
  }

  const updateId = update.update_id;
  const message = update.message;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;

  if (!isSafeInteger(updateId) || !isSafeInteger(chatId) || !isSafeInteger(messageId)) {
    return withRequestId(json({ ok: true }), requestId);
  }

  const text = message?.text?.trim() ?? "";

  const maxQuestionLength = positiveIntEnv(env.MAX_QUESTION_LENGTH, 4_000);
  if (text.length > maxQuestionLength) {
    try {
      await sendTelegramMessage(
        env,
        chatId,
        `Question thoda chhota bhejo. Maximum ${maxQuestionLength} characters hain. 🙂`,
        messageId,
      );
    } catch (error) {
      logger.warn("telegram_length_limit_reply_failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return withRequestId(json({ ok: true, rejected: "question_too_long" }), requestId);
  }

  logger.info("telegram_message_received", {
    requestId,
    updateId,
    chatId: String(chatId),
    textLength: text.length,
  });

  if (!text) {
    try {
      await sendTelegramMessage(
        env,
        chatId,
        "Abhi main text questions handle kar raha hoon. 📚",
        messageId,
      );
    } catch (error) {
      logger.error("telegram_non_text_reply_failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return withRequestId(json({ ok: false }, 500), requestId);
    }

    return withRequestId(json({ ok: true }), requestId);
  }

  if (text === "/start" || text.startsWith("/start ")) {
    try {
      await sendTelegramMessage(
        env,
        chatId,
        "So Hello Everyone, umeed karta hoon aap sabhi thik honge!\n\nTHANKOO :)\n\nApna doubt bhejo. Main exam-focused answer dunga. 📚",
      );
    } catch (error) {
      logger.error("telegram_start_reply_failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return withRequestId(json({ ok: false }, 500), requestId);
    }

    return withRequestId(json({ ok: true }), requestId);
  }

  const begin = await jobStoreRequest<BeginJobResponse>(env, chatId, {
    action: "begin",
    updateId,
    chatId,
    question: text,
    messageId,
    requestId,
    createdAt: Date.now(),
  });

  if (begin.action === "duplicate") {
    return withRequestId(json({ ok: true, duplicate: true }), requestId);
  }

  if (begin.action === "rate_limited") {
    if (begin.notify) {
      try {
        await sendTelegramMessage(env, chatId, RATE_LIMIT_TEXT, messageId);
      } catch (error) {
        logger.warn("telegram_rate_limit_reply_failed", {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return withRequestId(json({ ok: true, rateLimited: true }), requestId);
  }

  if (begin.action === "retry_ack") {
    // A previous webhook attempt created the durable job but didn't finish the
    // acknowledgement step. We retry the acknowledgement before enqueueing.
  }

  let statusMessageId = begin.statusMessageId;

  if (!statusMessageId) {
    try {
      const statusMessage = await sendTelegramMessage(
        env,
        chatId,
        TELEGRAM_STATUS_TEXT,
        messageId,
      );
      statusMessageId = statusMessage.message_id;

      await jobStoreRequest(env, chatId, {
        action: "save_ack",
        updateId,
        statusMessageId,
      });
    } catch (error) {
      logger.warn("telegram_ack_failed", {
        requestId,
        updateId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const job: QuestionJob = {
    version: 1,
    updateId,
    chatId,
    question: text,
    messageId,
    requestId,
    createdAt: Date.now(),
    ...(statusMessageId ? { statusMessageId } : {}),
  };

  try {
    await enqueueQuestion(env, job);
  } catch (error) {
    logger.error("question_queue_enqueue_failed", {
      requestId,
      updateId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Returning non-2xx makes Telegram retry the webhook. The Durable Object
    // keeps the job/ack state, so the retry won't create a second user job.
    return withRequestId(json({ ok: false }, 500), requestId);
  }

  return withRequestId(json({ ok: true, queued: true }), requestId);
}

async function handleQuestionBatch(
  batch: MessageBatch<QuestionJob>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;

    if (!isValidQuestionJob(job)) {
      logger.error("invalid_question_job", { queueMessageId: message.id });
      message.ack();
      continue;
    }

    const claim = await jobStoreRequest<ClaimResponse>(env, job.chatId, {
      action: "claim",
      updateId: job.updateId,
      queueMessageId: message.id,
    });

    if (!claim.claimed || !claim.record) {
      message.ack();
      continue;
    }

    try {
      const answer = claim.record.answer ?? (await generateGeminiAnswer(env, job.question));

      if (!claim.record.answer) {
        await jobStoreRequest(env, job.chatId, {
          action: "set_answer",
          updateId: job.updateId,
          answer,
        });
      }

      await deliverAnswer(env, job, claim.record.statusMessageId, answer);

      await jobStoreRequest(env, job.chatId, {
        action: "complete",
        updateId: job.updateId,
      });

      logger.info("question_completed", {
        requestId: job.requestId,
        updateId: job.updateId,
        queueMessageId: message.id,
        answerLength: answer.length,
        attempts: message.attempts,
      });

      message.ack();
    } catch (error) {
      const retryable = isRetryableJobError(error);

      logger.error("question_processing_failed", {
        requestId: job.requestId,
        updateId: job.updateId,
        queueMessageId: message.id,
        attempts: message.attempts,
        retryable,
        error: error instanceof Error ? error.message : String(error),
      });

      if (retryable && message.attempts < QUEUE_MAX_RETRIES) {
        message.retry({ delaySeconds: queueRetryDelay(message.attempts) });
        continue;
      }

      try {
        await deliverAnswer(
          env,
          job,
          claim.record.statusMessageId,
          userFacingFailure(error),
        );

        await jobStoreRequest(env, job.chatId, {
          action: "complete",
          updateId: job.updateId,
        });

        message.ack();
      } catch (deliveryError) {
        logger.error("final_failure_delivery_failed", {
          requestId: job.requestId,
          updateId: job.updateId,
          error:
            deliveryError instanceof Error
              ? deliveryError.message
              : String(deliveryError),
        });
        message.retry({ delaySeconds: Math.min(300, queueRetryDelay(message.attempts)) });
      }
    }
  }
}

async function deliverAnswer(
  env: Env,
  job: QuestionJob,
  statusMessageId: number | undefined,
  answer: string,
): Promise<void> {
  if (statusMessageId) {
    try {
      await editTelegramMessage(env, job.chatId, statusMessageId, answer);
      return;
    } catch (error) {
      if (!isMessageEditTerminalError(error)) {
        throw error;
      }
    }
  }

  await sendTelegramMessage(env, job.chatId, answer, job.messageId);
}

function isMessageEditTerminalError(error: unknown): boolean {
  if (!(error instanceof TelegramError)) return false;
  const message = error.message.toLowerCase();
  return (
    error.status === 400 &&
    (message.includes("message to edit not found") ||
      message.includes("message can't be edited") ||
      message.includes("message identifier is not specified"))
  );
}

function userFacingFailure(error: unknown): string {
  if (error instanceof GeminiError) {
    if (error.status === 401 || error.status === 403) {
      return "AI service ki authentication/configuration mein problem aa gayi hai. Team isse check kar rahi hai. 🙏";
    }

    if (error.status === 429) {
      return "AI service par abhi bahut load hai. Tumhara doubt save hua hai; thodi der baad same question dobara bhejna. 🙏";
    }
  }

  return FINAL_FAILURE_TEXT;
}

function isRetryableJobError(error: unknown): boolean {
  if (error instanceof GeminiError) return error.retryable;
  if (error instanceof TelegramError) return error.retryable;
  return true;
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function positiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function queueRetryDelay(attempts: number): number {
  const delay = 15 * 2 ** Math.max(0, attempts - 1);
  return Math.min(delay, 600);
}

function isValidQuestionJob(value: unknown): value is QuestionJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<QuestionJob>;
  return (
    job.version === 1 &&
    Number.isSafeInteger(job.updateId) &&
    Number.isSafeInteger(job.chatId) &&
    Number.isSafeInteger(job.messageId) &&
    typeof job.question === "string" &&
    job.question.length > 0 &&
    typeof job.requestId === "string" &&
    job.requestId.length > 0 &&
    Number.isFinite(job.createdAt)
  );
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const requestId = getOrCreateRequestId(request);
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        if (request.method !== "GET") {
          return withRequestId(methodNotAllowed(["GET"]), requestId);
        }

        return withRequestId(
          json({
            ok: true,
            service: "parmar-ai",
            phase: "D",
            environment: env.ENVIRONMENT ?? "production",
            version: env.APP_VERSION ?? "1.0.0",
            timestamp: new Date().toISOString(),
            telegramConfigured: Boolean(
              env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET,
            ),
            vertexAiConfigured: Boolean(
              env.GCP_PROJECT_ID && env.GCP_CLIENT_EMAIL && env.GCP_PRIVATE_KEY,
            ),
            queueConfigured: Boolean(env.QUESTION_QUEUE),
            jobStoreConfigured: Boolean(env.JOB_DEDUPE),
            model: env.GEMINI_MODEL ?? "gemini-3.8-flash",
            location: env.GEMINI_LOCATION ?? "global",
          }),
          requestId,
        );
      }

      if (url.pathname === "/") {
        if (request.method !== "GET") {
          return withRequestId(methodNotAllowed(["GET"]), requestId);
        }

        return withRequestId(
          json({
            ok: true,
            service: "parmar-ai",
            phase: "D",
            status: "telegram_queue_vertex_ai",
          }),
          requestId,
        );
      }

      if (url.pathname === "/telegram/setup") {
        if (request.method !== "GET") {
          return withRequestId(methodNotAllowed(["GET"]), requestId);
        }
        return telegramSetup(request, env, requestId);
      }

      if (url.pathname === "/telegram/webhook") {
        if (request.method !== "POST") {
          return withRequestId(methodNotAllowed(["POST"]), requestId);
        }
        return handleTelegramWebhook(request, env, requestId);
      }

      return withRequestId(notFound(), requestId);
    } catch (error) {
      logger.error("unhandled_request_error", {
        requestId,
        route: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      return withRequestId(internalServerError(), requestId);
    }
  },

  async queue(batch: MessageBatch<QuestionJob>, env: Env): Promise<void> {
    await handleQuestionBatch(batch, env);
  },
} satisfies ExportedHandler<Env, QuestionJob>;

// Export the Durable Object class required by wrangler's declarative `exports`.
export { JobDedupe };
