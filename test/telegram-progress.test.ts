import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTelegramProgressUpdater,
  TELEGRAM_PROGRESS_CYCLES,
  TELEGRAM_PROGRESS_LABELS,
} from "../src/telegram/progress";

describe("Telegram live progress updater", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps every progress label and loop variant short and on one line", () => {
    const allLabels = [
      ...Object.values(TELEGRAM_PROGRESS_LABELS),
      ...Object.values(TELEGRAM_PROGRESS_CYCLES).flat(),
    ];
    for (const label of allLabels) {
      expect(label).not.toContain("\n");
      expect(label).not.toContain("\r");
      expect(Array.from(label).length).toBeLessThanOrEqual(22);
    }
  });

  it("cycles status variants while a phase remains active", async () => {
    vi.useFakeTimers();
    const edits: string[] = [];
    const update = createTelegramProgressUpdater((text) => {
      edits.push(text);
      return Promise.resolve();
    });

    await update.setStatus(TELEGRAM_PROGRESS_LABELS.understanding);
    expect(edits).toEqual([TELEGRAM_PROGRESS_LABELS.understanding]);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(edits.at(-1)).toBe("Reviewing question…");

    await vi.advanceTimersByTimeAsync(2_500);
    expect(edits.at(-1)).toBe("Identifying topic…");

    await vi.advanceTimersByTimeAsync(2_500);
    expect(edits.at(-1)).toBe(TELEGRAM_PROGRESS_LABELS.understanding);

    await update.stop();
    const editCount = edits.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(edits).toHaveLength(editCount);
  });

  it("applies phase changes faster than streamed answer chunks", async () => {
    vi.useFakeTimers();
    const edits: string[] = [];
    const update = createTelegramProgressUpdater((text) => {
      edits.push(text);
      return Promise.resolve();
    });

    await update.setStatus(TELEGRAM_PROGRESS_LABELS.searchingFatman);
    const phaseChange = update.setStatus(TELEGRAM_PROGRESS_LABELS.checkingBookPages);
    await vi.advanceTimersByTimeAsync(499);
    expect(edits).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await phaseChange;
    expect(edits.at(-1)).toBe(TELEGRAM_PROGRESS_LABELS.checkingBookPages);

    update("The Battle of Plassey was fought in 1757.");
    await vi.advanceTimersByTimeAsync(849);
    expect(edits.at(-1)).toBe(TELEGRAM_PROGRESS_LABELS.checkingBookPages);
    await vi.advanceTimersByTimeAsync(1);
    await update.flush();
    expect(edits.at(-1)).toBe("The Battle of Plassey was fought in 1757.");

    await update.stop();
  });

  it("does not wait for Telegram to finish a cosmetic phase edit", async () => {
    vi.useFakeTimers();
    let resolveFirstEdit: (() => void) | undefined;
    const edits: string[] = [];
    const update = createTelegramProgressUpdater((text) => {
      edits.push(text);
      if (edits.length === 1) {
        return new Promise<void>((resolve) => { resolveFirstEdit = resolve; });
      }
      return Promise.resolve();
    });

    await expect(update.setStatus(TELEGRAM_PROGRESS_LABELS.checkingSources)).resolves.toBeUndefined();
    expect(edits).toEqual([TELEGRAM_PROGRESS_LABELS.checkingSources]);

    // A later phase can be queued while the previous Telegram edit is still
    // in flight; the caller does not wait for either cosmetic edit.
    await expect(update.setStatus(TELEGRAM_PROGRESS_LABELS.preparingAnswer)).resolves.toBeUndefined();
    expect(edits).toHaveLength(1);

    resolveFirstEdit?.();
    await vi.advanceTimersByTimeAsync(500);
    await update.flush();
    expect(edits.at(-1)).toBe(TELEGRAM_PROGRESS_LABELS.preparingAnswer);

    await update.stop();
  });

  it("coalesces rapid answer chunks and shows a writing cycle after an idle pause", async () => {
    vi.useFakeTimers();
    const edits: string[] = [];
    const update = createTelegramProgressUpdater((text) => {
      edits.push(text);
      return Promise.resolve();
    });

    update("The answer");
    update("The correct answer is Article 79.");
    await vi.advanceTimersByTimeAsync(850);
    expect(edits).toEqual(["The correct answer is Article 79."]);

    await vi.advanceTimersByTimeAsync(2_300);
    expect(edits.at(-1)).toBe(TELEGRAM_PROGRESS_LABELS.writingAnswer);

    update("The correct answer is Article 79. It was adopted in 1949.");
    await vi.advanceTimersByTimeAsync(850);
    expect(edits.at(-1)).toBe("The correct answer is Article 79. It was adopted in 1949.");

    await update.stop();
  });

  it("recovers progress after one transient Telegram edit failure", async () => {
    vi.useFakeTimers();
    const edit = vi.fn()
      .mockRejectedValueOnce(new Error("Telegram edit timed out"))
      .mockResolvedValue(undefined);
    const update = createTelegramProgressUpdater(edit);

    await update.setStatus(TELEGRAM_PROGRESS_LABELS.checkingSources);
    expect(edit).toHaveBeenCalledTimes(1);

    // One transient failure is retried after the normal status interval.
    await vi.advanceTimersByTimeAsync(500);
    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenLastCalledWith(TELEGRAM_PROGRESS_LABELS.checkingSources);

    update("A later answer chunk");
    await vi.advanceTimersByTimeAsync(850);
    await update.flush();
    expect(edit).toHaveBeenCalledTimes(3);
    expect(edit).toHaveBeenLastCalledWith("A later answer chunk");

    await update.stop();
  });

  it("disables only progress after three consecutive Telegram edit failures", async () => {
    vi.useFakeTimers();
    const edit = vi.fn(async () => {
      throw new Error("Telegram edit rejected");
    });
    const update = createTelegramProgressUpdater(edit);

    await update.setStatus(TELEGRAM_PROGRESS_LABELS.checkingSources);
    expect(edit).toHaveBeenCalledTimes(1);

    // First and second retries; the third consecutive failure disables
    // cosmetic edits and resolves any waiters so answer delivery can continue.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(edit).toHaveBeenCalledTimes(3);
    await expect(update.flush()).resolves.toBeUndefined();

    update("A later answer chunk");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(edit).toHaveBeenCalledTimes(3);

    await update.stop();
  });
});
