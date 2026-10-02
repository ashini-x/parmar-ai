import type { ExecutionContext, ExportedHandler } from "@cloudflare/workers-types";
import { Bot, webhookCallback } from "grammy";

import { getConfig, type Env } from "./config/env";
import { logger } from "./core/logger";
import { addRequestId, getOrCreateRequestId } from "./core/request-id";
import {
  internalServerError,
  json,
  methodNotAllowed,
  notFound,
} from "./http/response";

function withRequestId(response: Response, requestId: string): Response {
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

async function handleTelegramWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return new Response("Telegram bot token is not configured.", {
      status: 500,
    });
  }

  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Telegram webhook secret is not configured.", {
      status: 500,
    });
  }

  const receivedSecret = request.headers.get(
    "X-Telegram-Bot-Api-Secret-Token",
  );

  if (
    !receivedSecret ||
    !safeEqual(receivedSecret, env.TELEGRAM_WEBHOOK_SECRET)
  ) {
    return new Response("Unauthorized.", {
      status: 401,
    });
  }

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "So Hello Everyone, umeed karta hoon aap sabhi thik honge! \n\nTHANKOO :)",
    );
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();

    if (!text || text.startsWith("/")) {
      return;
    }

    await ctx.reply(
      `Mila bhai. 👌\n\nTumne poocha:\n“${text}”\n\nAI engine abhi connect karna baaki hai — next step mein Gemini lagega.`,
    );
  });

  const callback = webhookCallback(bot, "cloudflare-mod");

  return callback(request);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
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
            phase: "B",
            status: "telegram_integration",
          }),
          requestId,
        );
      }

      if (request.method === "GET" && route === "/telegram/setup") {
        return setupTelegramWebhook(request, env, requestId);
      }

      if (route === "/telegram/webhook") {
        if (request.method !== "POST") {
          return withRequestId(
            methodNotAllowed(["POST"]),
            requestId,
          );
        }

        return await handleTelegramWebhook(request, env);
      }

      if (route === "/health" || route === "/") {
        return withRequestId(
          methodNotAllowed(["GET"]),
          requestId,
        );
      }

      return withRequestId(notFound(), requestId);
    } catch (error) {
      logger.error("unhandled_request_error", {
        requestId,
        route,
        error: error instanceof Error ? error.message : String(error),
      });

      return withRequestId(internalServerError(), requestId);
    }
  },
} satisfies ExportedHandler<Env>;
