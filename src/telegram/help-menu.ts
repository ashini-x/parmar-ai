export type HelpMenuAction = "exam" | "profile" | "reset" | "delete" | "reset_confirm" | "reset_cancel" | "delete_confirm" | "delete_cancel";

export const SSC_EXAM_OPTIONS = [
  { code: "cgl", label: "CGL", profileValue: "SSC CGL" },
  { code: "chsl", label: "CHSL", profileValue: "SSC CHSL" },
  { code: "cpo", label: "CPO", profileValue: "SSC CPO" },
  { code: "mts", label: "MTS", profileValue: "SSC MTS" },
  { code: "gd", label: "GD", profileValue: "SSC GD" },
  { code: "steno", label: "STENO", profileValue: "SSC Stenographer" },
] as const;

export type ExamSelectionAction = "menu" | (typeof SSC_EXAM_OPTIONS)[number]["code"];

export function parseHelpMenuAction(value: unknown): HelpMenuAction | null {
  const actions: Record<string, HelpMenuAction> = {
    "help:exam": "exam",
    "help:profile": "profile",
    "help:reset": "reset",
    "help:delete": "delete",
    "help:reset:confirm": "reset_confirm",
    "help:reset:cancel": "reset_cancel",
    "help:delete:confirm": "delete_confirm",
    "help:delete:cancel": "delete_cancel",
  };
  return typeof value === "string" ? actions[value] ?? null : null;
}

export function parseExamSelectionAction(value: unknown): ExamSelectionAction | null {
  if (value === "exam:menu") return "menu";
  if (typeof value !== "string") return null;
  const option = SSC_EXAM_OPTIONS.find((exam) => value === `exam:${exam.code}`);
  return option?.code ?? null;
}
