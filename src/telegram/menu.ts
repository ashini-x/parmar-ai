export interface TelegramMenuCommand {
  command: string;
  description: string;
}

export function buildTelegramMenuCommands(): TelegramMenuCommand[] {
  return [
    { command: "parmar", description: "Parmar Sir" },
    { command: "help", description: "Help and commands" },
  ];
}

export function isParmarSirCommand(text: string): boolean {
  return /^\\/parmar(?:@\\w+)?(?:\\s|$)/i.test(text.trim());
}
