export const LEGACY_FATMAN_PAGE_COUNT = 538;

export interface FatmanPageIndexJob {
  id: string;
  book_id?: string | null;
  page_count?: number | null;
}

/** BRVIN owns all newly ingested book page keys; historical keyspaces remain readable. */
export function fatmanIndexPagePrefix(job: FatmanPageIndexJob): string {
  return job.book_id
    ? "brvin/books/" + job.book_id + "/pages/"
    : "fatman/pages/";
}

export function fatmanIndexPageKey(job: FatmanPageIndexJob, page: number): string {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("PDF page numbers start at one.");
  return fatmanIndexPagePrefix(job) + "page-" + String(page).padStart(6, "0") + ".txt";
}

export function fatmanExpectedPageCount(job: FatmanPageIndexJob): number {
  if (!job.book_id) return LEGACY_FATMAN_PAGE_COUNT;
  // A persisted zero is the explicit "not detected yet" marker for new
  // collection-scoped uploads. NULL/invalid historical values keep the
  // legacy fallback so pre-existing imports remain readable.
  if (job.page_count === 0) return 0;
  const count = Number(job.page_count);
  return Number.isSafeInteger(count) && count > 0 ? count : LEGACY_FATMAN_PAGE_COUNT;
}

/**
 * Google Vision is configured with batchSize=1, so its output inventory has
 * one JSON object for each source PDF page: output-1-to-1.json, etc.
 * Only return a count when the complete, contiguous inventory is present.
 */
export function inferFatmanPdfPageCountFromVisionOutputs(
  objects: readonly { name: string }[],
  prefix: string,
  truncated = false,
): number {
  if (truncated) throw new Error("The Google Vision page-output inventory is truncated; the exact PDF page count cannot be verified.");
  if (!prefix || !prefix.endsWith("/")) throw new Error("The Google Vision output prefix is invalid.");
  if (!Array.isArray(objects) || objects.length < 1 || objects.length > 2_000) {
    throw new Error("Google Vision returned an unsupported number of PDF page-output files (expected 1–2,000).");
  }

  const pages: number[] = [];
  const seen = new Set<number>();
  for (const object of objects) {
    if (!object || typeof object.name !== "string" || !object.name.startsWith(prefix)) {
      throw new Error("A Google Vision output object was outside this PDF's isolated output prefix.");
    }
    const filename = object.name.slice(prefix.length);
    const match = /^output-(\d+)-to-(\d+)\.json$/iu.exec(filename);
    if (!match) throw new Error("Google Vision returned an unexpected page-output filename: " + filename.slice(0, 100));
    const first = Number(match[1]);
    const last = Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || first !== last || last > 2_000) {
      throw new Error("Google Vision returned an invalid PDF page range: " + filename.slice(0, 100));
    }
    if (seen.has(first)) throw new Error("Google Vision returned duplicate OCR output for PDF page " + first + ".");
    seen.add(first);
    pages.push(first);
  }

  pages.sort((a, b) => a - b);
  for (let index = 0; index < pages.length; index += 1) {
    if (pages[index] !== index + 1) {
      throw new Error("Google Vision page outputs are incomplete: expected page " + (index + 1) + " but found " + pages[index] + ".");
    }
  }
  return pages.length;
}

export function parseFatmanIndexPageKey(key: string): { page: number; bookId?: string } | undefined {
  const legacy = /^fatman\/pages\/page-(\d{1,6})\.(?:jpg|jpeg|pdf|txt)$/iu.exec(key);
  if (legacy) {
    const page = Number(legacy[1]);
    return Number.isSafeInteger(page) && page > 0 ? { page } : undefined;
  }
  const book = /^(?:brvin|vrain|fatman)\/books\/([a-f0-9-]{36})\/pages\/page-(\d{1,6})\.txt$/iu.exec(key);
  if (!book) return undefined;
  const page = Number(book[2]);
  return Number.isSafeInteger(page) && page > 0 ? { page, bookId: book[1] } : undefined;
}
