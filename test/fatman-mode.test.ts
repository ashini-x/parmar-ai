import { describe, expect, it } from "vitest";
import { buildFatmanHelpFooter, parseFatmanModeAction, parseFatmanModeCommand, resolveFatmanModeTarget } from "../src/telegram/fatman-mode";

describe("Fatman mode controls", () => {
  it("shows only the requested button instruction in student-facing help", () => {
    expect(buildFatmanHelpFooter(true, true)).toBe(
      "Use the buttons below to enter and exit the Fatman book to find facts.",
    );
    expect(buildFatmanHelpFooter(false, false)).not.toContain("/fatman");
    expect(buildFatmanHelpFooter(true, false)).not.toContain("/fatman on");
  });

  it("uses explicit enter and exit callback actions", () => {
    expect(parseFatmanModeAction("fatman:enter")).toBe("enter");
    expect(parseFatmanModeAction("fatman:exit")).toBe("exit");
    expect(parseFatmanModeAction("fatman:unknown")).toBeNull();
  });

  it("keeps old toggle callbacks working", () => {
    expect(parseFatmanModeAction("fatman:toggle")).toBe("toggle");
    expect(resolveFatmanModeTarget("toggle", false)).toBe(true);
    expect(resolveFatmanModeTarget("toggle", true)).toBe(false);
  });

  it("makes explicit enter and exit actions idempotent", () => {
    expect(resolveFatmanModeTarget("enter", false)).toBe(true);
    expect(resolveFatmanModeTarget("enter", true)).toBe(true);
    expect(resolveFatmanModeTarget("exit", true)).toBe(false);
    expect(resolveFatmanModeTarget("exit", false)).toBe(false);
  });

  it("parses chat commands including a bot username suffix", () => {
    expect(parseFatmanModeCommand("/fatman")).toBe("status");
    expect(parseFatmanModeCommand("/fatman on")).toBe("on");
    expect(parseFatmanModeCommand("/fatman off")).toBe("off");
    expect(parseFatmanModeCommand("/fatman@ParmarBot off")).toBe("off");
    expect(parseFatmanModeCommand("/fatman maybe")).toBeNull();
  });
});
