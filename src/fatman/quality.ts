import { isTransientFatmanIndexError } from "./recovery-policy";

export const FATMAN_VERIFICATION_PAGES = [54, 269, 485] as const;

const COMMON_WORDS = new Set([
  "about", "after", "again", "also", "among", "because", "been", "being", "between",
  "both", "could", "does", "each", "from", "have", "into", "more", "most", "other",
  "over", "same", "such", "than", "that", "their", "there", "these", "this", "those",
  "through", "under", "very", "were", "what", "when", "where", "which", "while", "with",
  "would", "your", "page", "chapter",
]);

/** Build several deterministic, page-grounded query candidates from OCR text. */
export function buildFatmanRetrievalProbes(text: string): string[] {
  const words = text
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((word) => word.length >= 3);

  if (words.length < 6) {
    throw new Error("Fatman retrieval QA cannot build a probe from fewer than six OCR words.");
  }

  const count = Math.min(12, words.length);
  const window = (start: number) => words.slice(start, start + count).join(" ").slice(0, 240);
  const middleStart = Math.max(0, Math.min(words.length - count, Math.floor(words.length / 2) - Math.floor(count / 2)));
  const distinctive = words
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => word.length >= 5 && !COMMON_WORDS.has(word.toLowerCase()))
    .sort((a, b) => b.word.length - a.word.length || a.index - b.index)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map(({ word }) => word)
    .join(" ")
    .slice(0, 240);

  const candidates = [
    window(middleStart),
    distinctive,
    window(0),
    window(Math.max(0, words.length - count)),
  ].filter((query) => query.trim().length > 0);

  return [...new Set(candidates)];
}

/** Backwards-compatible primary probe for callers/tests that need one query. */
export function buildFatmanRetrievalProbe(text: string): string {
  return buildFatmanRetrievalProbes(text)[0];
}

export function isRetryableFatmanQualityFailure(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return isTransientFatmanIndexError(error) || message.includes("retrieval qa could not match");
}
