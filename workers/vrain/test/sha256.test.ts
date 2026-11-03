import { describe, expect, it } from "vitest";
import { Sha256 } from "../src/sha256";

function hashChunks(chunks: string[]): string {
  const hash = new Sha256();
  const encoder = new TextEncoder();
  for (const chunk of chunks) hash.update(encoder.encode(chunk));
  return hash.hex();
}

describe("VRAIN streaming SHA-256", () => {
  it("matches the standard empty-input vector", () => {
    expect(hashChunks([])).toBe("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855");
  });

  it("matches the standard abc vector", () => {
    expect(hashChunks(["abc"])).toBe("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD");
  });

  it("preserves partial blocks across arbitrary chunk boundaries", () => {
    expect(hashChunks(["a", "b", "c"])).toBe("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD");
  });

  it("handles input spanning several complete compression blocks", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(100);
    expect(hashChunks([text.slice(0, 17), text.slice(17, 131), text.slice(131)]))
      .toBe(hashChunks([text]));
  });

  it("rejects updates after finalization", () => {
    const hash = new Sha256();
    hash.hex();
    expect(() => hash.update(new TextEncoder().encode("late"))).toThrow("already finalized");
  });
});
