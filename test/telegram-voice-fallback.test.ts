import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendTelegramMessageWithToken,
  sendTelegramVoiceWithToken,
} from "../src/telegram/api";
import { sendTelegramVoiceWithPrivacyFallback } from "../src/telegram/voice-fallback";

vi.mock("../src/telegram/api", () => ({
  sendTelegramMessageWithToken: vi.fn(),
  sendTelegramVoiceWithToken: vi.fn(),
}));

describe("Telegram voice privacy fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps normal voice delivery unchanged when Telegram accepts it", async () => {
    vi.mocked(sendTelegramVoiceWithToken).mockResolvedValueOnce({ message_id: 10 } as never);

    await sendTelegramVoiceWithPrivacyFallback({
      command: "help",
      token: "test-token",
      chatId: 123,
      voiceUrl: "https://example.test/voice.ogg",
      fallbackText: "Here are the help options.",
    });

    expect(sendTelegramVoiceWithToken).toHaveBeenCalledOnce();
    expect(sendTelegramMessageWithToken).not.toHaveBeenCalled();
  });

  it("explains the Telegram privacy setting and preserves the help buttons when voice is forbidden", async () => {
    vi.mocked(sendTelegramVoiceWithToken).mockRejectedValueOnce(
      new Error("Bad Request: VOICE_MESSAGES_FORBIDDEN"),
    );
    const markup = { inline_keyboard: [[{ text: "Exam", callback_data: "help:exam" }]] };

    await sendTelegramVoiceWithPrivacyFallback({
      command: "help",
      token: "test-token",
      chatId: 123,
      voiceUrl: "https://example.test/voice.ogg",
      fallbackText: "Here are the help options. Use the buttons below.",
      includeCreatorFooter: false,
      replyMarkup: markup,
    });

    expect(sendTelegramMessageWithToken).toHaveBeenCalledOnce();
    const [token, chatId, text, replyToMessageId, includeCreatorFooter, replyMarkup] =
      vi.mocked(sendTelegramMessageWithToken).mock.calls[0];
    expect(token).toBe("test-token");
    expect(chatId).toBe(123);
    expect(text).toContain("Telegram Settings → Privacy and Security → Voice Messages");
    expect(text).toContain("“Everybody”");
    expect(text).toContain("“Always Allow”");
    expect(text).toContain("Then try the command again.");
    expect(replyToMessageId).toBeUndefined();
    expect(includeCreatorFooter).toBe(false);
    expect(replyMarkup).toEqual(markup);
  });

  it("does not mislabel unrelated Telegram voice failures as privacy restrictions", async () => {
    vi.mocked(sendTelegramVoiceWithToken).mockRejectedValueOnce(
      new Error("Bad Request: file must be non-empty"),
    );

    await expect(sendTelegramVoiceWithPrivacyFallback({
      command: "start",
      token: "test-token",
      chatId: 123,
      voiceUrl: "https://example.test/voice.ogg",
      fallbackText: "Welcome.",
    })).rejects.toThrow("file must be non-empty");

    expect(sendTelegramMessageWithToken).not.toHaveBeenCalled();
  });
});
