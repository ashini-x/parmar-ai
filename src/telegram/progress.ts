/** Keep every visible progress state compact enough for Telegram mobile. */
export const TELEGRAM_PROGRESS_LABELS = {
  understanding: "Understanding…",
  resuming: "Resuming…",
  readingImage: "Reading image…",
  analyzingImage: "Analyzing image…",
  checkingFatman: "Checking Fatman…",
  searchingFatman: "Searching Fatman…",
  checkingBookPages: "Checking book pages…",
  writingAnswer: "Writing answer…",
  checkingSources: "Checking sources…",
  retrying: "Retrying…",
  preparingQuiz: "Preparing quiz…",
  preparingAnswer: "Preparing answer…",
} as const;

/**
 * Each cycle stays within the current task phase. The variants are deliberately
 * descriptive rather than percentage-based, because the model does not expose
 * reliable completion percentages.
 */
export const TELEGRAM_PROGRESS_CYCLES: Record<string, readonly string[]> = {
  [TELEGRAM_PROGRESS_LABELS.understanding]: [
    TELEGRAM_PROGRESS_LABELS.understanding,
    "Reviewing question…",
    "Identifying topic…",
  ],
  [TELEGRAM_PROGRESS_LABELS.resuming]: [
    TELEGRAM_PROGRESS_LABELS.resuming,
    "Restoring task…",
    "Continuing work…",
  ],
  [TELEGRAM_PROGRESS_LABELS.readingImage]: [
    TELEGRAM_PROGRESS_LABELS.readingImage,
    "Scanning details…",
    "Reading visible text…",
  ],
  [TELEGRAM_PROGRESS_LABELS.analyzingImage]: [
    TELEGRAM_PROGRESS_LABELS.analyzingImage,
    "Examining details…",
    "Matching context…",
  ],
  [TELEGRAM_PROGRESS_LABELS.checkingFatman]: [
    TELEGRAM_PROGRESS_LABELS.checkingFatman,
    "Loading Fatman…",
    "Preparing search…",
  ],
  [TELEGRAM_PROGRESS_LABELS.searchingFatman]: [
    TELEGRAM_PROGRESS_LABELS.searchingFatman,
    "Searching pages…",
    "Finding book pages…",
  ],
  [TELEGRAM_PROGRESS_LABELS.checkingBookPages]: [
    TELEGRAM_PROGRESS_LABELS.checkingBookPages,
    "Matching sections…",
    "Reviewing page facts…",
  ],
  [TELEGRAM_PROGRESS_LABELS.writingAnswer]: [
    TELEGRAM_PROGRESS_LABELS.writingAnswer,
    "Structuring answer…",
    "Organizing response…",
  ],
  [TELEGRAM_PROGRESS_LABELS.checkingSources]: [
    TELEGRAM_PROGRESS_LABELS.checkingSources,
    "Reviewing evidence…",
    "Verifying details…",
  ],
  [TELEGRAM_PROGRESS_LABELS.retrying]: [
    TELEGRAM_PROGRESS_LABELS.retrying,
    "Retrying request…",
    "Restoring connection…",
  ],
  [TELEGRAM_PROGRESS_LABELS.preparingQuiz]: [
    TELEGRAM_PROGRESS_LABELS.preparingQuiz,
    "Building questions…",
    "Checking answers…",
  ],
  [TELEGRAM_PROGRESS_LABELS.preparingAnswer]: [
    TELEGRAM_PROGRESS_LABELS.preparingAnswer,
    "Preparing response…",
    "Forming explanation…",
  ],
};

export interface TelegramProgressOptions {
  /** Faster edits for genuine phase changes. */
  statusIntervalMs?: number;
  /** Keep streamed answer chunks on the more conservative edit cadence. */
  answerIntervalMs?: number;
  /** Rotate a long-running phase so the bubble never looks abandoned. */
  rotationIntervalMs?: number;
  /** Show a writing cycle again if the model pauses between answer chunks. */
  answerIdleMs?: number;
}

export type TelegramProgressUpdater = ((text: string) => void) & {
  setStatus(status: string): Promise<void>;
  flush(): Promise<void>;
  stop(): Promise<void>;
};

type EditKind = "status" | "answer";

interface RevisionWaiter {
  revision: number;
  resolve: () => void;
}

function resolveWaiters(waiters: RevisionWaiter[], sentRevision: number): RevisionWaiter[] {
  const pending: RevisionWaiter[] = [];
  for (const waiter of waiters) {
    if (waiter.revision <= sentRevision) waiter.resolve();
    else pending.push(waiter);
  }
  return pending;
}

