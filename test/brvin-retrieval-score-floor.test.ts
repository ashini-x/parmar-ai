import { describe, expect, it } from "vitest";
import { isBrvinScoreBelowFloor } from "../src/brvin/retrieval";

describe("BRVIN retrieval score floor", () => {
  it("keeps an exact weighted-RRF boundary score despite IEEE-754 rounding", () => {
    // The MS03 page-2 component ranks are 4/4 (zero-based rank 3), with
    // semantic weights 0.7/0.3 and RRF k=2. The mathematical result is 0.2,
    // but JavaScript represents this sum just below the configured floor.
    const fusedScore = 0.7 / (2 + 3) + 0.3 / (2 + 3);

    expect(fusedScore).toBeLessThan(0.2);
    expect(isBrvinScoreBelowFloor(fusedScore, 0.2)).toBe(false);
  });

  it("continues rejecting materially sub-threshold scores", () => {
    expect(isBrvinScoreBelowFloor(0.199, 0.2)).toBe(true);
    expect(isBrvinScoreBelowFloor(0.15, 0.2)).toBe(true);
  });

  it("does not reject a score above the configured floor", () => {
    expect(isBrvinScoreBelowFloor(0.2001, 0.2)).toBe(false);
  });
});
