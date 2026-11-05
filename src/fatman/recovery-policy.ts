export const FATMAN_PAGE_RETRY_LIMIT = 12;

/** Bucket IAM/policy failures require human repair; never spin an unattended retry loop. */
export function shouldPauseAutomaticVisionCleanupRetry(priorFailureCount: number): boolean {
  return Number.isFinite(priorFailureCount) && priorFailureCount > 0;
}


export function isTransientFatmanIndexError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /unable_to_connect_to_ai_search|fetch failed|network error|network timeout|timed out|timeout|http 429|http 5\d\d|service unavailable|temporarily unavailable|connection reset|econnreset|socket hang up/.test(message);
}

/** Exponential cooldown: 30s, 1m, 2m, 4m, 8m, then capped at 15m. */
const RETRY_DELAYS = ["30 seconds", "1 minute", "2 minutes", "4 minutes", "8 minutes", "15 minutes"] as const;
export type FatmanPageRetryDelay = (typeof RETRY_DELAYS)[number];

export function fatmanPageRetryDelay(attempt: number): FatmanPageRetryDelay {
  const safeAttempt = Number.isSafeInteger(attempt) ? Math.max(1, Math.min(FATMAN_PAGE_RETRY_LIMIT, attempt)) : 1;
  const index = Math.min(RETRY_DELAYS.length - 1, safeAttempt - 1);
  return RETRY_DELAYS[index] as FatmanPageRetryDelay;
}
