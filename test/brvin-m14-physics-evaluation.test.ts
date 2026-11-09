import { describe, expect, it } from "vitest";
import {
  BRVIN_M14_PHYSICS_PILOT,
  BRVIN_M14_PHYSICS_QUERY_SUITE,
  summarizeBrvinM14PageCoverage,
} from "../src/brvin/m14-physics-evaluation";

describe("BRVIN M14 Physics pilot evaluation contract", () => {
  it("locks the pilot to the existing registered Physics source and production provenance", () => {
    expect(BRVIN_M14_PHYSICS_PILOT).toMatchObject({
      projectId: "448249b4-fed9-45f5-9137-6014f242ddbe",
      sourceId: "01238b3a-9902-4a42-90b4-574048ee4f00",
      pageCount: 3,
      sourceRef: "TCH-000001-PRJ-001-COL-001-SRC-003",
    });
    expect(BRVIN_M14_PHYSICS_PILOT.sourceSha256).toBe(
      "062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c",
    );
  });

  it("covers the full mixed-content retrieval matrix with unique stable case IDs", () => {
    const ids = BRVIN_M14_PHYSICS_QUERY_SUITE.map((item) => item.id);
    const categories = new Set(BRVIN_M14_PHYSICS_QUERY_SUITE.map((item) => item.category));
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of [
      "conceptual", "exact_formula", "paraphrase", "equivalent_notation",
      "symbol_sensitive", "worked_example", "numerical_setup", "mixed_theory_math",
      "force_friction", "bus_braking", "no_answer",
    ]) expect(categories.has(category as never)).toBe(true);
  });

  it("defines ten positive source-grounded queries and two reviewed negative cases", () => {
    const positive = BRVIN_M14_PHYSICS_QUERY_SUITE.filter(
      (item) => !item.expectedNoMatch && item.expectedPdfPages.length > 0 &&
        (item.verification === "prior-source-evidence" || item.verification === "ocr-ground-truth-verified"),
    );
    const negative = BRVIN_M14_PHYSICS_QUERY_SUITE.filter((item) => item.expectedNoMatch === true);

    expect(positive).toHaveLength(10);
    expect(negative.map((item) => item.id)).toEqual([
      "lowercase-force-symbol-hard-negative",
      "out-of-corpus-constant",
    ]);
    expect(BRVIN_M14_PHYSICS_QUERY_SUITE.find((item) => item.id === "newtons-second-law-exact-formula"))
      .toMatchObject({ expectedPdfPages: [2], expectedExpression: "Fnet = m × a" });
    expect(BRVIN_M14_PHYSICS_QUERY_SUITE.find((item) => item.id === "friction-and-net-force"))
      .toMatchObject({ expectedPdfPages: [3] });
    expect(BRVIN_M14_PHYSICS_QUERY_SUITE.find((item) => item.id === "numerical-force-setup"))
      .toMatchObject({ expectedPdfPages: [3] });
    expect(BRVIN_M14_PHYSICS_QUERY_SUITE.find((item) => item.id === "theory-plus-formula"))
      .toMatchObject({ expectedPdfPages: [2], expectedExpression: "Fnet = m × a" });
  });

  it("reports complete expected physical-page coverage separately from precision", () => {
    const summary = summarizeBrvinM14PageCoverage([
      { expectedPages: [2], expectedPageCoverage: [2] },
      { expectedPages: [3], expectedPageCoverage: [3] },
      { expectedPages: [3, 1], expectedPageCoverage: [3, 1] },
    ]);

    expect(summary).toEqual({
      expectedPageCount: 4,
      coveredExpectedPageCount: 4,
      expectedPageCoverageRate: 1,
      allExpectedPagesCovered: true,
    });
  });

  it("reports partial coverage as a non-passing coverage result", () => {
    const summary = summarizeBrvinM14PageCoverage([
      { expectedPages: [2], expectedPageCoverage: [2] },
      { expectedPages: [3], expectedPageCoverage: [] },
      { expectedPages: [3, 1], expectedPageCoverage: [3, 1] },
    ]);

    expect(summary.expectedPageCount).toBe(4);
    expect(summary.coveredExpectedPageCount).toBe(3);
    expect(summary.expectedPageCoverageRate).toBe(0.75);
    expect(summary.allExpectedPagesCovered).toBe(false);
  });
});
