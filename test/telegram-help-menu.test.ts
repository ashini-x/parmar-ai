import { describe, expect, it } from "vitest";
import { parseExamSelectionAction, parseHelpMenuAction, SSC_EXAM_OPTIONS } from "../src/telegram/help-menu";

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

describe("Telegram SSC exam selection callbacks", () => {
  it("recognizes the six SSC exam options and the change-exam action", () => {
    expect(SSC_EXAM_OPTIONS.map((exam) => exam.label)).toEqual([
      "CGL", "CHSL", "CPO", "MTS", "GD", "STENO",
    ]);
    expect(SSC_EXAM_OPTIONS.map((exam) => exam.profileValue)).toEqual([
      "SSC CGL", "SSC CHSL", "SSC CPO", "SSC MTS", "SSC GD", "SSC Stenographer",
    ]);
    for (const exam of SSC_EXAM_OPTIONS) {
      expect(parseExamSelectionAction(`exam:${exam.code}`)).toBe(exam.code);
    }
    expect(parseExamSelectionAction("exam:menu")).toBe("menu");
  });

  it("rejects unknown, non-SSC and malformed callbacks", () => {
    expect(parseExamSelectionAction("exam:upsc")).toBeNull();
    expect(parseExamSelectionAction("exam:stenographer")).toBeNull();
    expect(parseExamSelectionAction("help:exam")).toBeNull();
    expect(parseExamSelectionAction(undefined)).toBeNull();
  });
});
