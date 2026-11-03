export const FATMAN_PAGE_RETRY_LIMIT = 12;

export function isTransientFatmanIndexError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /unable_to_connect_to_ai_search|fetch failed|network error|network timeout|timed out|timeout|http 429|http 5\d\d|service unavailable|temporarily unavailable|connection reset|econnreset|socket hang up/.test(message);
}

/** Exponential cooldown: 30s, 1m, 2m, 4m, 8m, then capped at 15m. */
export function fatmanPageRetryDelay(attempt: number): string {
  const safeAttempt = Number.isSafeInteger(attempt) ? Math.max(1, Math.min(FATMAN_PAGE_RETRY_LIMIT, attempt)) : 1;
  const seconds = Math.min(900, 30 * 2 ** (safeAttempt - 1));
  if (seconds < 60) return seconds + " seconds";
  const minutes = Math.floor(seconds / 60);
  return minutes + (minutes === 1 ? " minute" : " minutes");
}
