import type { Env } from "../config/env";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4_096;

const TELEGRAM_REQUEST_TIMEOUT_MS = 5_000;
const TELEGRAM_MAX_ATTEMPTS = 4;
const TELEGRAM_MAX_RETRY_AFTER_SECONDS = 5;

export interface TelegramMessageResult {
  message_id: number;
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export class TelegramError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "TelegramError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function telegramApi<T = unknown>(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new TelegramError("Telegram bot token is not configured.");

  let lastError: TelegramError | null = null;

  for (let attempt = 1; attempt <= TELEGRAM_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      TELEGRAM_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );

      const raw = await response.text();
      let data: TelegramApiResponse<T>;

      try {
        data = JSON.parse(raw) as TelegramApiResponse<T>;
      } catch {
        throw new TelegramError(
          `Telegram returned invalid JSON (HTTP ${response.status}).`,
          response.status,
          response.status >= 500,
        );
      }

      if (response.ok && data.ok) {
        return data.result as T;
      }

      const error = new TelegramError(
        data.description ??
          `Telegram API request failed (HTTP ${response.status}).`,
        response.status,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
      lastError = error;

      if (!error.retryable || attempt >= TELEGRAM_MAX_ATTEMPTS) {
        throw error;
      }

      const retryAfter = Math.min(
        data.parameters?.retry_after ?? 1,
        TELEGRAM_MAX_RETRY_AFTER_SECONDS,
      );
      await sleep(Math.max(250, retryAfter * 1_000));
    } catch (error) {
      const telegramError =
        error instanceof TelegramError
          ? error
          : error instanceof Error && error.name === "AbortError"
            ? new TelegramError(
                `Telegram API timed out after ${TELEGRAM_REQUEST_TIMEOUT_MS}ms.`,
                undefined,
                true,
              )
            : new TelegramError(
                error instanceof Error ? error.message : String(error),
                undefined,
                true,
              );

      lastError = telegramError;

      if (!telegramError.retryable || attempt >= TELEGRAM_MAX_ATTEMPTS) {
        throw telegramError;
      }

      await sleep(300 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new TelegramError("Telegram API request failed.", undefined, true);
}

export async function sendTelegramChatAction(
  env: Env,
  chatId: number,
  action: "typing" = "typing",
): Promise<void> {
  await telegramApi(env, "sendChatAction", {
    chat_id: chatId,
    action,
  });
}

export async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string,
  replyToMessageId?: number,
): Promise<TelegramMessageResult> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: text.trim().slice(0, TELEGRAM_MAX_MESSAGE_LENGTH),
    link_preview_options: { is_disabled: true },
  };

  if (replyToMessageId) {
    payload.reply_parameters = {
      message_id: replyToMessageId,
      allow_sending_without_reply: true,
    };
  }

  return telegramApi<TelegramMessageResult>(env, "sendMessage", payload);
}

export async function editTelegramMessage(
  env: Env,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  try {
    await telegramApi(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text.trim().slice(0, TELEGRAM_MAX_MESSAGE_LENGTH),
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    if (
      error instanceof TelegramError &&
      error.message.toLowerCase().includes("message is not modified")
    ) {
      return;
    }

    throw error;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
