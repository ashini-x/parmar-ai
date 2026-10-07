import { describe, expect, it } from "vitest";
import { estimateAiCostUsd } from "../src/ai/gemini";

describe("AI usage accounting", () => {
  it("calculates prompt, cached-input and output/reasoning cost separately", () => {
    const usd = estimateAiCostUsd(
      {
        promptTokens: 2_000,
        candidatesTokens: 300,
        thoughtsTokens: 200,
        toolUsePromptTokens: 100,
        cachedContentTokens: 500,
        inputUsdPerMillion: 0.75,
        cachedInputUsdPerMillion: 0.075,
        outputUsdPerMillion: 3.75,
      },
    );
    expect(usd).toBeCloseTo(0.0031125, 9);
  });

  it("never makes a negative uncached prompt calculation", () => {
    const usd = estimateAiCostUsd(
      {
        promptTokens: 100,
        candidatesTokens: 0,
        thoughtsTokens: 0,
        toolUsePromptTokens: 0,
        cachedContentTokens: 500,
        inputUsdPerMillion: 0.75,
        cachedInputUsdPerMillion: 0.075,
        outputUsdPerMillion: 3.75,
      },
    );
    expect(usd).toBeGreaterThanOrEqual(0);
  });
});
