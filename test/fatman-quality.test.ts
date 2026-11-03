import { describe, expect, it } from "vitest";
import {
  buildFatmanRetrievalProbe,
  FATMAN_VERIFICATION_PAGES,
  isRetryableFatmanQualityFailure,
} from "../src/fatman/quality";

describe("Fatman retrieval readiness checks", () => {
  it("samples pages across the beginning, middle and end of the book", () => {
    expect(FATMAN_VERIFICATION_PAGES).toEqual([54, 269, 485]);
  });

  it("builds a compact exact-term query from OCR page text", () => {
    const text = "The Constitution of India establishes a parliamentary system of government and defines the powers and responsibilities of the President.";
    const query = buildFatmanRetrievalProbe(text);
    expect(query.split(" ")).toHaveLength(12);
    const availableWords = new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" "));
    expect(query.split(" ").every((word) => availableWords.has(word.toLowerCase()))).toBe(true);
  });

  it("rejects unreadable OCR and retries temporary retrieval mismatches", () => {
    expect(() => buildFatmanRetrievalProbe("Only two words")).toThrow(/six OCR words/u);
    expect(isRetryableFatmanQualityFailure(new Error("Fatman retrieval QA could not match the expected source page 54."))).toBe(true);
    expect(isRetryableFatmanQualityFailure(new Error("Vision OCR returned invalid document data"))).toBe(false);
  });
});
