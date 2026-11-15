import { logger } from "../core/logger";
import {
  sendTelegramMessageWithToken,
  sendTelegramVoiceWithToken,
  type TelegramInlineKeyboardMarkup,
} from "./api";

export interface TelegramVoicePrivacyFallbackOptions {
  command: string;
  token: string;
  chatId: number;
  voiceUrl: string;
  fallbackText: string;
  includeCreatorFooter?: boolean;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export function isTelegramVoiceMessagesForbidden(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /VOICE_MESSAGES_FORBIDDEN/iu.test(message);
}

export function buildTelegramVoicePrivacyFallback(fallbackText: string): string {
  const instructions =
    "Your Telegram privacy settings currently prevent this bot from sending voice messages. " +
    "To receive them, open Telegram Settings → Privacy and Security → Voice Messages. " +
    "Under “Who can send me voice & video messages”, choose “Everybody” or add this bot " +
    "under “Always Allow”. Then try the command again.";

  return `${fallbackText.trim()}\n\n${instructions}`;
}

/**
 * Attempt the normal voice delivery first. Only Telegram's explicit privacy
 * rejection is converted into a text explanation; other delivery errors are
 * rethrown so the normal webhook error logger still records them.
 */
export async function sendTelegramVoiceWithPrivacyFallback(
  options: TelegramVoicePrivacyFallbackOptions,
): Promise<void> {
  const includeCreatorFooter = options.includeCreatorFooter ?? true;

  try {
    await sendTelegramVoiceWithToken(
      options.token,
      options.chatId,
      options.voiceUrl,
      includeCreatorFooter,
      options.replyMarkup,
    );
    return;
  } catch (error) {
    if (!isTelegramVoiceMessagesForbidden(error)) throw error;

    logger.warn("telegram_voice_blocked_by_user_privacy", {
      command: options.command,
      error: error instanceof Error ? error.message : String(error),
    });

    await sendTelegramMessageWithToken(
      options.token,
      options.chatId,
      buildTelegramVoicePrivacyFallback(options.fallbackText),
      undefined,
      includeCreatorFooter,
      options.replyMarkup,
    );

    logger.info("telegram_voice_privacy_fallback_delivered", {
      command: options.command,
    });
  }
}
