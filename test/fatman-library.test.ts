import { describe, expect, it } from "vitest";
import {
  fatmanExpectedPageCount,
  fatmanIndexPageKey,
  fatmanIndexPagePrefix,
  parseFatmanIndexPageKey,
} from "../src/fatman/library";
import { fatmanLibraryAdminPage } from "../src/fatman/library-admin";
import { fatmanVisionOutputPrefix } from "../src/fatman/import";

describe("Fatman multi-book library", () => {
  const bookId = "11111111-2222-4333-8444-555555555555";

  it("creates an isolated search key for every page in an additional book", () => {
    const job = { id: bookId, book_id: bookId, page_count: 125 };
    expect(fatmanIndexPagePrefix(job)).toBe("brvin/books/" + bookId + "/pages/");
    expect(fatmanIndexPageKey(job, 1)).toBe("brvin/books/" + bookId + "/pages/page-000001.txt");
    expect(fatmanIndexPageKey(job, 125)).toBe("brvin/books/" + bookId + "/pages/page-000125.txt");
    expect(fatmanExpectedPageCount(job)).toBe(125);
  });

  it("separates new source PDFs from temporary Vision OCR outputs", () => {
    const newJob = { id: bookId, source_object: "brvin/source-pdfs/" + bookId + "/source.pdf" };
    expect(newJob.source_object).toBe("brvin/source-pdfs/" + bookId + "/source.pdf");
    expect(fatmanVisionOutputPrefix(newJob)).toBe("brvin/temporary-vision-ocr/" + bookId + "/");
  });

  it("continues to find Vision OCR output for books uploaded before the prefix split", () => {
    const legacyJob = { id: bookId, source_object: "brvin/imports/" + bookId + "/source.pdf" };
    expect(fatmanVisionOutputPrefix(legacyJob)).toBe("brvin/imports/" + bookId + "/ocr/");
  });
  it("keeps the original 538-page import in its original namespace", () => {
    const legacyJob = { id: bookId, book_id: null, page_count: null };
    expect(fatmanIndexPagePrefix(legacyJob)).toBe("fatman/pages/");
    expect(fatmanIndexPageKey(legacyJob, 538)).toBe("fatman/pages/page-000538.txt");
    expect(fatmanExpectedPageCount(legacyJob)).toBe(538);
  });

  it("recognises BRVIN page keys and keeps pre-rename keys readable", () => {
    expect(parseFatmanIndexPageKey("fatman/pages/page-000123.jpg")).toEqual({ page: 123 });
    expect(parseFatmanIndexPageKey("brvin/books/" + bookId + "/pages/page-000007.txt"))
      .toEqual({ page: 7, bookId });
    expect(parseFatmanIndexPageKey("vrain/books/" + bookId + "/pages/page-000009.txt"))
      .toEqual({ page: 9, bookId });
    expect(parseFatmanIndexPageKey("fatman/books/" + bookId + "/pages/page-000008.txt"))
      .toEqual({ page: 8, bookId });
    expect(() => fatmanIndexPageKey({ id: bookId, book_id: bookId, page_count: 10 }, 0)).toThrow();
    expect(parseFatmanIndexPageKey("other/pages/page-000007.txt")).toBeUndefined();
  });

  it("offers a plain PDF upload workflow and automated processing status to admins", async () => {
    const response = fatmanLibraryAdminPage();
    const html = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Add a book");
    expect(html).toContain("Choose a PDF from this device");
    expect(html).toContain("Google Cloud OCR");
    expect(html).toContain("Search index");
    expect(html).toContain("Resume processing");
    expect(html).toContain("Books already added");
  });
});
