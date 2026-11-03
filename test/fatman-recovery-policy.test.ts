import { describe, expect, it } from "vitest";
import {
  FATMAN_PAGE_RETRY_LIMIT,
  fatmanPageRetryDelay,
  isTransientFatmanIndexError,
} from "../src/fatman/recovery-policy";

describe("Fatman self-healing retry policy", () => {
  it("recognizes the current AI Search connection failure as transient", () => {
    expect(isTransientFatmanIndexError(new Error("AiSearchInternalError: unable_to_connect_to_ai_search"))).toBe(true);
    expect(isTransientFatmanIndexError(new Error("HTTP 503 Service Unavailable"))).toBe(true);
    expect(isTransientFatmanIndexError(new Error("HTTP 429 rate limited"))).toBe(true);
  });

  it("does not retry permanent input or configuration errors", () => {
    expect(isTransientFatmanIndexError(new Error("Vision OCR returned no readable text"))).toBe(false);
    expect(isTransientFatmanIndexError(new Error("Fatman AI Search is not configured"))).toBe(false);
  });

  it("uses bounded exponential backoff for up to twelve attempts", () => {
    expect(FATMAN_PAGE_RETRY_LIMIT).toBe(12);
    expect(fatmanPageRetryDelay(1)).toBe("30 seconds");
    expect(fatmanPageRetryDelay(2)).toBe("1 minutes");
    expect(fatmanPageRetryDelay(6)).toBe("15 minutes");
    expect(fatmanPageRetryDelay(99)).toBe("15 minutes");
  });
});
