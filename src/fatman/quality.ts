import { isTransientFatmanIndexError } from "./recovery-policy";

export const FATMAN_VERIFICATION_PAGES = [54, 269, 485] as const;

/** Build a page-grounded exact-term retrieval probe from OCR text. */
export function buildFatmanRetrievalProbe(text: string): string {
  const words = text
    .replace(/\\s+/gu, " ")
    .trim()
    .split(" ")
    .filter((word) => word.replace(/[^\\p{L}\\p{N}]/gu, "").length >= 3);

  if (words.length < 6) {
    throw new Error("Fatman retrieval QA cannot build a probe from fewer than six OCR words.");
  }

  const count = Math.min(12, words.length);
  const start = Math.max(0, Math.min(words.length - count, Math.floor(words.length / 2) - Math.floor(count / 2)));
  return words.slice(start, start + count).join(" ").slice(0, 240);
}

export function isRetryableFatmanQualityFailure(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return isTransientFatmanIndexError(error) || message.includes("retrieval qa could not match");
}
