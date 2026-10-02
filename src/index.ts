import type {
  ExecutionContext,
  ExportedHandler,
} from "@cloudflare/workers-types";

import { Bot } from "grammy";
import type { Update } from "grammy";

import { generateGeminiAnswer, GeminiError } from "./ai/gemini";
import { getConfig, type Env } from "./config/env";
import { logger } from "./core/logger";
import { addRequestId, getOrCreateRequestId } from "./core/request-id";
import {
  internalServerError,
  json,
  methodNotAllowed,
  notFound,
} from "./http/response";

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
  const providedSecret = setupUrl.searchParams.get("key");

  if (
    !providedSecret ||
    !env.TELEGRAM_SETUP_SECRET ||
    !safeEqual(providedSecret, env.TELEGRAM_SETUP_SECRET)
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

  const webhookUrl = `${setupUrl.origin}/telegram/webhook`;

  const telegramResponse = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message"],
        drop_pending_updates: false,
      }),
    },
  );

  const telegramData = await telegramResponse.json();

  logger.info("telegram_webhook_setup", {
    requestId,
    webhookUrl,
    telegramOk:
      typeof telegramData === "object" &&
      telegramData !== null &&
      "ok" in telegramData
        ? Boolean((telegramData as { ok?: unknown }).ok)
        : false,
  });

  return jsonResponse(
    {
      ok: telegramResponse.ok,
      telegram: telegramData,
      webhook: webhookUrl,
    },
    telegramResponse.ok ? 200 : 502,
    requestId,
  );
}

function createBot(env: Env): Bot {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram bot token is not configured.");
  }

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Chaliye, \n\n" +
        "poochiye doubts!",
    );
  });

  bot.on("message:text", async (ctx) => {
    const userText = ctx.message.text.trim();

    if (!userText || userText.startsWith("/")) {
      return;
    }

    try {
      await ctx.reply("Soch raha hoon ... 🤔");

      const answer = await generateGeminiAnswer(
        env,
        userText,
      );

      await sendTelegramAnswer(ctx, answer);
    } catch (error) {
      const message = getUserFacingGeminiError(error);

      logger.error("gemini_generation_failed", {
        chatId: String(ctx.chat.id),
        error:
          error instanceof Error ? error.message : String(error),
      });

      await ctx.reply(message);
    }
  });

  bot.catch((error) => {
    logger.error("telegram_update_failed", {
      error:
        error.error instanceof Error
          ? error.error.message
          : String(error.error),
    });
  });

  return bot;
}

async function sendTelegramAnswer(
  ctx: Parameters<Bot["on"]>[2] extends never ? never : any,
  answer: string,
): Promise<void> {
  const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

  if (answer.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    await ctx.reply(answer);
    return;
  }

  const chunks = splitMessage(answer, TELEGRAM_MAX_MESSAGE_LENGTH);

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

function splitMessage(
  text: string,
  maxLength: number,
): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);

    if (splitAt < 500) {
      splitAt = remaining.lastIndexOf("\n", maxLength);
    }

    if (splitAt < 500) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }

    if (splitAt < 1) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function getUserFacingGeminiError(error: unknown): string {
  if (error instanceof GeminiError) {
    if (error.status === 429) {
      return "Abhi AI service par load zyada hai. Thodi der mein dobara try karo.";
    }

    if (error.status === 401 || error.status === 403) {
      return "AI service configuration mein problem aa gayi hai. Admin ko check karna hoga.";
    }

    if (error.message.toLowerCase().includes("timed out")) {
      return "Answer banane mein thoda zyada time lag gaya. Doobara try karo.";
    }
  }

  return "Bhai, abhi answer generate nahi ho paaya. Doobara try karo.";
}

async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
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

  const receivedSecret = request.headers.get(
    "X-Telegram-Bot-Api-Secret-Token",
  );

  if (
    !receivedSecret ||
    !safeEqual(
      receivedSecret,
      env.TELEGRAM_WEBHOOK_SECRET,
    )
  ) {
    return new Response("Unauthorized.", {
      status: 401,
    });
  }

  let update: Update;

  try {
    update = (await request.json()) as Update;
  } catch {
    return new Response("Invalid webhook payload.", {
      status: 400,
    });
  }

  const bot = createBot(env);

  /*
   * Respond to Telegram immediately so webhook delivery is not held
   * open while Gemini generates the answer.
   *
   * Cloudflare waitUntil keeps the background task alive after the
   * response is returned.
   */
  ctx.waitUntil(
    bot.handleUpdate(update).catch((error) => {
      logger.error("telegram_background_update_failed", {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }),
  );

  return new Response("OK", {
    status: 200,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const requestId = getOrCreateRequestId(request);
    const url = new URL(request.url);
    const route = url.pathname;

    try {
      if (request.method === "GET" && route === "/health") {
        const config = getConfig(env);

        const response = json({
          ok: true,
          service: "parmar-ai",
          environment: config.environment,
          version: config.version,
          timestamp: new Date().toISOString(),
          telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
          gemini: Boolean(env.GEMINI_API_KEY),
        });

        logger.info("health_check", {
          requestId,
          route,
        });

        return withRequestId(response, requestId);
      }

      if (request.method === "GET" && route === "/") {
        return withRequestId(
          json({
            ok: true,
            service: "parmar-ai",
            phase: "C",
            status: "gemini_text_answer_mvp",
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

      if (route === "/telegram/webhook") {
        if (request.method !== "POST") {
          return withRequestId(
            methodNotAllowed(["POST"]),
            requestId,
          );
        }

        return await handleTelegramWebhook(
          request,
          env,
          ctx,
        );
      }

      if (route === "/health" || route === "/") {
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
      logger.error("unhandled_request_error", {
        requestId,
        route,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });

      return withRequestId(
        internalServerError(),
        requestId,
      );
    }
  },
} satisfies ExportedHandler<Env>;
