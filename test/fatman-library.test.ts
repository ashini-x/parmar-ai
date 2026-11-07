import { describe, expect, it } from "vitest";
import {
  fatmanExpectedPageCount,
  fatmanIndexPageKey,
  fatmanIndexPagePrefix,
  inferFatmanPdfPageCountFromVisionOutputs,
  parseFatmanIndexPageKey,
} from "../src/fatman/library";
import { fatmanLibraryAdminPage } from "../src/fatman/library-admin";
import { fatmanVisionOutputPrefix, isUnsafeFatmanVisionLifecycleDeletePrefix } from "../src/fatman/import";

describe("Fatman multi-book library", () => {
  const bookId = "11111111-2222-4333-8444-555555555555";

  it("keeps the explicit unknown page-count marker separate from the legacy 538-page default", () => {
    expect(fatmanExpectedPageCount({ id: bookId, book_id: bookId, page_count: 0 })).toBe(0);
    expect(fatmanExpectedPageCount({ id: bookId, book_id: bookId, page_count: null })).toBe(538);
  });

  it("derives the exact page count from a complete, consecutive Vision output inventory", () => {
    expect(inferFatmanPdfPageCountFromVisionOutputs([
      { name: "brvin/temporary-vision-ocr/" + bookId + "/output-1-to-1.json" },
      { name: "brvin/temporary-vision-ocr/" + bookId + "/output-2-to-2.json" },
      { name: "brvin/temporary-vision-ocr/" + bookId + "/output-3-to-3.json" },
    ], "brvin/temporary-vision-ocr/" + bookId + "/")).toBe(3);
    const large = Array.from({ length: 538 }, (_, index) => ({
      name: "brvin/temporary-vision-ocr/" + bookId + "/output-" + (index + 1) + "-to-" + (index + 1) + ".json",
    }));
    expect(inferFatmanPdfPageCountFromVisionOutputs(large, "brvin/temporary-vision-ocr/" + bookId + "/")).toBe(538);
  });

  it("refuses to infer a count from truncated, incomplete, duplicate or malformed Vision output", () => {
    const prefix = "brvin/temporary-vision-ocr/" + bookId + "/";
    expect(() => inferFatmanPdfPageCountFromVisionOutputs([{ name: prefix + "output-1-to-1.json" }], prefix, true)).toThrow(/truncated/i);
    expect(() => inferFatmanPdfPageCountFromVisionOutputs([
      { name: prefix + "output-1-to-1.json" }, { name: prefix + "output-3-to-3.json" },
    ], prefix)).toThrow(/incomplete/i);
    expect(() => inferFatmanPdfPageCountFromVisionOutputs([
      { name: prefix + "output-1-to-1.json" }, { name: prefix + "output-1-to-1.json" },
    ], prefix)).toThrow(/duplicate/i);
    expect(() => inferFatmanPdfPageCountFromVisionOutputs([{ name: prefix + "unexpected.json" }], prefix)).toThrow(/unexpected/i);
    expect(() => inferFatmanPdfPageCountFromVisionOutputs([{ name: "another-source/output-1-to-1.json" }], prefix)).toThrow(/outside/i);
    expect(() => inferFatmanPdfPageCountFromVisionOutputs(
      Array.from({ length: 2_001 }, (_, index) => ({ name: prefix + "output-" + (index + 1) + "-to-" + (index + 1) + ".json" })), prefix,
    )).toThrow(/unsupported/i);
  });

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
  it("rejects lifecycle Delete prefixes that overlap any source-PDF root", () => {
    for (const prefix of ["brvin", "brvin/", "brvin/source-pdfs", "brvin/source-pdfs/" + bookId + "/",
      "brvin/imports", "brvin/imports/" + bookId + "/", "fatman", "fatman/imports/"]) {
      expect(isUnsafeFatmanVisionLifecycleDeletePrefix(prefix)).toBe(true);
    }
  });

  it("allows only the new temporary Vision tree and legacy per-book OCR subtree", () => {
    for (const prefix of ["brvin/temporary-vision-ocr/", "brvin/temporary-vision-ocr/" + bookId + "/",
      "brvin/imports/" + bookId + "/ocr/", "brvin/imports/" + bookId + "/ocr/2026/"]) {
      expect(isUnsafeFatmanVisionLifecycleDeletePrefix(prefix)).toBe(false);
    }
    expect(isUnsafeFatmanVisionLifecycleDeletePrefix("")).toBe(true);
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
