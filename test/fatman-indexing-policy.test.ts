import { describe, expect, it } from "vitest";
import {
  chunkFatmanPages,
  FATMAN_INDEX_PAGE_CONCURRENCY,
  fatmanIndexMonitorDelayMs,
} from "../src/fatman/indexing-policy";

describe("BRVIN page-index throughput policy", () => {
  it("uses a small bounded concurrency window for page submissions", () => {
    expect(FATMAN_INDEX_PAGE_CONCURRENCY).toBe(3);
    expect(chunkFatmanPages([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8],
    ]);
  });

  it("keeps page order stable and does not drop a short final batch", () => {
    expect(chunkFatmanPages([4, 2, 9, 1, 7], 2)).toEqual([
      [4, 2],
      [9, 1],
      [7],
    ]);
    expect(chunkFatmanPages([])).toEqual([]);
  });

  it("rejects unsafe concurrency settings", () => {
    expect(() => chunkFatmanPages([1], 0)).toThrow(RangeError);
    expect(() => chunkFatmanPages([1], 9)).toThrow(RangeError);
    expect(() => chunkFatmanPages([1], 1.5)).toThrow(RangeError);
  });

  it("checks small PDFs sooner and uses adaptive 15/30-second cadence", () => {
    expect(fatmanIndexMonitorDelayMs(1, 3)).toBe(15_000);
    expect(fatmanIndexMonitorDelayMs(2, 3)).toBe(30_000);
    expect(fatmanIndexMonitorDelayMs(3, 3)).toBe(30_000);
    expect(fatmanIndexMonitorDelayMs(99, 3)).toBe(30_000);
  });

  it("slows status scans as document size increases to control list-call cost", () => {
    expect(fatmanIndexMonitorDelayMs(1, 50)).toBe(30_000);
    expect(fatmanIndexMonitorDelayMs(2, 50)).toBe(45_000);
    expect(fatmanIndexMonitorDelayMs(1, 538)).toBe(45_000);
    expect(fatmanIndexMonitorDelayMs(2, 538)).toBe(60_000);
    expect(fatmanIndexMonitorDelayMs(99, 538)).toBe(60_000);
  });

  it("normalizes invalid sequence/page inputs to the safest slow schedule", () => {
    expect(fatmanIndexMonitorDelayMs(0, 0)).toBe(15_000);
    expect(fatmanIndexMonitorDelayMs(Number.NaN, Number.NaN)).toBe(15_000);
  });
});
