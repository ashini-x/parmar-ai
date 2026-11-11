import { describe, expect, it } from "vitest";
import {
  M15_BENCHMARK_QUERY_SUITE,
  isM15AiSearchItemPending,
  m15AiSearchMetadataForPage,
  m15AiSearchMetadataSchemaMatches,
  m15AiSearchPageWindow,
  m15QdrantPageWindow,
  shouldPersistM15VisionStatus,
  summarizeM15BenchmarkProvider,
  validateM15BenchmarkPdf,
  handleM15BenchmarkStagingRequest,
} from "../src/brvin/m15-benchmark-staging";

function providerResult(pages: Array<number | null>, ok = true) {
  return {
    ok,
    elapsedMs: 12,
    resultCount: ok ? pages.length : 0,
    retrievedPages: ok ? pages : [],
    provenanceViolationCount: 0,
    candidates: [],
    ...(ok ? {} : { errorType: "Error", errorMessage: "simulated provider failure" }),
  };
}

describe("M15 second-source benchmark definition", () => {
  it("offers read-only recovery and durable browser storage for the registered source ID", async () => {
    const response = await handleM15BenchmarkStagingRequest(
      new Request("https://staging.example/admin/m15/benchmark"),
      { ENVIRONMENT: "staging", BRVIN_M14_PILOT_ENABLED: "true" } as never,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('id="recover"');
    expect(html).toContain("/admin/m15/benchmark/source/recover");
    expect(html).toContain("localStorage.getItem");
    expect(html).toContain("localStorage.setItem");
    expect(html).toContain("operator token is never stored");
  });

  it("waits on queued/running AI Search items and distinguishes terminal states", () => {
    expect(isM15AiSearchItemPending("queued")).toBe(true);
    expect(isM15AiSearchItemPending("running")).toBe(true);
    expect(isM15AiSearchItemPending("completed")).toBe(false);
    expect(isM15AiSearchItemPending("error")).toBe(false);
    expect(isM15AiSearchItemPending("skipped")).toBe(false);
  });

  it("defines the required four-field AI Search metadata schema without mutating a conflicting schema", () => {
    const schema = [
      { field_name: "source_id", data_type: "text" },
      { field_name: "project_id", data_type: "text" },
      { field_name: "pdf_page", data_type: "number" },
      { field_name: "benchmark", data_type: "text" },
    ];
    expect(m15AiSearchMetadataSchemaMatches(schema)).toBe(true);
    expect(m15AiSearchMetadataSchemaMatches(null)).toBe(false);
    expect(m15AiSearchMetadataSchemaMatches(schema.slice(0, 3))).toBe(false);
    expect(m15AiSearchMetadataSchemaMatches([...schema, { field_name: "extra", data_type: "text" }])).toBe(false);
    expect(m15AiSearchMetadataSchemaMatches(schema.map((field) =>
      field.field_name === "pdf_page" ? { ...field, data_type: "text" } : field
    ))).toBe(false);
  });

  it("sends all custom metadata values as strings to the AI Search Workers binding", () => {
    const metadata = m15AiSearchMetadataForPage("source-1", "project-1", 8);
    expect(metadata).toEqual({
      source_id: "source-1",
      project_id: "project-1",
      pdf_page: "8",
      benchmark: "brvin-m15-physics-v1",
    });
    expect(Object.values(metadata).every((value) => typeof value === "string")).toBe(true);
    expect(() => m15AiSearchMetadataForPage("", "project-1", 1)).toThrow();
    expect(() => m15AiSearchMetadataForPage("source-1", "project-1", 9)).toThrow();
  });

  it("splits AI Search indexing into resumable two-page Worker invocations", () => {
    expect(m15AiSearchPageWindow(0)).toEqual({ startIndex: 0, endIndex: 2 });
    expect(m15AiSearchPageWindow(2)).toEqual({ startIndex: 2, endIndex: 4 });
    expect(m15AiSearchPageWindow(4)).toEqual({ startIndex: 4, endIndex: 6 });
    expect(m15AiSearchPageWindow(6)).toEqual({ startIndex: 6, endIndex: 8 });
    expect(m15AiSearchPageWindow(8)).toEqual({ startIndex: 8, endIndex: 8 });
    expect(() => m15AiSearchPageWindow(-1)).toThrow();
    expect(() => m15AiSearchPageWindow(9)).toThrow();
  });

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

  it("does not count failed negative-control queries as successful zero-candidate checks", () => {
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
        id: "N03", category: "out-of-corpus", expectedPages: [], expectedNoMatch: true,
        result: providerResult([], false),
      },
      {
        id: "H01", category: "exact-symbol-near-miss", expectedPages: [], expectedNoMatch: true,
        result: providerResult([], false),
      },
    ]);
    expect(summary).toMatchObject({
      queryCount: 5,
      positiveQueryCount: 1,
      positiveQueriesCompleted: 1,
      positiveQueryFailures: 0,
      expectedPageTargets: 1,
      coveredExpectedPageTargets: 1,
      positivePageLabelPrecisionAt5: 2 / 5,
      allSuitePageLabelPrecisionAt5: 2 / 25,
      outOfCorpusQueryCount: 3,
      outOfCorpusQueriesCompleted: 2,
      outOfCorpusQueryFailures: 1,
      outOfCorpusAllQueriesCompleted: false,
      outOfCorpusQueriesWithCandidates: 1,
      outOfCorpusQueriesWithoutCandidates: 1,
      outOfCorpusCandidatePresenceRate: 0.5,
      outOfCorpusCandidateCount: 2,
      exactSymbolNearMissCount: 1,
      exactSymbolNearMissQueriesCompleted: 0,
      exactSymbolNearMissQueryFailures: 1,
      exactSymbolNearMissAllQueriesCompleted: false,
      exactSymbolNearMissWithCandidates: 0,
      exactSymbolNearMissWithoutCandidates: 0,
      exactSymbolNearMissCandidatePresenceRate: null,
      exactSymbolNearMissCandidateCount: 0,
      allNegativeControlsCompleted: false,
    });
    expect("falsePositiveRate" in summary).toBe(false);
  });
});
