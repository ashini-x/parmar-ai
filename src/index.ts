import type {
  ExecutionContext,
  ExportedHandler,
} from "@cloudflare/workers-types";

import type { Env } from "./config/env";
import { generateGeminiAnswer, GeminiError } from "./ai/gemini";
import { getMiniAppHtml } from "./mini-app";
import { logger } from "./core/logger";
import {
  addRequestId,
  getOrCreateRequestId,
} from "./core/request-id";
import {
  internalServerError,
  json,
  methodNotAllowed,
  notFound,
} from "./http/response";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_REQUEST_TIMEOUT_MS = 8_000;

interface TelegramMessage {
  chat?: {
    id?: number;
  };
  text?: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

function withRequestId(
  response: Response,
  requestId: string,
): Response {
  return addRequestId(response, requestId);
}

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();

  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.length !== bBytes.length) {
    return false;
  }

  let result = 0;

  for (let index = 0; index < aBytes.length; index += 1) {
    result |= aBytes[index] ^ bBytes[index];
  }

  return result === 0;
}

function jsonResponse(
  body: unknown,
  status = 200,
  requestId?: string,
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=UTF-8",
  };

  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

async function telegramApi<T = unknown>(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "Telegram bot token is not configured.",
    );
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    TELEGRAM_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    const raw = await response.text();

    let data: TelegramApiResponse<T>;

    try {
      data = JSON.parse(
        raw,
      ) as TelegramApiResponse<T>;
    } catch {
      throw new Error(
        `Telegram returned invalid JSON (HTTP ${response.status}).`,
      );
    }

    if (!response.ok || !data.ok) {
      throw new Error(
        data.description ??
          `Telegram API request failed (HTTP ${response.status}).`,
      );
    }

    return data.result as T;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        `Telegram API timed out after ${TELEGRAM_REQUEST_TIMEOUT_MS}ms.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string,
): Promise<void> {
  const chunks = splitMessage(
    text,
    TELEGRAM_MAX_MESSAGE_LENGTH,
  );

  for (const chunk of chunks) {
    await telegramApi(env, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
}

function splitMessage(
  text: string,
  maxLength: number,
): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf(
      "\n\n",
      maxLength,
    );

    if (splitAt < 500) {
      splitAt = remaining.lastIndexOf(
        "\n",
        maxLength,
      );
    }

    if (splitAt < 500) {
      splitAt = remaining.lastIndexOf(
        " ",
        maxLength,
      );
    }

    if (splitAt < 1) {
      splitAt = maxLength;
    }

    chunks.push(
      remaining.slice(0, splitAt).trim(),
    );

    remaining = remaining
      .slice(splitAt)
      .trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

async function setupTelegramWebhook(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return jsonResponse(
      {
        ok: false,
        error: "telegram_bot_token_missing",
      },
      500,
      requestId,
    );
  }

  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return jsonResponse(
      {
        ok: false,
        error: "telegram_webhook_secret_missing",
      },
      500,
      requestId,
    );
  }

  const setupUrl = new URL(request.url);
  const providedSecret =
    setupUrl.searchParams.get("key");

  if (
    !providedSecret ||
    !env.TELEGRAM_SETUP_SECRET ||
    !safeEqual(
      providedSecret,
      env.TELEGRAM_SETUP_SECRET,
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "unauthorized",
      },
      401,
      requestId,
    );
  }

  const webhookUrl =
    `${setupUrl.origin}/telegram/webhook`;

  const telegramData =
    await telegramApi(
      env,
      "setWebhook",
      {
        url: webhookUrl,
        secret_token:
          env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message"],
        drop_pending_updates: false,
      },
    );

  logger.info(
    "telegram_webhook_setup",
    {
      requestId,
      webhookUrl,
    },
  );

  return jsonResponse(
    {
      ok: true,
      telegram: {
        ok: true,
        result: telegramData,
      },
      webhook: webhookUrl,
    },
    200,
    requestId,
  );
}

function getUserFacingGeminiError(
  error: unknown,
): string {
  if (error instanceof GeminiError) {
    if (error.status === 429) {
      return (
        "Abhi AI system par load zyada hai. " +
        "Thodi der mein dobara try karo."
      );
    }

    if (
      error.status === 401 ||
      error.status === 403
    ) {
      return (
        "AI system ki configuration mein " +
        "problem aa gayi hai."
      );
    }

    if (
      error.message
        .toLowerCase()
        .includes("timed out")
    ) {
      return (
        "Answer banane mein thoda zyada time " +
        "lag gaya. Dobara try karo."
      );
    }

    logger.error(
      "gemini_error_details",
      {
        status: error.status,
        message: error.message,
      },
    );
  }

  return (
    "Bhai, abhi answer generate nahi ho paaya. " +
    "Dobara try karo."
  );
}

async function processQuestionInBackground(
  env: Env,
  chatId: number,
  question: string,
  requestId: string,
): Promise<void> {
  try {
    logger.info(
      "gemini_generation_started",
      {
        requestId,
        chatId: String(chatId),
        questionLength: question.length,
      },
    );

    const answer =
      await generateGeminiAnswer(
        env,
        question,
      );

    logger.info(
      "gemini_generation_completed",
      {
        requestId,
        chatId: String(chatId),
        answerLength: answer.length,
      },
    );

    await sendTelegramMessage(
      env,
      chatId,
      answer,
    );
  } catch (error) {
    logger.error(
      "gemini_generation_failed",
      {
        requestId,
        chatId: String(chatId),
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );

    try {
      await sendTelegramMessage(
        env,
        chatId,
        getUserFacingGeminiError(error),
      );
    } catch (telegramError) {
      logger.error(
        "telegram_error_message_failed",
        {
          requestId,
          chatId: String(chatId),
          error:
            telegramError instanceof Error
              ? telegramError.message
              : String(telegramError),
        },
      );
    }
  }
}

async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  requestId: string,
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return new Response(
      "Telegram bot token is not configured.",
      { status: 500 },
    );
  }

  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response(
      "Telegram webhook secret is not configured.",
      { status: 500 },
    );
  }

  const receivedSecret =
    request.headers.get(
      "X-Telegram-Bot-Api-Secret-Token",
    );

  if (
    !receivedSecret ||
    !safeEqual(
      receivedSecret,
      env.TELEGRAM_WEBHOOK_SECRET,
    )
  ) {
    logger.error(
      "telegram_webhook_unauthorized",
      {},
    );

    return new Response(
      "Unauthorized.",
      { status: 401 },
    );
  }

  let update: TelegramUpdate;

  try {
    update =
      (await request.json()) as TelegramUpdate;
  } catch {
    return new Response(
      "Invalid webhook payload.",
      { status: 400 },
    );
  }

  const message = update.message;

  if (!message?.chat?.id) {
    return new Response(
      "OK",
      { status: 200 },
    );
  }

  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";

  logger.info(
    "telegram_message_received",
    {
      requestId,
      chatId: String(chatId),
      updateId: update.update_id,
      textLength: text.length,
    },
  );

  if (!text) {
    await sendTelegramMessage(
      env,
      chatId,
      "Abhi main text questions handle kar raha hoon. 😊",
    );

    return new Response(
      "OK",
      { status: 200 },
    );
  }

  if (
    text === "/start" ||
    text.startsWith("/start ")
  ) {
    await sendTelegramMessage(
      env,
      chatId,
      "So Hello Everyone, umeed karta hoon aap sabhi thik honge! \n\nTHANKOO :)",
    );

    return new Response(
      "OK",
      { status: 200 },
    );
  }

  /*
   * IMPORTANT:
   * We send the acknowledgement BEFORE starting
   * background AI work. This proves the webhook itself
   * is working independently of Gemini.
   */
  await sendTelegramMessage(
    env,
    chatId,
    "Soch raha hoon bhai... 🤔",
  );

  /*
   * Gemini generation happens after Telegram has already
   * been acknowledged. Cloudflare keeps this task alive
   * through waitUntil().
   */
  ctx.waitUntil(
    processQuestionInBackground(
      env,
      chatId,
      text,
      requestId,
    ),
  );

  return new Response(
    "OK",
    { status: 200 },
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const requestId =
      getOrCreateRequestId(request);

    const url = new URL(request.url);
    const route = url.pathname;

    try {
      if (
        request.method === "GET" &&
        route === "/health"
      ) {
        const config = {
          environment:
            env.ENVIRONMENT ??
            "development",
          version:
            env.APP_VERSION ??
            "0.1.0",
        };

        const response = json({
          ok: true,
          service: "parmar-ai",
          phase: "C",
          environment:
            config.environment,
          version:
            config.version,
          timestamp:
            new Date().toISOString(),
          telegram:
            Boolean(
              env.TELEGRAM_BOT_TOKEN,
            ),
          gemini:
            Boolean(
              env.GEMINI_API_KEY,
            ),
        });

        return withRequestId(
          response,
          requestId,
        );
      }

      if (
        request.method === "GET" &&
        route === "/"
      ) {
        return withRequestId(
          json({
            ok: true,
            service: "parmar-ai",
            phase: "C",
            status:
              "gemini_text_answer_mvp",
          }),
          requestId,
        );
      }

      if (
        request.method === "GET" &&
        route === "/telegram/setup"
      ) {
        return setupTelegramWebhook(
          request,
          env,
          requestId,
        );
      }

      if (
        route === "/telegram/webhook"
      ) {
        if (
          request.method !== "POST"
        ) {
          return withRequestId(
            methodNotAllowed(["POST"]),
            requestId,
          );
        }

        return handleTelegramWebhook(
          request,
          env,
          ctx,
          requestId,
        );
      }

      if (
        route === "/health" ||
        route === "/"
      ) {
        return withRequestId(
          methodNotAllowed(["GET"]),
          requestId,
        );
      }

      return withRequestId(
        notFound(),
        requestId,
      );
    } catch (error) {
      logger.error(
        "unhandled_request_error",
        {
          requestId,
          route,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );

      return withRequestId(
        internalServerError(),
        requestId,
      );
    }
  },
} satisfies ExportedHandler<Env>;
