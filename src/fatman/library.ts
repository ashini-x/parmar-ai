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
  const count = Number(job.page_count);
  // New BRVIN sources begin with an unknown count. Vision output inventory
  // supplies the authoritative PDF page total before page indexing starts.
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/**
 * Derive the exact PDF page count from Google Vision's batchSize=1 output
 * objects. Every page must have one canonical output-N-to-N.json object, and
 * the sequence must be contiguous from page 1. Never guess 538 for new BRVIN
 * sources or infer a count from the largest observed page number.
 */
export function deriveFatmanPageCountFromVisionOutputObjects(
  objectNames: readonly string[],
  maximumPages = 2_000,
): number {
  if (!Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > 100_000) {
    throw new RangeError("The maximum PDF page count is invalid.");
  }
  const pages = new Set<number>();
  for (const objectName of objectNames) {
    const filename = objectName.slice(objectName.lastIndexOf("/") + 1);
    const match = /^output-(\\d+)-to-(\\d+)\\.json$/u.exec(filename);
    if (!match) continue;
    const first = Number(match[1]);
    const last = Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
        first < 1 || first !== last || last > maximumPages) {
      throw new Error("Vision OCR returned an invalid per-page output filename: " + filename);
    }
    if (pages.has(first)) throw new Error("Vision OCR returned duplicate output for PDF page " + first + ".");
    pages.add(first);
  }
  if (!pages.size) throw new Error("Vision OCR completed without any per-page JSON output files.");
  const pageCount = pages.size;
  for (let page = 1; page <= pageCount; page += 1) {
    if (!pages.has(page)) {
      throw new Error("Vision OCR output is not contiguous: PDF page " + page + " is missing.");
    }
  }
  if ([...pages].some(page => page > pageCount)) {
    throw new Error("Vision OCR output contains a page gap; the exact PDF page count cannot be established.");
  }
  return pageCount;
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
