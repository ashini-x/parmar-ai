import { describe, expect, it } from "vitest";
import {
  BRVIN_M15_FATMAN_SOURCE,
  compositeScore,
  hasFatmanLegacyPhysicalPageMarker,
  pageNumberFromLegacyKey,
  validateJudgeAssessment,
} from "../src/brvin/m15-fatman-benchmark";

describe("M15 full-corpus Fatman benchmark helpers", () => {
  it("pins the benchmark to the 538-page Fatman legacy source fingerprint", () => {
    expect(BRVIN_M15_FATMAN_SOURCE.pageCount).toBe(538);
    expect(BRVIN_M15_FATMAN_SOURCE.sourcePdfSha256).toBe(
      "8b183803fe8ee53087d731f7319519af9ac5bb62b39b2d3110acc3fe0ab59886",
    );
    expect(BRVIN_M15_FATMAN_SOURCE.sourceId).toBe("fatman-legacy-538");
    expect(BRVIN_M15_FATMAN_SOURCE.legacyImportJobId).toBe("6b94a848-c642-4be3-8718-3ae5a7d25b35");
    expect(BRVIN_M15_FATMAN_SOURCE.expectedSize).toBe(115395596);
    expect(BRVIN_M15_FATMAN_SOURCE.originalVisionOperationId).toBe(
      "projects/project-90db7be4-619f-4ed7-89b/operations/7358e7d1e97523c3",
    );
  });

  it("accepts only valid legacy physical-page keys within the exact 538-page range", () => {
    expect(pageNumberFromLegacyKey("fatman/pages/page-000001.txt")).toBe(1);
    expect(pageNumberFromLegacyKey("fatman/pages/page-000538.txt")).toBe(538);
    expect(pageNumberFromLegacyKey("fatman/pages/page-000168.txt")).toBe(168);
    expect(pageNumberFromLegacyKey("fatman/pages/page-000539.txt")).toBeNull();
    expect(pageNumberFromLegacyKey("fatman/pages/page-000000.txt")).toBeNull();
    expect(pageNumberFromLegacyKey("brvin/books/00000000-0000-4000-8000-000000000000/pages/page-000001.txt")).toBeNull();
    expect(pageNumberFromLegacyKey("fatman/pages/../page-000001.txt")).toBeNull();
  });

  it("recognizes both existing Fatman OCR page header forms without accepting a mismatched page", () => {
    expect(hasFatmanLegacyPhysicalPageMarker(
      "Fatman 2nd Edition 2026 | PDF page 168\n\nBattle of Plassey",
      168,
    )).toBe(true);
    expect(hasFatmanLegacyPhysicalPageMarker("Fatman 2nd Edition\nPDF page: 168\nText", 168)).toBe(true);
    expect(hasFatmanLegacyPhysicalPageMarker("Fatman 2nd Edition\nPDF page 169\nText", 168)).toBe(false);
    expect(hasFatmanLegacyPhysicalPageMarker("No physical-page marker here", 168)).toBe(false);
  });

  it("applies the frozen 35/30/25/10 adjudication weights", () => {
    expect(compositeScore({
      retrievalRelevance: 5,
      answerCorrectness: 4,
      sourceGrounding: 3,
      citationAccuracy: 1,
      abstainedCorrectly: true,
      criticalError: false,
      missingFacts: [],
      unsupportedClaims: [],
      rationale: "test",
    })).toBe(3.8);
  });

  it("rejects scores outside 0–5 and missing abstention/error flags", () => {
    const valid = {
      retrievalRelevance: 5,
      answerCorrectness: 4,
      sourceGrounding: 3,
      citationAccuracy: 2,
      abstainedCorrectly: true,
      criticalError: false,
      missingFacts: [],
      unsupportedClaims: [],
      rationale: "grounded",
    };
    expect(validateJudgeAssessment(valid)).toEqual(valid);
    expect(() => validateJudgeAssessment({ ...valid, sourceGrounding: 6 })).toThrow(/sourceGrounding/u);
    expect(() => validateJudgeAssessment({ ...valid, abstainedCorrectly: "yes" })).toThrow(/abstention/u);
  });
});
