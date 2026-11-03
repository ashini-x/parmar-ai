import { describe, expect, it } from "vitest";
import { nextAiSearchPage } from "../src/fatman/pagination";

describe("AI Search pagination", () => {
  it("continues using total_count when total_pages is not returned", () => {
    const response = {
      result: Array.from({ length: 50 }, (_, index) => index),
      result_info: { count: 50, page: 1, per_page: 50, total_count: 306 },
    };
    expect(nextAiSearchPage(response, 1, 50)).toBe(2);
    expect(nextAiSearchPage(response, 6, 50)).toBe(7);
    expect(nextAiSearchPage(response, 7, 50)).toBeNull();
  });

  it("falls back to full-page detection when pagination metadata is absent", () => {
    expect(nextAiSearchPage({ result: Array(50).fill("item") }, 1, 50)).toBe(2);
    expect(nextAiSearchPage({ result: Array(6).fill("item") }, 7, 50)).toBeNull();
  });

  it("stops for an empty page", () => {
    expect(nextAiSearchPage({ result: [] }, 1, 50)).toBeNull();
  });
});
