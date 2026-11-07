/**
 * Bounded throughput and polling policy for BRVIN/Fatman page indexing.
 *
 * AI Search accepts uploads asynchronously. Keep a small in-flight window so
 * independent pages can be submitted concurrently without flooding the shared
 * instance or creating one polling loop per page.
 */
export const FATMAN_INDEX_PAGE_CONCURRENCY = 3;

/** Split page work into stable, ordered batches for bounded Promise.all execution. */
export function chunkFatmanPages(
  pages: readonly number[],
  concurrency = FATMAN_INDEX_PAGE_CONCURRENCY,
): number[][] {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new RangeError("Fatman page-index concurrency must be between 1 and 8.");
  }
  const batches: number[][] = [];
  for (let offset = 0; offset < pages.length; offset += concurrency) {
    batches.push(pages.slice(offset, offset + concurrency));
  }
  return batches;
}

/**
 * Poll source-scoped AI Search item state more frequently for small PDFs,
 * where each status scan is a single inexpensive list request. Large PDFs
 * require multiple 50-item pages per scan, so use a slower cadence to control
 * API/Workflow overhead.
 */
export function fatmanIndexMonitorDelayMs(
  monitorSequence: number,
  expectedPages: number,
): number {
  const sequence = Number.isSafeInteger(monitorSequence) ? Math.max(1, monitorSequence) : 1;
  const pages = Number.isSafeInteger(expectedPages) ? Math.max(1, expectedPages) : 1;
  const schedule = pages <= 10
    ? [15_000, 30_000]
    : pages <= 100
      ? [30_000, 45_000]
      : [45_000, 60_000];
  return schedule[Math.min(sequence - 1, schedule.length - 1)];
}


/** Compact exact per-page status encoding for the existing source monitor event. */
export function buildFatmanPageStateMap(
  expectedPages: number,
  pages: readonly { page: number; status: string }[],
): string {
  if (!Number.isSafeInteger(expectedPages) || expectedPages < 1 || expectedPages > 2_000) {
    throw new RangeError("The expected PDF page count must be between 1 and 2,000.");
  }
  const byPage = new Map<number, string>();
  for (const item of pages) {
    if (!Number.isSafeInteger(item.page) || item.page < 1 || item.page > expectedPages) continue;
    byPage.set(item.page, item.status);
  }
  return Array.from({ length: expectedPages }, (_, index) => {
    const status = byPage.get(index + 1);
    return status === "completed" ? "c"
      : status === "running" ? "r"
        : status === "queued" ? "q"
          : status === "error" || status === "skipped" || status === "outdated" ? "e"
            : "m";
  }).join("");
}
