# Production launch checklist

- [ ] GitHub repository contains no credentials.
- [ ] Vertex AI API is enabled in the exact project configured in `GCP_PROJECT_ID`.
- [ ] Runtime service account has Vertex AI User permission.
- [ ] Billing/trial credit is attached to the same Google Cloud project.
- [ ] Cloudflare Workers Paid is active for the public launch.
- [ ] Queue `parmar-ai-questions-prod` exists.
- [ ] DLQ `parmar-ai-questions-dlq` is configured.
- [ ] All six Worker secrets are present.
- [ ] `/health` shows Telegram, Vertex, Queue and Job Store configured.
- [ ] Telegram webhook is registered with the secret token.
- [ ] `/start`, `/exam cgl`, `/profile`, `/reset` work.
- [ ] A real SSC GA/GS question returns an answer.
- [ ] Typing continues while processing in a private chat.
- [ ] Cloudflare Observability is enabled.
- [ ] Google Cloud budget alerts are configured.
- [ ] The first public test is monitored before advertising broadly.

## Capacity reality

The system is designed to absorb bursts instead of failing the webhook immediately. That does not mean Google or Telegram provide infinite capacity. During an extreme simultaneous spike, questions can spend longer in the Queue; the user has already received the acknowledgement, and the job is durable and retryable.
