import { describe, expect, it } from "vitest";
import { buildTelegramMenuCommandTargets, buildTelegramMenuCommands, isAdminCommand, isHelpCommand, isParmarSirCommand, isStartCommand } from "../src/telegram/menu";

describe("Telegram menu commands", () => {
  it("publishes all four named voice and admin menu entries", () => {
    expect(buildTelegramMenuCommands()).toEqual([
      { command: "rbe", description: "Shubham Jain" },
      { command: "radhika", description: "Radhika Goel" },
      { command: "parmar", description: "Parmar SSC" },
      { command: "admin", description: "Admin" },
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

  it("recognizes all voice shortcuts, legacy aliases, case variants and optional bot usernames", () => {
    expect(isStartCommand("/start")).toBe(true);
    expect(isStartCommand("/RBE")).toBe(true);
    expect(isStartCommand("/rbe@ParmarBot")).toBe(true);
    expect(isHelpCommand("/help")).toBe(true);
    expect(isHelpCommand("/RADHIKA")).toBe(true);
    expect(isHelpCommand("/radhika@ParmarBot")).toBe(true);
    expect(isParmarSirCommand("/parmar")).toBe(true);
    expect(isParmarSirCommand("/parmar@ParmarBot")).toBe(true);
    expect(isAdminCommand("/Admin")).toBe(true);
    expect(isAdminCommand("/admin@ParmarBot")).toBe(true);
    expect(isStartCommand("/radhika")).toBe(false);
    expect(isHelpCommand("/admin")).toBe(false);
    expect(isAdminCommand("/start")).toBe(false);
  });
});
