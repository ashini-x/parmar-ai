import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTelegramRetryDelayMs,
  sendTelegramBusinessMessage,
  sendTelegramMessageWithToken,
  sendTelegramVoiceWithToken,
} from "../src/telegram/api";
import type { Env } from "../src/config/env";

afterEach(() => {
  vi.unstubAllGlobals();
});

const creatorKeyboard = {
  inline_keyboard: [[{
    text: "BRɅIN",
    url: "tg://resolve?domain=projectbrain&profile",
  }]],
};

describe("Telegram retry_after handling", () => {
  it("honours Telegram retry_after values longer than five seconds", () => {
    expect(getTelegramRetryDelayMs(5)).toBe(5_000);
    expect(getTelegramRetryDelayMs(10)).toBe(10_000);
    expect(getTelegramRetryDelayMs(30)).toBe(30_000);
    expect(getTelegramRetryDelayMs(120)).toBe(120_000);
  });

  it("rounds fractional retry_after values up and retains a safe minimum", () => {
    expect(getTelegramRetryDelayMs(0.1)).toBe(250);
    expect(getTelegramRetryDelayMs(1.001)).toBe(1_001);
  });

  it("uses the one-second fallback for missing or invalid values", () => {
    expect(getTelegramRetryDelayMs()).toBe(1_000);
    expect(getTelegramRetryDelayMs(Number.NaN)).toBe(1_000);
    expect(getTelegramRetryDelayMs(Number.POSITIVE_INFINITY)).toBe(1_000);
    expect(getTelegramRetryDelayMs(0)).toBe(1_000);
    expect(getTelegramRetryDelayMs(-1)).toBe(1_000);
  });
});

describe("BRɅIN Telegram button", () => {
  it("uses a normal Telegram URL button below bot text messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 123 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessageWithToken("bot-token", 42, "Answer text"))
      .resolves.toEqual({ message_id: 123 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendMessage");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      chat_id: 42,
      text: "Answer text",
      reply_markup: creatorKeyboard,
    });
  });

  it("omits the BRɅIN footer button on personal-account business replies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 124 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const env = { TELEGRAM_BOT_TOKEN: "bot-token" } as unknown as Env;
    await expect(sendTelegramBusinessMessage(env, 42, 7, "business-connection", "I am BRɅIN."))
      .resolves.toEqual({ message_id: 124 });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendMessage");
    const payload = JSON.parse(String(requestInit.body));
    expect(payload).toMatchObject({
      chat_id: 42,
      business_connection_id: "business-connection",
      text: "I am BRɅIN.",
    });
    expect(payload).not.toHaveProperty("reply_markup");
  });
});

describe("Telegram welcome voice delivery", () => {
  it("sends the hosted Opus recording as a silent voice note with the Telegram profile button", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 123 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const voiceUrl = "https://raw.githubusercontent.com/ashini-x/parmar-ai/main/assets/telegram-welcome.ogg";
    await expect(sendTelegramVoiceWithToken("bot-token", 42, voiceUrl)).resolves.toEqual({ message_id: 123 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendVoice");
    expect(requestInit.method).toBe("POST");
    expect(JSON.parse(String(requestInit.body))).toEqual({
      chat_id: 42,
      voice: voiceUrl,
      disable_notification: true,
      reply_markup: creatorKeyboard,
    });
  });
});
