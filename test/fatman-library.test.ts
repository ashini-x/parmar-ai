import { describe, expect, it } from "vitest";
import {
  fatmanExpectedPageCount,
  fatmanIndexPageKey,
  fatmanIndexPagePrefix,
  parseFatmanIndexPageKey,
} from "../src/fatman/library";
import { fatmanLibraryAdminPage } from "../src/fatman/library-admin";

describe("Fatman multi-book library", () => {
  const bookId = "11111111-2222-4333-8444-555555555555";

  it("creates an isolated search key for every page in an additional book", () => {
    const job = { id: bookId, book_id: bookId, page_count: 125 };
    expect(fatmanIndexPagePrefix(job)).toBe("fatman/books/" + bookId + "/pages/");
    expect(fatmanIndexPageKey(job, 1)).toBe("fatman/books/" + bookId + "/pages/page-000001.txt");
    expect(fatmanIndexPageKey(job, 125)).toBe("fatman/books/" + bookId + "/pages/page-000125.txt");
    expect(fatmanExpectedPageCount(job)).toBe(125);
  });

  it("keeps the original 538-page import in its original namespace", () => {
    const legacyJob = { id: bookId, book_id: null, page_count: null };
    expect(fatmanIndexPagePrefix(legacyJob)).toBe("fatman/pages/");
    expect(fatmanIndexPageKey(legacyJob, 538)).toBe("fatman/pages/page-000538.txt");
    expect(fatmanExpectedPageCount(legacyJob)).toBe(538);
  });

  it("recognises both legacy and isolated multi-book page keys", () => {
    expect(parseFatmanIndexPageKey("fatman/pages/page-000123.jpg")).toEqual({ page: 123 });
    expect(parseFatmanIndexPageKey("fatman/books/" + bookId + "/pages/page-000007.txt"))
      .toEqual({ page: 7, bookId });
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
