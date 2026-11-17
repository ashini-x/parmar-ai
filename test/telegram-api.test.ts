import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTelegramRetryDelayMs,
  sendTelegramBusinessMessage,
  sendTelegramQuiz,
  sendTelegramMessage,
  editTelegramMessage,
  editTelegramProgressMessage,
  editTelegramMessageWithToken,
  sendTelegramMessageWithToken,
  sendTelegramAdminContactMessageWithToken,
  sendTelegramVoiceWithToken,
  editTelegramMessageReplyMarkup,
  buildFatmanStartMarkup,
  buildFatmanExitMarkup,
  buildHelpMenuMarkup,
  buildExamSelectionMarkup,
  buildExamChangeMarkup,
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

describe("Telegram SSC exam selection keyboard", () => {
  it("shows six short SSC-only choices as clickable buttons in two columns", () => {
    expect(buildExamSelectionMarkup()).toEqual({
      inline_keyboard: [
        [
          { text: "CGL", callback_data: "exam:cgl" },
          { text: "CHSL", callback_data: "exam:chsl" },
        ],
        [
          { text: "CPO", callback_data: "exam:cpo" },
          { text: "MTS", callback_data: "exam:mts" },
        ],
        [
          { text: "GD", callback_data: "exam:gd" },
          { text: "STENO", callback_data: "exam:steno" },
        ],
      ],
    });
  });

  it("offers one concise action to change the saved target exam", () => {
    expect(buildExamChangeMarkup()).toEqual({
      inline_keyboard: [[{ text: "Change exam", callback_data: "exam:menu" }]],
    });
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

    await expect(sendTelegramMessageWithToken("bot-token", 42, "**Answer text**"))
      .resolves.toEqual({ message_id: 123 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendMessage");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      chat_id: 42,
      text: "<b>Answer text</b>",
      parse_mode: "HTML",
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
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Exit Fatman", callback_data: "fatman:exit" }]],
      },
    });
  });

  it("sends personal-account business replies with the Instagram follow button", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 124 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const env = { TELEGRAM_BOT_TOKEN: "bot-token" } as unknown as Env;
    await expect(sendTelegramBusinessMessage(
      env,
      42,
      7,
      "business-connection",
      "Hi there, we've received your message.",
      undefined,
      { inline_keyboard: [[{ text: "Follow us on Instagram", url: "https://instagram.com/brvin.in" }]] },
    )).resolves.toEqual({ message_id: 124 });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendMessage");
    const payload = JSON.parse(String(requestInit.body));
    expect(payload).toMatchObject({
      chat_id: 42,
      business_connection_id: "business-connection",
      text: "Hi there, we've received your message.",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{
          text: "Follow us on Instagram",
          url: "https://instagram.com/brvin.in",
        }]],
      },
      reply_parameters: {
        message_id: 7,
        allow_sending_without_reply: true,
      },
    });
  });
});

describe("Telegram Admin contact message", () => {
  it("sends the existing text-only contact message and original buttons without a photo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 128 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramAdminContactMessageWithToken("bot-token", 42, 777))
      .resolves.toEqual({ message_id: 128 });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/sendMessage");
    expect(requestInit.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      chat_id: 42,
      text: "<b>परमार्थAI by BRɅIN.</b>\n\nYou can contact us via Telegram or Instagram. For business queries, please send an email to partners@brvin.in",
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "Telegram", url: "tg://resolve?domain=projectbrain&profile" },
          { text: "Instagram", url: "https://instagram.com/brvin.in" },
        ]],
      },
      reply_parameters: {
        message_id: 777,
        allow_sending_without_reply: true,
      },
    });
  });
});

describe("Telegram profile contact footer", () => {
  it("uses a clear contact label without changing the default footer used elsewhere", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 134 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const env = { TELEGRAM_BOT_TOKEN: "bot-token" } as unknown as Env;
    await expect(sendTelegramMessage(
      env, 42, "Study profile", undefined, undefined, true, undefined, "Contact BRɅIN",
    )).resolves.toEqual({ message_id: 134 });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body)).reply_markup).toEqual({
      inline_keyboard: [[{
        text: "Contact BRɅIN",
        callback_data: "creator:contact",
      }]],
    });
  });
});

describe("Telegram HTML rich-text delivery", () => {
  it("formats bold text on a normal sendMessage payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 129 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const env = { TELEGRAM_BOT_TOKEN: "bot-token" } as unknown as Env;
    await expect(sendTelegramMessage(env, 42, "**Important** <do not treat as HTML>", undefined, undefined, false))
      .resolves.toEqual({ message_id: 129 });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      text: "<b>Important</b> &lt;do not treat as HTML&gt;",
      parse_mode: "HTML",
    });
  });

  it("formats edits using the same HTML rules", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 130 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const env = { TELEGRAM_BOT_TOKEN: "bot-token" } as unknown as Env;
    await expect(editTelegramMessage(env, 42, 777, "**Updated** answer", undefined, false))
      .resolves.toBeUndefined();

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      text: "<b>Updated</b> answer",
      parse_mode: "HTML",
    });
  });

  it("formats cosmetic progress edits with HTML parse mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 132 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const env = { TELEGRAM_BOT_TOKEN: "bot-token" } as unknown as Env;
    await expect(editTelegramProgressMessage(env, 42, 777, "**Checking sources**"))
      .resolves.toBeUndefined();

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://api.telegram.org/botbot-token/editMessageText");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      chat_id: 42,
      message_id: 777,
      text: "<b>Checking sources</b>",
      parse_mode: "HTML",
    });
  });

  it("formats token-bound message edits with HTML parse mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 133 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(editTelegramMessageWithToken("bot-token", 42, 777, "**Final answer**"))
      .resolves.toBeUndefined();

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      chat_id: 42,
      message_id: 777,
      text: "<b>Final answer</b>",
      parse_mode: "HTML",
    });
  });

  it("formats native quiz explanations and removes unsupported Markdown wrappers from poll labels", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 131, poll: { id: "poll-131" } },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const env = { TELEGRAM_BOT_TOKEN: "bot-token" } as unknown as Env;
    await expect(sendTelegramQuiz(
      env, 42, "**Which Article?**", ["**Article 21**", "Article 23"], [0],
      "**Correct.** Article 21 protects life and personal liberty.", undefined, undefined, false,
    )).resolves.toEqual({ message_id: 131, poll_id: "poll-131" });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      question: "Which Article?",
      options: [{ text: "Article 21" }, { text: "Article 23" }],
      explanation: "<b>Correct.</b> Article 21 protects life and personal liberty.",
      explanation_parse_mode: "HTML",
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
