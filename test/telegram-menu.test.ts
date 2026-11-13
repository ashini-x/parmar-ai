import { describe, expect, it } from "vitest";
import { buildTelegramMenuCommands, isParmarSirCommand } from "../src/telegram/menu";

describe("Telegram menu commands", () => {
  it("puts Parmar Sir above the existing Help and commands entry", () => {
    expect(buildTelegramMenuCommands()).toEqual([
      { command: "parmar", description: "Parmar Sir" },
      { command: "help", description: "Help and commands" },
    ]);
  });

  it("recognizes the Parmar Sir command with an optional bot username", () => {
    expect(isParmarSirCommand("/parmar")).toBe(true);
    expect(isParmarSirCommand("/parmar@ParmarBot")).toBe(true);
    expect(isParmarSirCommand("/start")).toBe(false);
  });
});
