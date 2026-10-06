import { describe, expect, it } from "vitest";
import { isAdminTelegramUser, parseTelegramUserIdSet } from "../src/analytics/db";

describe("privileged Telegram access", () => {
  it("parses valid comma-separated Telegram IDs", () => {
    expect([...parseTelegramUserIdSet("123, 456, bad, -9, 123")]).toEqual([123, 456]);
  });

  it("recognizes the configured owner and additional admins", () => {
    const env = {
      BOT_OWNER_TELEGRAM_USER_ID: "123",
      ADMIN_TELEGRAM_USER_IDS: "456,789",
    } as any;
    expect(isAdminTelegramUser(env, 123)).toBe(true);
    expect(isAdminTelegramUser(env, 456)).toBe(true);
    expect(isAdminTelegramUser(env, 999)).toBe(false);
  });
});
