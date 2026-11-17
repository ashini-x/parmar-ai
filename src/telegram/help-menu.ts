export type HelpMenuAction = "exam" | "profile" | "reset" | "delete";

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
  if (value === "help:exam") return "exam";
  if (value === "help:profile") return "profile";
  if (value === "help:reset") return "reset";
  if (value === "help:delete") return "delete";
  return null;
}

export function parseExamSelectionAction(value: unknown): ExamSelectionAction | null {
  if (value === "exam:menu") return "menu";
  if (typeof value !== "string") return null;
  const option = SSC_EXAM_OPTIONS.find((exam) => value === `exam:${exam.code}`);
  return option?.code ?? null;
}
