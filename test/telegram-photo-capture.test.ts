import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import { captureBrvinContactPhoto } from "../src/telegram/photo-capture";

function makeEnv(overrides: Record<string, unknown> = {}) {
  const run = vi.fn(async () => ({ success: true }));
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind, run }));
  const env = {
    TELEGRAM_PHOTO_CAPTURE_ENABLED: "true",
    BOT_OWNER_TELEGRAM_USER_ID: "8554490661",
    DB: { prepare },
    ...overrides,
  } as unknown as Env;
  return { env, prepare, bind, run };
}

describe("temporary BRɅIN contact photo capture", () => {
  it("stores only the exact-caption photo sent by the configured owner in private chat", async () => {
    const { env, prepare, bind } = makeEnv();
    const captured = await captureBrvinContactPhoto(env, {
      senderId: 8554490661,
      chatId: 8554490661,
      chatType: "private",
      messageId: 42,
      caption: "Current BRɅIN contact image 2.",
      photos: [
        { file_id: "small-file-id", file_unique_id: "small", width: 90, height: 90, file_size: 1000 },
        { file_id: "largest-file-id", file_unique_id: "largest", width: 900, height: 300, file_size: 12000 },
      ],
    }, 1_800_000_000_000);

    expect(captured).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(bind).toHaveBeenLastCalledWith(
      "brvin-contact-image",
      "largest-file-id",
      "largest",
      8554490661,
      42,
      1_800_000_000_000,
      1_800_000_000_000 + 30 * 60 * 1000,
    );
  });

  it("does not capture another caption or another sender's photo", async () => {
    const { env, prepare } = makeEnv();
    const base = {
      senderId: 8554490661,
      chatId: 8554490661,
      chatType: "private",
      messageId: 42,
      photos: [{ file_id: "file-id" }],
    };
    await expect(captureBrvinContactPhoto(env, { ...base, caption: "other" })).resolves.toBe(false);
    await expect(captureBrvinContactPhoto(env, { ...base, senderId: 123, caption: "Current BRɅIN contact image 2." })).resolves.toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("does nothing when the temporary capture switch is disabled", async () => {
    const { env, prepare } = makeEnv({ TELEGRAM_PHOTO_CAPTURE_ENABLED: "false" });
    await expect(captureBrvinContactPhoto(env, {
      senderId: 8554490661,
      chatId: 8554490661,
      chatType: "private",
      messageId: 42,
      caption: "Current BRɅIN contact image 2.",
      photos: [{ file_id: "file-id" }],
    })).resolves.toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });
});
