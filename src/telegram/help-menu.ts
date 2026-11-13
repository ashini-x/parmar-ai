export type HelpMenuAction = "exam" | "profile" | "reset" | "delete";

export function parseHelpMenuAction(value: unknown): HelpMenuAction | null {
  if (value === "help:exam") return "exam";
  if (value === "help:profile") return "profile";
  if (value === "help:reset") return "reset";
  if (value === "help:delete") return "delete";
  return null;
}
