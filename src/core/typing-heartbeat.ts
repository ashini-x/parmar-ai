export type TypingHeartbeatState = "pending" | "queued" | "processing" | "done";

export interface TypingHeartbeatJob {
  state: TypingHeartbeatState;
  createdAt: number;
}

/**
 * Select the oldest non-terminal job whose typing feedback is still fresh.
 *
 * Jobs in one student's Durable Object are processed in creation order, so
 * keeping the oldest active job as the heartbeat target avoids making a later
 * queued question appear to jump ahead of an earlier question.
 */
export function selectTypingHeartbeatJob<T extends TypingHeartbeatJob>(
  jobs: Iterable<T>,
  now: number,
  maxAgeMs: number,
): T | undefined {
  const cutoff = now - maxAgeMs;
  let selected: T | undefined;

  for (const job of jobs) {
    if (job.state === "done" || !Number.isFinite(job.createdAt) || job.createdAt < cutoff) {
      continue;
    }
    if (!selected || job.createdAt < selected.createdAt) {
      selected = job;
    }
  }

  return selected;
}
