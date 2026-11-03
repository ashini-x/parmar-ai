import { describe, expect, it } from "vitest";
import {
  buildFatmanBookVerificationPages,
  buildFatmanRetrievalProbe,
  buildFatmanRetrievalProbes,
  FATMAN_VERIFICATION_PAGES,
  isRetryableFatmanQualityFailure,
} from "../src/fatman/quality";

describe("Fatman retrieval readiness checks", () => {
  it("samples pages across the beginning, middle and end of the book", () => {
    expect(FATMAN_VERIFICATION_PAGES).toEqual([54, 269, 485]);
  });

  it("spreads additional-book samples across short and long PDFs", () => {
    expect(buildFatmanBookVerificationPages(1)).toEqual([1]);
    expect(buildFatmanBookVerificationPages(2)).toEqual([1, 2]);
    expect(buildFatmanBookVerificationPages(100)).toEqual([5, 20, 35, 50, 65, 80, 95, 100]);
    expect(() => buildFatmanBookVerificationPages(0)).toThrow();
  });

  it("builds multiple compact queries using only terms present in OCR", () => {
    const text = "The Constitution of India establishes a parliamentary system of government and defines the powers and responsibilities of the President.";
    const probes = buildFatmanRetrievalProbes(text);
    expect(probes.length).toBeGreaterThan(1);
    expect(probes).toContain(buildFatmanRetrievalProbe(text));
    const availableWords = new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" "));
    for (const query of probes) {
      expect(query.length).toBeLessThanOrEqual(240);
      expect(query.split(" ").every((word) => availableWords.has(word.toLowerCase()))).toBe(true);
    }
  });

  it("rejects unreadable OCR and retries temporary retrieval mismatches", () => {
    expect(() => buildFatmanRetrievalProbes("Only two words")).toThrow(/six OCR words/u);
    expect(isRetryableFatmanQualityFailure(new Error("Fatman retrieval QA could not match the expected source page 54."))).toBe(true);
    expect(isRetryableFatmanQualityFailure(new Error("Vision OCR returned invalid document data"))).toBe(false);
  });
});
