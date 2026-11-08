import { describe, expect, it } from "vitest";
import {
  BRVIN_M14_PHYSICS_PILOT,
  BRVIN_M14_PHYSICS_QUERY_SUITE,
} from "../src/brvin/m14-physics-evaluation";

describe("BRVIN M14 Physics pilot evaluation contract", () => {
  it("locks the pilot to the existing registered Physics source and production provenance", () => {
    expect(BRVIN_M14_PHYSICS_PILOT).toMatchObject({
      projectId: "448249b4-fed9-45f5-9137-6014f242ddbe",
      sourceId: "01238b3a-9902-4a42-90b4-574048ee4f00",
      pageCount: 3,
      sourceRef: "TCH-000001-PRJ-001-COL-001-SRC-003",
    });
    expect(BRVIN_M14_PHYSICS_PILOT.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
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

  it("does not promote unverified OCR page labels into passed golden cases", () => {
    const pending = BRVIN_M14_PHYSICS_QUERY_SUITE.filter((item) =>
      item.verification === "pending-ocr-ground-truth",
    );
    const verified = BRVIN_M14_PHYSICS_QUERY_SUITE.filter((item) =>
      item.verification === "prior-source-evidence",
    );
    expect(verified.map((item) => item.id)).toEqual([
      "newtons-second-law-concept",
      "four-kilogram-worked-example",
      "bus-braking-answer",
    ]);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.some((item) => item.category === "symbol_sensitive")).toBe(true);
  });
});
