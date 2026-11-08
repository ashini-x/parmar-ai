import { describe, expect, it } from "vitest";
import { getTelegramRetryDelayMs } from "../src/telegram/api";

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

