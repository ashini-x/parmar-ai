import { describe, expect, it } from "vitest";
import {
  BRVIN_M15_FATMAN_SOURCE,
  compositeScore,
  decideFatmanProviderWinner,
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

  it("selects Qdrant only when both independent agents and the adjudicated score prefer it without guardrail regressions", () => {
    const ai = {
      deterministicQaPassed: 11,
      criticalErrorCount: 1,
      outOfBookAbstentionPassed: 1,
      agentACompositeScore: 4.1,
      agentBCompositeScore: 4.0,
      adjudicatedCompositeScore: 4.05,
    };
    const qdrant = {
      deterministicQaPassed: 12,
      criticalErrorCount: 0,
      outOfBookAbstentionPassed: 1,
      agentACompositeScore: 4.3,
      agentBCompositeScore: 4.2,
      adjudicatedCompositeScore: 4.25,
    };
    expect(decideFatmanProviderWinner(ai, qdrant)).toMatchObject({
      winner: "qdrant-vertex",
      qdrantNotWorseOnGuardrails: true,
      qdrantWinsByBothAssessors: true,
    });
  });

  it("returns no-clear-winner when the independent assessors disagree", () => {
    const ai = {
      deterministicQaPassed: 12,
      criticalErrorCount: 0,
      outOfBookAbstentionPassed: 1,
      agentACompositeScore: 4.2,
      agentBCompositeScore: 4.0,
      adjudicatedCompositeScore: 4.1,
    };
    const qdrant = {
      deterministicQaPassed: 12,
      criticalErrorCount: 0,
      outOfBookAbstentionPassed: 1,
      agentACompositeScore: 4.3,
      agentBCompositeScore: 3.9,
      adjudicatedCompositeScore: 4.25,
    };
    expect(decideFatmanProviderWinner(ai, qdrant).winner).toBe("no-clear-winner");
  });

  it("blocks Qdrant when a deterministic, critical-error or abstention guardrail regresses", () => {
    const ai = {
      deterministicQaPassed: 12,
      criticalErrorCount: 0,
      outOfBookAbstentionPassed: 1,
      agentACompositeScore: 4.0,
      agentBCompositeScore: 4.0,
      adjudicatedCompositeScore: 4.0,
    };
    const qdrant = {
      deterministicQaPassed: 11,
      criticalErrorCount: 1,
      outOfBookAbstentionPassed: 0,
      agentACompositeScore: 4.8,
      agentBCompositeScore: 4.8,
      adjudicatedCompositeScore: 4.8,
    };
    const decision = decideFatmanProviderWinner(ai, qdrant);
    expect(decision.winner).toBe("no-clear-winner");
    expect(decision.qdrantNotWorseOnGuardrails).toBe(false);
  });

  it("selects Cloudflare AI Search symmetrically when both agents and adjudication prefer it", () => {
    const ai = {
      deterministicQaPassed: 12,
      criticalErrorCount: 0,
      outOfBookAbstentionPassed: 1,
      agentACompositeScore: 4.5,
      agentBCompositeScore: 4.4,
      adjudicatedCompositeScore: 4.45,
    };
    const qdrant = {
      deterministicQaPassed: 11,
      criticalErrorCount: 1,
      outOfBookAbstentionPassed: 0,
      agentACompositeScore: 4.2,
      agentBCompositeScore: 4.1,
      adjudicatedCompositeScore: 4.15,
    };
    expect(decideFatmanProviderWinner(ai, qdrant)).toMatchObject({
      winner: "cloudflare-ai-search",
      aiWinsByBothAssessors: true,
      aiNotWorseOnGuardrails: true,
    });
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
