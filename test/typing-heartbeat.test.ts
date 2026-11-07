import { describe, expect, it } from "vitest";
import { selectTypingHeartbeatJob } from "../src/core/typing-heartbeat";

describe("Durable Object typing heartbeat selection", () => {
  it("keeps the oldest pending or queued question visible before a consumer claim", () => {
    const now = 100_000;
    const selected = selectTypingHeartbeatJob([
      { id: "newer-queued", state: "queued" as const, createdAt: now - 1_000 },
      { id: "older-pending", state: "pending" as const, createdAt: now - 3_000 },
      { id: "completed", state: "done" as const, createdAt: now - 4_000 },
    ], now, 10_000);

    expect(selected?.id).toBe("older-pending");
  });

  it("continues heartbeating the in-flight processing job ahead of later queued jobs", () => {
    const now = 100_000;
    const selected = selectTypingHeartbeatJob([
      { id: "next-queued", state: "queued" as const, createdAt: now - 1_000 },
      { id: "active-processing", state: "processing" as const, createdAt: now - 2_000 },
    ], now, 10_000);

    expect(selected?.id).toBe("active-processing");
  });

  it("ignores completed and expired jobs", () => {
    const now = 100_000;
    const selected = selectTypingHeartbeatJob([
      { id: "completed", state: "done" as const, createdAt: now - 1_000 },
      { id: "expired", state: "queued" as const, createdAt: now - 20_000 },
    ], now, 10_000);

    expect(selected).toBeUndefined();
  });
});
