import { describe, expect, it } from "vitest";
import {
  M15_BENCHMARK_QUERY_SUITE,
  m15QdrantPageWindow,
  shouldPersistM15VisionStatus,
  summarizeM15BenchmarkProvider,
  validateM15BenchmarkPdf,
} from "../src/brvin/m15-benchmark-staging";

function providerResult(pages: Array<number | null>, ok = true) {
  return {
    ok,
    elapsedMs: 12,
    resultCount: pages.length,
    retrievedPages: pages,
    provenanceViolationCount: 0,
    candidates: [],
  };
}

describe("M15 second-source benchmark definition", () => {
  it("splits Qdrant indexing into resumable two-page Worker invocations", () => {
    expect(m15QdrantPageWindow(0)).toEqual({ startIndex: 0, endIndex: 2 });
    expect(m15QdrantPageWindow(2)).toEqual({ startIndex: 2, endIndex: 4 });
    expect(m15QdrantPageWindow(4)).toEqual({ startIndex: 4, endIndex: 6 });
    expect(m15QdrantPageWindow(6)).toEqual({ startIndex: 6, endIndex: 8 });
    expect(m15QdrantPageWindow(8)).toEqual({ startIndex: 8, endIndex: 8 });
    expect(() => m15QdrantPageWindow(-1)).toThrow();
    expect(() => m15QdrantPageWindow(9)).toThrow();
  });

  it("updates Vision-derived status only while a source is in the OCR stage", () => {
    expect(shouldPersistM15VisionStatus("ocr_running")).toBe(true);
    expect(shouldPersistM15VisionStatus("ocr_completed")).toBe(true);
    expect(shouldPersistM15VisionStatus("ocr_failed")).toBe(true);
    expect(shouldPersistM15VisionStatus("ocr_output_incomplete")).toBe(true);
    expect(shouldPersistM15VisionStatus("corpus_ready")).toBe(false);
    expect(shouldPersistM15VisionStatus("qdrant_ready")).toBe(false);
    expect(shouldPersistM15VisionStatus("ai_search_indexing")).toBe(false);
    expect(shouldPersistM15VisionStatus("ready")).toBe(false);
  });

  it("contains twelve positive queries, four out-of-corpus negatives and one exact-symbol near miss", () => {
    expect(M15_BENCHMARK_QUERY_SUITE).toHaveLength(17);
    expect(M15_BENCHMARK_QUERY_SUITE.filter((item) => item.category === "positive")).toHaveLength(12);
    expect(M15_BENCHMARK_QUERY_SUITE.filter((item) => item.category === "out-of-corpus")).toHaveLength(4);
    expect(M15_BENCHMARK_QUERY_SUITE.filter((item) => item.category === "exact-symbol-near-miss")).toHaveLength(1);
    expect(M15_BENCHMARK_QUERY_SUITE.filter((item) => item.expectedNoMatch)).toHaveLength(5);
  });

  it("accepts only the pinned source filename, byte length and PDF signature", () => {
    const bytes = new Uint8Array(62_012);
    bytes.set(new TextEncoder().encode("%PDF-1.7"));
    expect(validateM15BenchmarkPdf("BRVIN_M15_Physics_Benchmark_Source_v1.pdf", bytes).ok).toBe(true);
    expect(validateM15BenchmarkPdf("BRVIN_M15_Physics_Benchmark_Test_Card_v1.pdf", bytes).ok).toBe(false);
    expect(validateM15BenchmarkPdf("BRVIN_M15_Physics_Benchmark_Source_v1.pdf", bytes.slice(0, 100)).ok).toBe(false);
    const badSignature = new Uint8Array(62_012);
    expect(validateM15BenchmarkPdf("BRVIN_M15_Physics_Benchmark_Source_v1.pdf", badSignature).ok).toBe(false);
  });

  it("keeps page-label metrics separate from candidate presence on no-match cases", () => {
    const summary = summarizeM15BenchmarkProvider([
      {
        id: "P01", category: "positive", expectedPages: [1], expectedNoMatch: false,
        result: providerResult([1, 2, 1, 3, 4]),
      },
      {
        id: "N01", category: "out-of-corpus", expectedPages: [], expectedNoMatch: true,
        result: providerResult([2, 3]),
      },
      {
        id: "N02", category: "out-of-corpus", expectedPages: [], expectedNoMatch: true,
        result: providerResult([]),
      },
      {
        id: "H01", category: "exact-symbol-near-miss", expectedPages: [], expectedNoMatch: true,
        result: providerResult([8]),
      },
    ]);
    expect(summary).toMatchObject({
      queryCount: 4,
      positiveQueryCount: 1,
      expectedPageTargets: 1,
      coveredExpectedPageTargets: 1,
      positivePageLabelPrecisionAt5: 2 / 5,
      allSuitePageLabelPrecisionAt5: 2 / 20,
      outOfCorpusQueryCount: 2,
      outOfCorpusQueriesWithCandidates: 1,
      outOfCorpusCandidatePresenceRate: 0.5,
      outOfCorpusCandidateCount: 2,
      exactSymbolNearMissCount: 1,
      exactSymbolNearMissWithCandidates: 1,
      exactSymbolNearMissCandidateCount: 1,
    });
    expect("falsePositiveRate" in summary).toBe(false);
  });
});
