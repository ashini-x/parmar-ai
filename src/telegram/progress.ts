export type TelegramProgressUpdater = ((text: string) => void) & {
  setStatus(status: string): void;
  flush(): Promise<void>;
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Serializes edits to one existing Telegram message. Fast model chunks are
 * coalesced so we stay within Telegram's practical edit rate while never
 * losing the latest status or answer text.
 */
export function createTelegramProgressUpdater(
  editMessage: (text: string) => Promise<void>,
  minimumIntervalMs = 800,
): TelegramProgressUpdater {
  let latestText = "";
  let lastSentText = "";
  let lastSentAt: number | null = null;
  let drainPromise: Promise<void> | null = null;
  let disabled = false;

  const drain = (): Promise<void> => {
    if (drainPromise) return drainPromise;

    const run = (async (): Promise<void> => {
      while (!disabled && latestText && latestText !== lastSentText) {
        const elapsed = lastSentAt === null ? minimumIntervalMs : Date.now() - lastSentAt;
        const waitMs = Math.max(0, minimumIntervalMs - elapsed);
        if (waitMs > 0) await sleep(waitMs);

        // A newer status/chunk may have arrived while waiting. Skip stale edits.
        const text = latestText;
        if (!text || text === lastSentText) continue;

        try {
          await editMessage(text);
          lastSentText = text;
          lastSentAt = Date.now();
        } catch {
          // Editing is best-effort: do not fail answer generation because a
          // progress update was rejected or Telegram is temporarily unavailable.
          disabled = true;
          return;
        }
      }
    })();

    let tracked: Promise<void>;
    tracked = run.finally(() => {
      if (drainPromise === tracked) drainPromise = null;
      if (!disabled && latestText && latestText !== lastSentText) void drain();
    });
    drainPromise = tracked;
    return tracked;
  };

  const update = ((text: string): void => {
    const normalized = String(text).trimEnd().slice(0, 3_900);
    if (!normalized || disabled) return;
    latestText = normalized;
    void drain();
  }) as TelegramProgressUpdater;

  update.setStatus = (status: string): void => {
    const normalized = status.trim().slice(0, 3_900);
    if (!normalized || disabled) return;
    latestText = normalized;
    void drain();
  };

  update.flush = async (): Promise<void> => {
    while (!disabled && latestText && latestText !== lastSentText) {
      await drain();
    }
    if (drainPromise) await drainPromise;
  };

  return update;
}
