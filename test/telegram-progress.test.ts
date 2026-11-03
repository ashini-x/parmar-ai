import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramProgressUpdater, TELEGRAM_PROGRESS_LABELS } from "../src/telegram/progress";

describe("Telegram live progress updater", () => {
  it("keeps every progress label short and on one line for mobile", () => {
    for (const [name, label] of Object.entries(TELEGRAM_PROGRESS_LABELS)) {
      expect(label, name).not.toContain("\\n");
      expect(label, name).not.toContain("\\r");
      expect(Array.from(label).length, name).toBeLessThanOrEqual(22);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions the same message from a status into streamed answer text", async () => {
    vi.useFakeTimers();
    const edits: string[] = [];
    const update = createTelegramProgressUpdater(async (text) => {
      edits.push(text);
    }, 800);

    await update.setStatus(TELEGRAM_PROGRESS_LABELS.searchingFatman);
    expect(edits).toEqual([TELEGRAM_PROGRESS_LABELS.searchingFatman]);

    const reviewState = update.setStatus(TELEGRAM_PROGRESS_LABELS.checkingBookPages);
    await vi.advanceTimersByTimeAsync(800);
    await reviewState;
    expect(edits.at(-1)).toBe(TELEGRAM_PROGRESS_LABELS.checkingBookPages);

    update("The Battle of Plassey was fought in 1757.");
    await vi.advanceTimersByTimeAsync(800);
    await update.flush();

    // The same editor receives each progress state and then the streamed text.
    expect(edits.at(-1)).toBe("The Battle of Plassey was fought in 1757.");
    expect(edits).toEqual([
      TELEGRAM_PROGRESS_LABELS.searchingFatman,
      TELEGRAM_PROGRESS_LABELS.checkingBookPages,
      "The Battle of Plassey was fought in 1757.",
    ]);
    expect(edits).not.toContain("Thinking…");
  });

  it("serializes rapid answer chunks and sends the latest complete snapshot", async () => {
    vi.useFakeTimers();
    const edits: string[] = [];
    const update = createTelegramProgressUpdater(async (text) => {
      edits.push(text);
    }, 800);

    update("The");
    update("The correct answer is Article 79.");
    await vi.advanceTimersByTimeAsync(800);
    await update.flush();

    expect(edits).toEqual(["The correct answer is Article 79."]);
  });

  it("keeps answer generation independent when a Telegram edit fails", async () => {
    vi.useFakeTimers();
    const edit = vi.fn(async () => {
      throw new Error("Telegram edit rejected");
    });
    const update = createTelegramProgressUpdater(edit, 800);

    update.setStatus(TELEGRAM_PROGRESS_LABELS.checkingSources);
    await expect(update.flush()).resolves.toBeUndefined();
    update("A later answer chunk");
    await update.flush();

    expect(edit).toHaveBeenCalledTimes(1);
  });
});
