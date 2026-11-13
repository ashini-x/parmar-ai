import { afterEach, describe, expect, it, vi } from "vitest";
import { getTelegramRetryDelayMs, sendTelegramVoiceWithToken } from "../src/telegram/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

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



describe("Telegram welcome voice delivery", () => {
  it("sends the hosted Opus recording as a silent voice note with the creator footer", async () => {
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
      reply_markup: {
        inline_keyboard: [[{
          text: "BRɅIN",
          web_app: { url: "https://parmar-ai.thenewtongs.workers.dev/contact" },
        }]],
      },
    });
  });
});
