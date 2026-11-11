import { describe, expect, it } from "vitest";
import {
  M15_BENCHMARK_QUERY_SUITE,
  M15_FORMULA_AUDIT_QUERY_IDS,
  createM15FormulaAuditPdfAttachment,
  m15FormulaAuditPdfPages,
  m15BenchmarkBatchWindow,
  isM15AiSearchItemPending,
  m15AiSearchMetadataForPage,
  m15AiSearchMetadataSchemaMatches,
  m15AiSearchPageWindow,
  m15QdrantPageWindow,
  shouldPersistM15VisionStatus,
  summarizeM15BenchmarkProvider,
  evaluateM15AnswerQuality,
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

  it("limits the original-PDF audit to the five fixed formula-sensitive queries and their expected physical pages", () => {
    expect(M15_FORMULA_AUDIT_QUERY_IDS).toEqual(["P01", "P08", "P11", "P12", "H01"]);
    expect(m15FormulaAuditPdfPages("P01")).toEqual([1]);
    expect(m15FormulaAuditPdfPages("P08")).toEqual([4]);
    expect(m15FormulaAuditPdfPages("P11")).toEqual([7]);
    expect(m15FormulaAuditPdfPages("P12")).toEqual([8]);
    expect(m15FormulaAuditPdfPages("H01")).toEqual([8]);
    expect(m15FormulaAuditPdfPages("N01")).toBeNull();
    expect(m15FormulaAuditPdfPages("P02")).toBeNull();
  });

  it("attaches only a bounded PDF whose bytes match the approved SHA-256 and permitted pages", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nsource fixture");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha256 = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
    const attachment = await createM15FormulaAuditPdfAttachment(bytes, sha256, [8]);
    expect(attachment).toMatchObject({
      mimeType: "application/pdf",
      sha256,
      allowedPhysicalPages: [8],
    });
    const decoded = Uint8Array.from(atob(attachment.base64Data), (character) => character.charCodeAt(0));
    expect(decoded).toEqual(bytes);
    await expect(createM15FormulaAuditPdfAttachment(bytes, "0".repeat(64), [8]))
      .rejects.toThrow("does not match");
    await expect(createM15FormulaAuditPdfAttachment(bytes, sha256, [0]))
      .rejects.toThrow("valid physical PDF pages");
    await expect(createM15FormulaAuditPdfAttachment(new TextEncoder().encode("not a PDF"), sha256, [8]))
      .rejects.toThrow("valid bounded PDF");
  });

  it("serves the isolated consumer answer evaluation page only in staging", async () => {
    const staging = await handleM15BenchmarkStagingRequest(
      new Request("https://staging.example/admin/m15/benchmark/answers"),
      { ENVIRONMENT: "staging", BRVIN_M14_PILOT_ENABLED: "true" } as never,
    );
    const html = await staging.text();
    expect(staging.status).toBe(200);
    expect(html).toContain("/admin/m15/benchmark/answers/source");
    expect(html).toContain("/admin/m15/benchmark/answers/run");
    expect(html).toContain("Run all 17 queries");
    expect(html).toContain('id="formulaRun"');
    expect(html).toContain("/admin/m15/benchmark/answers/formula-audit/run");
    expect(html).toContain("five additional query pairs");
    expect(html).toContain("Download JSON results");

    const production = await handleM15BenchmarkStagingRequest(
      new Request("https://production.example/admin/m15/benchmark/answers"),
      { ENVIRONMENT: "production", BRVIN_M14_PILOT_ENABLED: "true" } as never,
    );
    expect(production.status).toBe(404);
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

  it("splits the 17 paired benchmark queries into small Worker invocation windows", () => {
    expect(m15BenchmarkBatchWindow(0)).toEqual({ startIndex: 0, endIndex: 3, hasMore: true });
    expect(m15BenchmarkBatchWindow(3)).toEqual({ startIndex: 3, endIndex: 6, hasMore: true });
    expect(m15BenchmarkBatchWindow(6)).toEqual({ startIndex: 6, endIndex: 9, hasMore: true });
    expect(m15BenchmarkBatchWindow(9)).toEqual({ startIndex: 9, endIndex: 12, hasMore: true });
    expect(m15BenchmarkBatchWindow(12)).toEqual({ startIndex: 12, endIndex: 15, hasMore: true });
    expect(m15BenchmarkBatchWindow(15)).toEqual({ startIndex: 15, endIndex: 17, hasMore: false });
    expect(() => m15BenchmarkBatchWindow(1)).toThrow();
    expect(() => m15BenchmarkBatchWindow(17)).toThrow();
    expect(() => m15BenchmarkBatchWindow(-3)).toThrow();
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


describe("M15 consumer answer quality rubric", () => {
  it("grades the restoring-force equation, negative sign, units and energy", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "P12",
      answer: "The restoring force is F_s = -kx = -10 N. Elastic potential energy is E = 1/2 kx^2 = 0.25 J.",
      retrievedPages: [8],
      citedPages: [8],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.overallPass).toBe(true);
    expect(result.mathematicalSymbolFidelity).toBe(true);
  });

  it("rejects a malformed Newton-law equation fragment even when a second equation is correct", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "P01",
      answer: "The relationship is ΣF = m xa | F_net = m × a.",
      retrievedPages: [1],
      citedPages: [1],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.answerCorrectness.checks.find(x => x.id === "avoidsMalformedMassAccelerationToken")?.passed).toBe(false);
    expect(result.mathematicalSymbolFidelity).toBe(false);
    expect(result.overallPass).toBe(false);
  });

  it("rejects capital O in the static-friction zero lower bound", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "P08",
      answer: "Static friction is not always at its maximum. It adjusts from zero up to the maximum: O ≤ f_s ≤ μ_s × N.",
      retrievedPages: [4],
      citedPages: [4],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.answerCorrectness.checks.find(x => x.id === "doesNotRenderZeroAsLetterO")?.passed).toBe(false);
    expect(result.mathematicalSymbolFidelity).toBe(false);
    expect(result.overallPass).toBe(false);
  });

  it("rejects OCR-like doubled-x spring and energy formula strings despite correct final values", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "P12",
      answer: "F_s = -k xx = -10 N. U_s = ½ x k x x² = 0.25 J.",
      retrievedPages: [8],
      citedPages: [8],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.answerCorrectness.checks.find(x => x.id === "rendersSpringForceVariableBoundary")?.passed).toBe(false);
    expect(result.answerCorrectness.checks.find(x => x.id === "rendersElasticEnergyFormula")?.passed).toBe(false);
    expect(result.mathematicalSymbolFidelity).toBe(false);
    expect(result.overallPass).toBe(false);
  });

  it("does not require an unasked friction-direction explanation for P07 magnitude", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "P07",
      answer: "The normal force is N = 5 kg × 9.8 m/s² = 49 N. Kinetic friction is f_k = 0.20 × 49 N = 9.8 N.",
      retrievedPages: [4],
      citedPages: [4],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.overallPass).toBe(true);
  });

  it("grades P09 downslope result independently of phrase/result ordering", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "P09",
      answer: "Downslope component of weight: 4 × 9.8 × sin(30°) = 19.6 N. Normal force: 4 × 9.8 × cos(30°) = 33.95 N.",
      retrievedPages: [5],
      citedPages: [5],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.overallPass).toBe(true);
  });

  it("accepts negative signs as preserved direction when P11's signed results are correct", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "P11",
      answer: "Δp = 0.15 kg × (-30 m/s) = -4.5 kg·m/s. Average force = -4.5 ÷ 0.05 = -90 N.",
      retrievedPages: [7],
      citedPages: [7],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.overallPass).toBe(true);
  });

  it("treats H01 as a source-supported correction, not an abstention", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "H01",
      answer: "The source gives F_s = -kx. F_s = +kx is not the restoring-force equation stated in the source.",
      retrievedPages: [8],
      citedPages: [8],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result).toMatchObject({
      overallPass: true,
      abstentionCorrectness: null,
      mathematicalSymbolFidelity: true,
      citationCorrectness: true,
    });
  });

  it("recognizes H01 rejection when the negation precedes the positive-sign formula", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "H01",
      answer: "The indexed source does not use F_s = +k x x as the restoring-force equation. It gives F_s = -kx.",
      retrievedPages: [8],
      citedPages: [8],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.answerCorrectness.passed).toBe(true);
    expect(result.mathematicalSymbolFidelity).toBe(true);
    expect(result.overallPass).toBe(true);
  });

  it("keeps H01 symbol fidelity pending when OCR-like double-x notation is copied", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "H01",
      answer: "F_s = +k x x is not the restoring-force equation. The source writes F_s = -k xx.",
      retrievedPages: [8],
      citedPages: [8],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.answerCorrectness.checks.find(x => x.id === "explicitlyRejectsPositiveSignAsSourceEquation")?.passed).toBe(true);
    expect(result.answerCorrectness.checks.find(x => x.id === "rendersCanonicalRestoringForceExpression")?.passed).toBe(false);
    expect(result.mathematicalSymbolFidelity).toBe(false);
    expect(result.overallPass).toBe(false);
  });

  it("rejects a model-generated citation to the wrong physical page", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "H01",
      answer: "The source gives F_s = -kx. F_s = +kx is not the restoring-force equation. See PDF page 7.",
      retrievedPages: [8],
      citedPages: [8],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.answerCorrectness.passed).toBe(true);
    expect(result.sourceGroundingCorrectness).toBe(true);
    expect(result.citationCorrectness).toBe(false);
    expect(result.overallPass).toBe(false);
  });

  it("requires abstention when unrelated retrieved evidence is present", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "N01",
      answer: "The indexed source does not provide enough information to answer this question.",
      retrievedPages: [2, 3],
      citedPages: [],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result).toMatchObject({
      overallPass: true,
      abstentionCorrectness: true,
      sourceGroundingCorrectness: true,
      citationCorrectness: true,
    });
  });

  it("passes no-evidence abstention while reporting that irrelevant-evidence resistance was not exercised", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "N01",
      answer: "The indexed source does not provide enough information to answer this question.",
      retrievedPages: [],
      citedPages: [],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result).toMatchObject({
      overallPass: true,
      abstentionCorrectness: true,
      irrelevantEvidenceResistanceDemonstrated: false,
    });
  });

  it("rejects an abstention followed by an unsupported external result", () => {
    const result = evaluateM15AnswerQuality({
      queryId: "N02",
      answer: "The indexed source does not provide enough information. However, the current is 4 A.",
      retrievedPages: [1, 2],
      citedPages: [],
      provenanceViolationCount: 0,
      retrievalOk: true,
    });
    expect(result.overallPass).toBe(false);
    expect(result.abstentionCorrectness).toBe(false);
  });
});
