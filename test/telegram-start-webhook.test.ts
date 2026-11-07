import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src";
import type { Env } from "../src/config/env";

describe("Telegram /start webhook response", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the original welcome as a Telegram webhook method without a second Bot API request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
      },
      body: JSON.stringify({
        update_id: 1001,
        message: {
          message_id: 7,
          chat: { id: 12345, type: "private" },
          from: { id: 12345, is_bot: false, first_name: "Test" },
          text: "/start",
        },
      }),
    });

    const testEnv = Object.assign(Object.create(env), {
      DB: undefined,
      TELEGRAM_BOT_TOKEN: "test-bot-token",
      TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
      GCP_CLIENT_EMAIL: "",
      GCP_PRIVATE_KEY: "",
    }) as Env;

    const ctx = createExecutionContext();
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      method: "sendMessage",
      chat_id: 12345,
      text: "So Hello Everyone, umeed karta hoon aap sabhi thik honge!\n\nChalo, sawaal lao, seedha point pe aate hain!",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
