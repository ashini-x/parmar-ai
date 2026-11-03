export type FatmanModeAction = "enter" | "exit" | "toggle";

export function parseFatmanModeAction(value: unknown): FatmanModeAction | null {
  if (value === "fatman:enter") return "enter";
  if (value === "fatman:exit") return "exit";
  // Backward compatibility for inline keyboards sent before the explicit controls.
  if (value === "fatman:toggle") return "toggle";
  return null;
}

export function resolveFatmanModeTarget(action: FatmanModeAction, currentlyActive: boolean): boolean {
  if (action === "enter") return true;
  if (action === "exit") return false;
  return !currentlyActive;
}

export function parseFatmanModeCommand(text: string): "on" | "off" | "status" | null {
  const match = text.trim().match(/^\/fatman(?:@\w+)?(?:\s+(on|off|status))?$/i);
  if (!match) return null;
  return (match[1]?.toLowerCase() as "on" | "off" | "status" | undefined) ?? "status";
}
