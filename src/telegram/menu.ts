export interface TelegramMenuCommand {
  command: string;
  description: string;
}

export interface TelegramMenuCommandTarget {
  scope:
    | { type: "default" }
    | { type: "all_private_chats" }
    | { type: "chat"; chat_id: number };
  language_code?: string;
}

export function buildTelegramMenuCommands(): TelegramMenuCommand[] {
  return [
    { command: "parmar", description: "Parmar Sir" },
    { command: "help", description: "Help and commands" },
  ];
}

/**
 * Telegram resolves more-specific command scopes before the default scope.
 * Update all private chats and the current chat so old scoped command lists
 * cannot hide the new Parmar Sir command.
 */
export function buildTelegramMenuCommandTargets(
  chatId?: number,
  languageCode?: string,
): TelegramMenuCommandTarget[] {
  const targets: TelegramMenuCommandTarget[] = [
    { scope: { type: "default" } },
    { scope: { type: "all_private_chats" } },
  ];
  const language = languageCode?.trim().split("-")[0]?.toLowerCase();
  const normalizedLanguage = language && /^[a-z]{2}$/u.test(language) ? language : undefined;

  if (normalizedLanguage) {
    targets.push({
      scope: { type: "all_private_chats" },
      language_code: normalizedLanguage,
    });
  }

  if (Number.isSafeInteger(chatId) && Number(chatId) > 0) {
    targets.push({ scope: { type: "chat", chat_id: Number(chatId) } });
    if (normalizedLanguage) {
      targets.push({
        scope: { type: "chat", chat_id: Number(chatId) },
        language_code: normalizedLanguage,
      });
    }
  }

  return targets;
}

export function isParmarSirCommand(text: string): boolean {
  return /^\/parmar(?:@\w+)?(?:\s|$)/i.test(text.trim());
}
