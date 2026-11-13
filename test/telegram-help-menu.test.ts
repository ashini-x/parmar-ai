import { describe, expect, it } from "vitest";
import { parseHelpMenuAction } from "../src/telegram/help-menu";

describe("Telegram Help menu actions", () => {
  it("parses the four Help button actions", () => {
    expect(parseHelpMenuAction("help:exam")).toBe("exam");
    expect(parseHelpMenuAction("help:profile")).toBe("profile");
    expect(parseHelpMenuAction("help:reset")).toBe("reset");
    expect(parseHelpMenuAction("help:delete")).toBe("delete");
  });

  it("rejects unrelated and malformed callback data", () => {
    expect(parseHelpMenuAction("fatman:enter")).toBeNull();
    expect(parseHelpMenuAction("help:unknown")).toBeNull();
    expect(parseHelpMenuAction(undefined)).toBeNull();
  });
});
