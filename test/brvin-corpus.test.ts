import { describe, expect, it } from "vitest";
import {
  BRVIN_CHUNK_MAX_TOKENS,
  BRVIN_CHUNK_OVERLAP_TOKENS,
  brvinCorpusManifestEnabled,
  buildBrvinPageManifest,
  buildBrvinSourceManifest,
  extractBrvinFormulaCandidates,
  normalizeBrvinSearchText,
} from "../src/brvin/corpus";

describe("BRVIN deterministic durable corpus", () => {
  it("keeps durable corpus writes opt-in and disabled for unset production configuration", () => {
    expect(brvinCorpusManifestEnabled(undefined)).toBe(false);
    expect(brvinCorpusManifestEnabled("false")).toBe(false);
    expect(brvinCorpusManifestEnabled(" TRUE ")).toBe(true);
  });

  it("uses the approved 256-token window and 26-token overlap", () => {
    expect(BRVIN_CHUNK_MAX_TOKENS).toBe(256);
    expect(BRVIN_CHUNK_OVERLAP_TOKENS).toBe(26);
  });

  it("replays identical source text into byte-stable chunk identities and representations", async () => {
    const rawOcrText = "Newton's second law\nF = ma\r\n" +
      Array.from({ length: 300 }, (_, index) => "word" + index).join(" ");
    const source = {
      sourceId: "00000000-0000-4000-8000-000000000401",
      sourcePdfSha256: "A".repeat(64),
      pageCount: 3,
    };
    const manifest = await buildBrvinSourceManifest(source);
    const input = {
      sourceId: source.sourceId,
      sourcePdfSha256: source.sourcePdfSha256,
      generationId: manifest.generationId,
      stableItemKey: "brvin/books/source-401/pages/page-000002.txt",
      pdfPage: 2,
      rawOcrText,
      pageConfidence: 0.91,
    };

    const first = await buildBrvinPageManifest(input);
    const replay = await buildBrvinPageManifest(input);

    expect(replay).toEqual(first);
    expect(first.rawOcrText).toBe(rawOcrText);
    expect(first.chunks).toHaveLength(2);
    expect(first.chunks[0].endToken - first.chunks[1].startToken).toBe(BRVIN_CHUNK_OVERLAP_TOKENS);
    expect(first.chunks[0].id).toMatch(/^brvchunk_[a-f0-9]{64}$/u);
    expect(first.chunks[0].rawText).toContain("F = ma");
    expect(first.chunks[0].contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps raw formula notation beside a conservative, explicitly unverified search representation", () => {
    const formulas = extractBrvinFormulaCandidates("F = ma\nA = ma² + F");
    expect(formulas).toHaveLength(2);
    expect(formulas[0]).toMatchObject({
      originalExpression: "F = ma",
      normalizedSearchExpression: "F = ma",
      confidence: "candidate-unverified",
      extractionMethod: "conservative-ocr-line-heuristic",
      lineNumber: 1,
    });
    expect(formulas[1].originalExpression).toBe("A = ma² + F");
    expect(formulas[1].normalizedSearchExpression).toBe("A = ma² + F");
  });

  it("normalizes Unicode and whitespace without lowercasing variables or substituting operators", () => {
    expect(normalizeBrvinSearchText("  F   =  ma²\nΔv ÷ t  ")).toBe("F = ma² Δv ÷ t");
  });

  it("records physical PDF page provenance and descriptive mixed-content tags", async () => {
    const rawOcrText = "Acceleration is defined as change in velocity per time.\n" +
      "F = ma\nWorked example: Calculate force for a 2 kg body.";
    const manifest = await buildBrvinPageManifest({
      sourceId: "00000000-0000-4000-8000-000000000402",
      sourcePdfSha256: "b".repeat(64),
      generationId: "c".repeat(32),
      stableItemKey: "brvin/books/source-402/pages/page-000007.txt",
      pdfPage: 7,
      rawOcrText,
      pageConfidence: 0.88,
    });

    expect(manifest.pdfPage).toBe(7);
    expect(manifest.stableItemKey).toBe("brvin/books/source-402/pages/page-000007.txt");
    expect(manifest.ocrEvidence).toMatchObject({
      confidenceState: "page-confidence-available",
      pageConfidence: 0.88,
      interpretation: "source-signal-only-not-a-correctness-guarantee",
    });
    expect(manifest.contentTypes).toEqual(expect.arrayContaining([
      "definition", "formula", "worked_example", "numerical_problem", "explanatory_text",
    ]));
    expect(manifest.formulaCandidates[0].originalExpression).toBe("F = ma");
    expect(manifest.chunks.every((chunk) => chunk.id.startsWith("brvchunk_"))).toBe(true);
  });

  it("rejects empty OCR and invalid physical page numbers", async () => {
    await expect(buildBrvinPageManifest({
      sourceId: "source",
      sourcePdfSha256: "d".repeat(64),
      generationId: "e".repeat(32),
      stableItemKey: "source/page-000001.txt",
      pdfPage: 1,
      rawOcrText: "  \n ",
    })).rejects.toThrow("empty OCR text");

    await expect(buildBrvinPageManifest({
      sourceId: "source",
      sourcePdfSha256: "d".repeat(64),
      generationId: "e".repeat(32),
      stableItemKey: "source/page-000000.txt",
      pdfPage: 0,
      rawOcrText: "some text",
    })).rejects.toThrow("positive physical PDF page number");
  });
});
