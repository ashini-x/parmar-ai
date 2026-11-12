import { describe, expect, it } from "vitest";
import {
  BRVIN_M15_SECOND_SOURCE,
  M15_MULTI_SOURCE_QUERY_SUITE,
  M15_MULTI_SOURCE_QDRANT_DIAGNOSTIC_CASE_IDS,
  isM15MultiSourceDiagnosticSourcePinned,
  m15MultiSourcePageKey,
  m15MultiSourcePageMetadata,
  prepareBrvinM15MultiSourceCorpus,
  runM15MultiSourceCoreV2Evaluation,
  summarizeM15MultiSourceProvider,
} from "../src/brvin/m15-v2-multisource";
import { BRVIN_M15_STAGING_SOURCE_ID } from "../src/brvin/m15-v2-staging";

describe("M15 multi-source Core v2 staging evaluation", () => {
  it("accepts only the exact fingerprint, page-count and search-prefix identities of the two M15 sources", () => {
    const original = {
      id: BRVIN_M15_STAGING_SOURCE_ID,
      source_sha256: "cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92",
      page_count: 8,
      indexed_pages: 8,
      status: "ready",
      search_prefix: "brvin/books/3b4d116d-4c18-450f-9cba-cb2bec3da7ca/pages/",
    };
    expect(isM15MultiSourceDiagnosticSourcePinned(original)).toBe(true);
    expect(isM15MultiSourceDiagnosticSourcePinned({
      ...original,
      source_sha256: "0".repeat(64),
    })).toBe(false);
    expect(isM15MultiSourceDiagnosticSourcePinned({
      ...original,
      page_count: 7,
    })).toBe(false);
    expect(isM15MultiSourceDiagnosticSourcePinned({
      ...original,
      search_prefix: "brvin/books/wrong/pages/",
    })).toBe(false);
    expect(isM15MultiSourceDiagnosticSourcePinned({
      ...original,
      status: "indexing",
    })).toBe(false);

    expect(isM15MultiSourceDiagnosticSourcePinned({
      id: BRVIN_M15_SECOND_SOURCE.sourceId,
      source_sha256: BRVIN_M15_SECOND_SOURCE.sourcePdfSha256,
      page_count: 3,
      indexed_pages: 3,
      status: "ready",
      search_prefix: "brvin/books/" + BRVIN_M15_SECOND_SOURCE.sourceId + "/pages/",
    })).toBe(true);
  });

  it("pins the bounded Qdrant component diagnostic to the five existing paired cases", () => {
    expect(M15_MULTI_SOURCE_QDRANT_DIAGNOSTIC_CASE_IDS).toEqual(["MS01", "MS02", "MS03", "MS04", "MN01"]);
    expect(M15_MULTI_SOURCE_QUERY_SUITE.map((item) => item.id)).toEqual(
      M15_MULTI_SOURCE_QDRANT_DIAGNOSTIC_CASE_IDS,
    );
    expect(M15_MULTI_SOURCE_QUERY_SUITE.find((item) => item.id === "MN01")?.expectedNoMatch).toBe(true);
  });

  it("pins two distinct Physics sources with their exact physical page ranges", () => {
    expect(BRVIN_M15_SECOND_SOURCE).toMatchObject({
      sourceId: "01238b3a-9902-4a42-90b4-574048ee4f00",
      sourcePdfSha256: "062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c",
      generationId: "57129957231e548064e5594d8fb9f501",
      pageCount: 3,
    });
    expect(BRVIN_M15_STAGING_SOURCE_ID).toBe("3b4d116d-4c18-450f-9cba-cb2bec3da7ca");
    expect(BRVIN_M15_STAGING_SOURCE_ID).not.toBe(BRVIN_M15_SECOND_SOURCE.sourceId);

    for (const item of M15_MULTI_SOURCE_QUERY_SUITE) {
      for (const target of item.expectedLocations) {
        const maximumPage = target.sourceId === BRVIN_M15_SECOND_SOURCE.sourceId ? 3 :
          target.sourceId === BRVIN_M15_STAGING_SOURCE_ID ? 8 : 0;
        expect(maximumPage).toBeGreaterThan(0);
        expect(target.pdfPage).toBeGreaterThanOrEqual(1);
        expect(target.pdfPage).toBeLessThanOrEqual(maximumPage);
      }
    }
  });

  it("constructs exact source-scoped physical page keys and rejects unsafe identities", () => {
    expect(m15MultiSourcePageKey(BRVIN_M15_SECOND_SOURCE.sourceId, 3))
      .toBe("brvin/books/01238b3a-9902-4a42-90b4-574048ee4f00/pages/page-000003.txt");
    expect(() => m15MultiSourcePageKey("not-a-source", 1)).toThrow();
    expect(() => m15MultiSourcePageKey(BRVIN_M15_SECOND_SOURCE.sourceId, 0)).toThrow();
    expect(() => m15MultiSourcePageKey(BRVIN_M15_SECOND_SOURCE.sourceId, 2_001)).toThrow();
  });

  it("reports source-level coverage separately from no-match candidate noise", () => {
    const cases = [
      {
        expectedLocations: [
          { sourceId: BRVIN_M15_SECOND_SOURCE.sourceId, pdfPage: 2 },
          { sourceId: BRVIN_M15_STAGING_SOURCE_ID, pdfPage: 1 },
        ],
        result: {
          ok: true, searchedSources: 2, searchCount: 1, elapsedMs: 120,
          provenanceViolationCount: 0, expectedLocationHits: [],
          passages: [
            { sourceId: BRVIN_M15_SECOND_SOURCE.sourceId, sourceTitle: "M14 Physics", pdfPage: 2, score: 0.8, text: "formula", provenanceValid: true },
            { sourceId: BRVIN_M15_STAGING_SOURCE_ID, sourceTitle: "M15 Physics", pdfPage: 1, score: 0.7, text: "force", provenanceValid: true },
          ],
        },
      },
      {
        expectedLocations: [],
        result: {
          ok: true, searchedSources: 2, searchCount: 1, elapsedMs: 180,
          provenanceViolationCount: 0, expectedLocationHits: [],
          passages: [
            { sourceId: BRVIN_M15_STAGING_SOURCE_ID, sourceTitle: "M15 Physics", pdfPage: 3, score: 0.4, text: "mass", provenanceValid: true },
          ],
        },
      },
    ];
    const summary = summarizeM15MultiSourceProvider(cases);

    expect(summary).toMatchObject({
      queryCount: 2,
      successfulQueries: 2,
      failedQueries: 0,
      bothSourcesRepresented: true,
      expectedLocationCount: 2,
      expectedLocationsFound: 2,
      expectedLocationCoverage: 1,
      provenanceViolationCount: 0,
      noMatchQueryCandidateCount: 1,
      latencyMs: { sampleCount: 2, p50: 120, p95: 180 },
    });
  });

  it("does not count a source ID or physical page outside the two pinned inventories", () => {
    const summary = summarizeM15MultiSourceProvider([{
      expectedLocations: [{ sourceId: BRVIN_M15_SECOND_SOURCE.sourceId, pdfPage: 2 }],
      result: {
        ok: true, searchedSources: 2, searchCount: 1, elapsedMs: 50,
        provenanceViolationCount: 1, expectedLocationHits: [],
        passages: [
          { sourceId: "unknown-source", sourceTitle: "unknown", pdfPage: 1, score: 0.9, text: "not allowed", provenanceValid: false },
          { sourceId: BRVIN_M15_SECOND_SOURCE.sourceId, sourceTitle: "M14 Physics", pdfPage: 9, score: 0.8, text: "", provenanceValid: false },
        ],
      },
    }]);
    expect(summary.authorizedSourceIdsReturned).toEqual([]);
    expect(summary.bothSourcesRepresented).toBe(false);
    expect(summary.provenanceViolationCount).toBe(1);
  });
  it("fails closed outside isolated staging before touching D1 or provider resources", async () => {
    const env = { ENVIRONMENT: "production", BRVIN_M14_PILOT_ENABLED: "true" } as never;
    await expect(prepareBrvinM15MultiSourceCorpus(env))
      .rejects.toThrow("restricted to isolated Core staging");
    await expect(runM15MultiSourceCoreV2Evaluation(env))
      .rejects.toThrow("restricted to isolated Core staging");
  });

  it("fails closed when the isolated staging D1 binding is absent", async () => {
    const env = { ENVIRONMENT: "staging", BRVIN_M14_PILOT_ENABLED: "true" } as never;
    await expect(prepareBrvinM15MultiSourceCorpus(env))
      .rejects.toThrow("isolated M15 staging D1 database is missing");
    await expect(runM15MultiSourceCoreV2Evaluation(env))
      .rejects.toThrow("isolated M15 staging D1 database is missing");
  });
  it("sends string-valued metadata accepted by the AI Search Items binding while preserving the numeric schema", () => {
    expect(m15MultiSourcePageMetadata(3)).toEqual({
      source_id: BRVIN_M15_SECOND_SOURCE.sourceId,
      project_id: "890f6317-69f4-4391-aae6-556155ed0d12",
      pdf_page: "3",
      benchmark: "brvin-m15-multisource-v1",
    });
    expect(typeof m15MultiSourcePageMetadata(1).pdf_page).toBe("string");
    expect(() => m15MultiSourcePageMetadata(0)).toThrow();
    expect(() => m15MultiSourcePageMetadata(4)).toThrow();
  });
});
