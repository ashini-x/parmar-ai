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

/** Student-facing copy for the /help keyboard; slash-command fallbacks stay out of the UI. */
export function buildFatmanHelpFooter(ready: boolean, callbackWebhookReady: boolean): string {
  if (!ready) return "Fatman Mode is temporarily unavailable. Usual SSC study mode is active.";
  if (!callbackWebhookReady) return "Fatman buttons are temporarily unavailable. Please try /help again.";
  return "Use the buttons below to enter and exit the Fatman book to find facts.";
}

/** Shared status copy for Fatman mode transitions and status replies. */
export function buildFatmanModeStatusMessage(active: boolean, includeIcon = false): string {
  const heading = active
    ? `${includeIcon ? "📖 " : ""}Fatman Mode is ON.`
    : `${includeIcon ? "👻 " : ""}Fatman Mode is OFF.`;
  const explanation = active
    ? "New doubts will use the book and page citations."
    : "New doubts will use the exam-relevant SSC study mode.";
  return heading + "\n\n" + explanation;
}
