import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTelegramRetryDelayMs,
  sendTelegramBusinessMessage,
  sendTelegramMessageWithToken,
  sendTelegramVoiceWithToken,
  editTelegramMessageReplyMarkup,
  buildFatmanStartMarkup,
  buildFatmanExitMarkup,
  buildHelpMenuMarkup,
  buildAdminContactMarkup,
} from "../src/telegram/api";
import type { Env } from "../src/config/env";

afterEach(() => {
  vi.unstubAllGlobals();
});

const creatorKeyboard = {
  inline_keyboard: [[{
    text: "BRɅIN",
    callback_data: "creator:contact",
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

describe("Telegram Fatman transition keyboard", () => {
  it("clears the clicked message keyboard without adding another button", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: true,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const env = { TELEGRAM_BOT_TOKEN: "bot-token" } as unknown as Env;
    await expect(editTelegramMessageReplyMarkup(
      env, 42, 777, { inline_keyboard: [] }, undefined, false,
    )).resolves.toBeUndefined();

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/editMessageReplyMarkup");
    expect(JSON.parse(String(requestInit.body))).toEqual({
      chat_id: 42,
      message_id: 777,
      reply_markup: { inline_keyboard: [] },
    });
  });
});

describe("BRɅIN Telegram button", () => {
  it("uses a callback button below bot text messages so the footer can be removed", async () => {
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

  it("sends Fatman answers with only the Exit Fatman inline button", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 126 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessageWithToken(
      "bot-token", 42, "Fatman answer", undefined, false, buildFatmanExitMarkup(),
    )).resolves.toEqual({ message_id: 126 });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendMessage");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      chat_id: 42,
      text: "Fatman answer",
      reply_markup: {
        inline_keyboard: [[{ text: "Exit Fatman", callback_data: "fatman:exit" }]],
      },
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

describe("Telegram Admin contact buttons", () => {
  it("sends the exact two-paragraph Admin contact copy and plain contact buttons", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 128 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessageWithToken(
      "bot-token", 42, "You can contact us via Telegram or Instagram.\n\nFor business queries, please send an email to admin@brvin.in", undefined, false, buildAdminContactMarkup(),
    )).resolves.toEqual({ message_id: 128 });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendMessage");
    expect(JSON.parse(String(requestInit.body))).toEqual({
      chat_id: 42,
      text: "You can contact us via Telegram or Instagram.\n\nFor business queries, please send an email to admin@brvin.in",
      reply_markup: {
        inline_keyboard: [[
          { text: "Telegram", url: "tg://resolve?domain=projectbrain&profile" },
          { text: "Instagram", url: "https://instagram.com/brvin.in" },
        ]],
      },
      link_preview_options: { is_disabled: true },
    });
  });
});

describe("Telegram welcome voice delivery", () => {
  it("sends the Help voice with all four controls in one inline row and no BRɅIN footer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 127 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const voiceUrl = "https://raw.githubusercontent.com/ashini-x/parmar-ai/main/assets/telegram-welcome.ogg";
    await expect(sendTelegramVoiceWithToken(
      "bot-token", 42, voiceUrl, false, buildHelpMenuMarkup(),
    )).resolves.toEqual({ message_id: 127 });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendVoice");
    expect(JSON.parse(String(requestInit.body))).toEqual({
      chat_id: 42,
      voice: voiceUrl,
      disable_notification: true,
      reply_markup: {
        inline_keyboard: [[
          { text: "Exam", callback_data: "help:exam" },
          { text: "Profile", callback_data: "help:profile" },
          { text: "Reset", callback_data: "help:reset" },
          { text: "Delete", callback_data: "help:delete" },
        ]],
      },
    });
  });

  it("sends the Parmar Sir voice with only a Start Fatman callback button", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 125 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const voiceUrl = "https://raw.githubusercontent.com/ashini-x/parmar-ai/main/assets/telegram-welcome.ogg";
    await expect(sendTelegramVoiceWithToken(
      "bot-token", 42, voiceUrl, false, buildFatmanStartMarkup(),
    )).resolves.toEqual({ message_id: 125 });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendVoice");
    expect(JSON.parse(String(requestInit.body))).toEqual({
      chat_id: 42,
      voice: voiceUrl,
      disable_notification: true,
      reply_markup: {
        inline_keyboard: [[{ text: "Start Fatman", callback_data: "fatman:enter" }]],
      },
    });
  });

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
