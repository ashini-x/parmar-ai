import { describe, expect, it } from "vitest";
import {
  BRVIN_DELETION_SEARCH_PAGE_SIZE,
  brvinDeletionProgressPercent,
  brvinDeletionSearchPageRequest,
} from "../src/fatman/deletion";

describe("BRVIN full-book deletion controls", () => {
  it("caps each AI Search inventory and verification page at the provider limit", () => {
    expect(BRVIN_DELETION_SEARCH_PAGE_SIZE).toBe(50);
    expect(brvinDeletionSearchPageRequest(1)).toEqual({
      page: 1,
      per_page: 50,
      source: "builtin",
    });
    expect(brvinDeletionSearchPageRequest(12)).toEqual({
      page: 12,
      per_page: 50,
      source: "builtin",
    });
    expect(() => brvinDeletionSearchPageRequest(0)).toThrow(RangeError);
    expect(() => brvinDeletionSearchPageRequest(1.5)).toThrow(RangeError);
  });

  it("reports monotonic stage-weighted progress from actual completed batches", () => {
    expect(brvinDeletionProgressPercent("inventory", 0, 1)).toBe(0);
    expect(brvinDeletionProgressPercent("inventory", 1, 1)).toBe(5);
    expect(brvinDeletionProgressPercent("search", 0, 4)).toBe(5);
    expect(brvinDeletionProgressPercent("search", 2, 4)).toBe(32);
    expect(brvinDeletionProgressPercent("search", 4, 4)).toBe(60);
    expect(brvinDeletionProgressPercent("search_verify", 1, 1)).toBe(65);
    expect(brvinDeletionProgressPercent("source_storage", 5, 10)).toBe(72);
    expect(brvinDeletionProgressPercent("source_storage", 10, 10)).toBe(80);
    expect(brvinDeletionProgressPercent("ocr_storage", 0, 2)).toBe(80);
    expect(brvinDeletionProgressPercent("ocr_storage", 2, 2)).toBe(95);
    expect(brvinDeletionProgressPercent("registry", 1, 1)).toBe(99);
    expect(brvinDeletionProgressPercent("complete")).toBe(100);
  });

  it("treats an empty storage prefix as completed work rather than a stuck zero-percent task", () => {
    expect(brvinDeletionProgressPercent("source_storage", 0, 0)).toBe(80);
    expect(brvinDeletionProgressPercent("ocr_storage", 0, 0)).toBe(95);
  });

  it("clamps noisy or over-reported counts to the stage's own percentage range", () => {
    expect(brvinDeletionProgressPercent("search", -5, 10)).toBe(5);
    expect(brvinDeletionProgressPercent("search", 500, 10)).toBe(60);
  });
});
