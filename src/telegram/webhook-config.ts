export const TELEGRAM_WEBHOOK_ALLOWED_UPDATES = [
  "message",
  "poll_answer",
  "business_connection",
  "business_message",
  "callback_query",
] as const;

export function buildTelegramWebhookSetupPayload(
  webhookUrl: string,
  webhookSecret: string,
  botToken: string,
): Record<string, unknown> {
  return {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: [...TELEGRAM_WEBHOOK_ALLOWED_UPDATES],
    drop_pending_updates: false,
    max_connections: 100,
    botTokenOverride: botToken,
  };
}