function sleepTimer(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout> {
  return setTimeout(callback, Math.max(0, milliseconds));
}

/**
 * Serializes edits to one existing Telegram message.
 *
 * Phase changes are sent more quickly than answer chunks. During a long phase,
 * short phase-accurate variants rotate in place. If streamed answer text pauses,
 * a writing cycle temporarily replaces the partial text until another chunk
 * arrives. A failed Telegram edit disables only progress updates, never AI work.
 */
export function createTelegramProgressUpdater(
  editMessage: (text: string) => Promise<void>,
  options: TelegramProgressOptions = {},
): TelegramProgressUpdater {
  const statusIntervalMs = Math.max(250, options.statusIntervalMs ?? 500);
  const answerIntervalMs = Math.max(statusIntervalMs, options.answerIntervalMs ?? 850);
  const rotationIntervalMs = Math.max(1_000, options.rotationIntervalMs ?? 2_500);
  const answerIdleMs = Math.max(1_000, options.answerIdleMs ?? 2_300);

  let latestText = "";
  let lastSentText = "";
  let lastSentAt: number | null = null;
  let latestKind: EditKind = "status";
  let latestRevision = 0;
  let sentRevision = 0;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let cycleTimer: ReturnType<typeof setInterval> | null = null;
  let answerIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let disabled = false;
  let stopped = false;
  let cycleIndex = 0;
  let currentCycle: readonly string[] = [];
  let waiters: RevisionWaiter[] = [];

  const clearCycleTimer = (): void => {
    if (cycleTimer !== null) clearInterval(cycleTimer);
    cycleTimer = null;
  };

  const clearAnswerIdleTimer = (): void => {
    if (answerIdleTimer !== null) clearTimeout(answerIdleTimer);
    answerIdleTimer = null;
  };

  const resolveAllWaiters = (): void => {
    for (const waiter of waiters) waiter.resolve();
    waiters = [];
  };

  const waitForRevision = (revision: number): Promise<void> => {
    if (disabled || sentRevision >= revision) return Promise.resolve();
    return new Promise((resolve) => {
      waiters.push({ revision, resolve });
    });
  };

  const scheduleDrain = (): void => {
    if (
      disabled ||
      stopped ||
      drainTimer !== null ||
      inFlight !== null ||
      !latestText ||
      latestRevision <= sentRevision
    ) return;

    const interval = latestKind === "status" ? statusIntervalMs : answerIntervalMs;
    const elapsed = lastSentAt === null ? interval : Date.now() - lastSentAt;
    drainTimer = sleepTimer(() => {
      drainTimer = null;
      void sendLatest();
    }, Math.max(0, interval - elapsed));
  };

  const sendLatest = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (disabled || stopped || !latestText || latestRevision <= sentRevision) return Promise.resolve();

    const text = latestText;
    const revision = latestRevision;
    const task = (async (): Promise<void> => {
      try {
        await editMessage(text);
        lastSentText = text;
        lastSentAt = Date.now();
        sentRevision = Math.max(sentRevision, revision);
        waiters = resolveWaiters(waiters, sentRevision);
      } catch {
        disabled = true;
        clearCycleTimer();
        clearAnswerIdleTimer();
        if (drainTimer !== null) clearTimeout(drainTimer);
        drainTimer = null;
        resolveAllWaiters();
      } finally {
        inFlight = null;
        if (!disabled && !stopped && latestRevision > sentRevision) scheduleDrain();
      }
    })();
    inFlight = task;
    return task;
  };

  const enqueue = (text: string, kind: EditKind): number => {
    if (disabled || stopped) return sentRevision;
    latestText = text.trimEnd().slice(0, 3_900);
    if (!latestText || latestText.length < 4) return sentRevision;
    latestKind = kind;
    latestRevision += 1;
    scheduleDrain();
    return latestRevision;
  };

  const startStatusCycle = (status: string): number => {
    clearCycleTimer();
    clearAnswerIdleTimer();
    currentCycle = TELEGRAM_PROGRESS_CYCLES[status] ?? [status];
    cycleIndex = 0;
    const revision = enqueue(currentCycle[cycleIndex], "status");

    if (currentCycle.length > 1 && !disabled && !stopped) {
      cycleTimer = setInterval(() => {
        if (disabled || stopped) return;
        cycleIndex = (cycleIndex + 1) % currentCycle.length;
        enqueue(currentCycle[cycleIndex], "status");
      }, rotationIntervalMs);
    }
    return revision;
  };

  const update = ((text: string): void => {
    const normalized = String(text).trimEnd().slice(0, 3_900);
    if (!normalized || normalized.length < 4 || disabled || stopped) return;

    clearCycleTimer();
    clearAnswerIdleTimer();
    const revision = enqueue(normalized, "answer");

    // If generation pauses after emitting partial text, replace it with an
    // honest writing state; the next cumulative chunk restores the answer.
    answerIdleTimer = sleepTimer(() => {
      answerIdleTimer = null;
      startStatusCycle(TELEGRAM_PROGRESS_LABELS.writingAnswer);
    }, answerIdleMs);

    void waitForRevision(revision);
  }) as TelegramProgressUpdater;

  update.setStatus = async (status: string): Promise<void> => {
    const normalized = String(status).trim().slice(0, 3_900);
    if (!normalized || normalized.length < 4 || disabled || stopped) return;
    const revision = startStatusCycle(normalized);
    await waitForRevision(revision);
  };

  update.flush = async (): Promise<void> => {
    if (disabled || stopped) return;
    const revision = latestRevision;
    if (revision > sentRevision) await waitForRevision(revision);
    if (inFlight) await inFlight;
  };

  update.stop = async (): Promise<void> => {
    if (stopped) {
      if (inFlight) await inFlight;
      return;
    }
    stopped = true;
    clearCycleTimer();
    clearAnswerIdleTimer();
    if (drainTimer !== null) clearTimeout(drainTimer);
    drainTimer = null;
    if (inFlight) await inFlight;

    // Drop a not-yet-sent heartbeat so it cannot race with the final answer.
    latestText = lastSentText;
    latestRevision = sentRevision;
    resolveAllWaiters();
  };

  return update;
}
