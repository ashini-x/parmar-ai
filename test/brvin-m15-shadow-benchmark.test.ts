import { describe, expect, it } from "vitest";
import { summarizeBrvinM15ShadowProvider } from "../src/brvin/m15-shadow-benchmark";

function result(pages: number[], elapsedMs = 10, expectedRanks: Array<number | null> = []) {
  return {
    ok: true,
    elapsedMs,
    resultCount: pages.length,
    retrievedPages: pages,
    expectedPageRanks: expectedRanks,
    provenanceViolationCount: 0,
    candidates: [],
  };
}

describe("BRVIN M15 page-level scorecard", () => {
  it("uses fixed top-five slots and reports no-match false positives separately", () => {
    const summary = summarizeBrvinM15ShadowProvider([
      {
        id: "positive-one",
        expectedPages: [2],
        expectedNoMatch: false,
        result: result([2, 3, 1, 1, 2], 10, [1]),
      },
      {
        id: "positive-two",
        expectedPages: [3],
        expectedNoMatch: false,
        result: result([1, 3, 2], 20, [2]),
      },
      {
        id: "negative-one",
        expectedPages: [],
        expectedNoMatch: true,
        result: result([1, 2, 1, 3, 2], 30, []),
      },
      {
        id: "negative-two",
        expectedPages: [],
        expectedNoMatch: true,
        result: result([], 40, []),
      },
    ]);

    expect(summary).toMatchObject({
      queries: 4,
      successfulQueries: 4,
      failedQueries: 0,
      expectedPageCount: 2,
      coveredExpectedPageCount: 2,
      returnedResultCount: 13,
      positiveReturnedResultCount: 8,
      expectedPageResultCount: 3,
      pageLabelPrecisionAt5: 3 / 20,
      positivePageLabelPrecisionAt5: 3 / 10,
      returnedCandidatePageLabelPrecision: 3 / 13,
      meanReciprocalExpectedPageRank: 0.75,
      noMatchQueryCount: 2,
      noMatchFalsePositiveQueryCount: 1,
      noMatchFalsePositiveCandidateCount: 5,
      noMatchFalsePositiveRate: 0.5,
    });
  });

  it("returns zero for precision and no-match rates when their denominators are empty", () => {
    const summary = summarizeBrvinM15ShadowProvider([]);
    expect(summary.pageLabelPrecisionAt5).toBe(0);
    expect(summary.positivePageLabelPrecisionAt5).toBe(0);
    expect(summary.returnedCandidatePageLabelPrecision).toBe(0);
    expect(summary.noMatchFalsePositiveRate).toBe(0);
    expect(summary.noMatchQueryCount).toBe(0);
  });
});
