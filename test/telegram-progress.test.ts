import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramProgressUpdater } from "../src/telegram/progress";

describe("Telegram live progress updater", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions the same message from a status into streamed answer text", async () => {
    vi.useFakeTimers();
    const edits: string[] = [];
    const update = createTelegramProgressUpdater(async (text) => {
      edits.push(text);
    }, 800);

    update.setStatus("Searching Fatman 2nd Edition…");
    await update.flush();
    expect(edits).toEqual(["Searching Fatman 2nd Edition…"]);

    update.setStatus("Reviewing the most relevant book pages…");
    update("The Battle of Plassey was fought in 1757.");
    await vi.advanceTimersByTimeAsync(800);
    await update.flush();

    // The interim state is safely coalesced when answer text arrives before
    // Telegram's next edit window; the latest useful content is never lost.
    expect(edits.at(-1)).toBe("The Battle of Plassey was fought in 1757.");
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

    update.setStatus("Checking current sources…");
    await expect(update.flush()).resolves.toBeUndefined();
    update("A later answer chunk");
    await update.flush();

    expect(edit).toHaveBeenCalledTimes(1);
  });
});
