import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import { ensureTelegramBotSchema } from "../src/telegram/bot-store";
import { ensureRuntimeAnalyticsSchema } from "../src/analytics/db";

describe("Telegram bot schema initialization", () => {
  it("ensures only the bot credential table and active-connection index", async () => {
    const preparedSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        preparedSql.push(sql);
        return { sql };
      }),
      batch: vi.fn(async (statements: unknown[]) => statements),
    };
    const env = { DB: db } as unknown as Env;

    await Promise.all([
      ensureTelegramBotSchema(env),
      ensureTelegramBotSchema(env),
    ]);

    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(preparedSql).toHaveLength(2);
    expect(preparedSql[0]).toContain("CREATE TABLE IF NOT EXISTS telegram_bots");
    expect(preparedSql[1]).toContain("idx_telegram_bots_one_active");
    expect(preparedSql.join("\n")).not.toContain("CREATE TABLE IF NOT EXISTS users");
    expect(preparedSql.join("\n")).not.toContain("brvin_projects");
  });
});


describe("Telegram runtime analytics schema initialization", () => {
  it("creates only the Telegram runtime tables and allows safe concurrent first-use setup", async () => {
    const preparedSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        preparedSql.push(sql);
        return { sql };
      }),
      batch: vi.fn(async (statements: unknown[]) => statements),
    };
    const env = { DB: db } as unknown as Env;

    await Promise.all([
      ensureRuntimeAnalyticsSchema(env),
      ensureRuntimeAnalyticsSchema(env),
      ensureRuntimeAnalyticsSchema(env),
    ]);

    // Requests must not await a module-global in-flight Promise created by
    // another request context. CREATE IF NOT EXISTS makes each concurrent
    // first-use batch safe; completed setup is cached for later requests.
    expect(db.batch).toHaveBeenCalledTimes(3);
    await ensureRuntimeAnalyticsSchema(env);
    expect(db.batch).toHaveBeenCalledTimes(3);
    const sql = preparedSql.join("\n");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS events");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS questions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_usage_attempts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_access_overrides");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS admin_user_controls");
    expect(sql).toContain("idx_questions_received");
    expect(sql).not.toContain("brvin_projects");
    expect(sql).not.toContain("brvin_service_clients");
    expect(sql).not.toContain("ALTER TABLE");
  });
});
