import { describe, expect, it } from "vitest";
import { buildTelegramWebhookSetupPayload, TELEGRAM_WEBHOOK_ALLOWED_UPDATES } from "../src/telegram/webhook-config";

describe("Telegram webhook callback configuration", () => {
  it("subscribes callback_query without dropping pending updates", () => {
    const payload = buildTelegramWebhookSetupPayload(
      "https://parmar-ai.example/telegram/webhook",
      "test-secret",
      "123456:test-token",
    );
    expect(payload).toMatchObject({
      url: "https://parmar-ai.example/telegram/webhook",
      secret_token: "test-secret",
      allowed_updates: ["message", "poll_answer", "business_connection", "business_message", "callback_query"],
      drop_pending_updates: false,
      max_connections: 100,
      botTokenOverride: "123456:test-token",
    });
    expect(TELEGRAM_WEBHOOK_ALLOWED_UPDATES).toContain("callback_query");
  });
});
