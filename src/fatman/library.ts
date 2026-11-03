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
  return Number.isSafeInteger(count) && count > 0 ? count : LEGACY_FATMAN_PAGE_COUNT;
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
