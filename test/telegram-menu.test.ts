import { describe, expect, it } from "vitest";
import { buildTelegramMenuCommandTargets, buildTelegramMenuCommands, isParmarSirCommand } from "../src/telegram/menu";

describe("Telegram menu commands", () => {
  it("puts Parmar Sir above the existing Help and commands entry", () => {
    expect(buildTelegramMenuCommands()).toEqual([
      { command: "parmar", description: "Parmar Sir" },
      { command: "help", description: "Help and commands" },
    ]);
  });

  it("overrides stale private-chat command scopes, including the current chat and language", () => {
    expect(buildTelegramMenuCommandTargets(123456, "en-US")).toEqual([
      { scope: { type: "default" } },
      { scope: { type: "all_private_chats" } },
      { scope: { type: "all_private_chats" }, language_code: "en" },
      { scope: { type: "chat", chat_id: 123456 } },
      { scope: { type: "chat", chat_id: 123456 }, language_code: "en" },
    ]);
  });

  it("does not create an invalid chat scope when no valid chat ID is supplied", () => {
    expect(buildTelegramMenuCommandTargets(-1)).toEqual([
      { scope: { type: "default" } },
      { scope: { type: "all_private_chats" } },
    ]);
  });

  it("recognizes the Parmar Sir command with an optional bot username", () => {
    expect(isParmarSirCommand("/parmar")).toBe(true);
    expect(isParmarSirCommand("/parmar@ParmarBot")).toBe(true);
    expect(isParmarSirCommand("/start")).toBe(false);
  });
});
