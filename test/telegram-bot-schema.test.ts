import { describe, expect, it, vi } from "vitest";
import { ensureTelegramBotSchema } from "../src/telegram/bot-store";
import type { Env } from "../src/config/env";

describe("Telegram bot schema initialization", () => {
  it("creates only the bot-authentication schema and reuses it per D1 binding", async () => {
    const statements: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        statements.push(sql);
        return { run: vi.fn(async () => ({ success: true })) };
      }),
    };
    const env = { DB: db } as unknown as Env;

    await ensureTelegramBotSchema(env);
    await ensureTelegramBotSchema(env);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE TABLE IF NOT EXISTS telegram_bots");
    expect(statements[1]).toContain("idx_telegram_bots_one_active");
    expect(statements.join("\n")).not.toContain("CREATE TABLE IF NOT EXISTS users");
  });
});
