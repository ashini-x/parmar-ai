import { describe, expect, it } from "vitest";
import { selectThinkingLevel, type ThinkingLevel } from "../src/ai/gemini";

describe("Gemini low-latency thinking policy", () => {
  const cap: ThinkingLevel = "HIGH";

  it("uses LOW for ordinary short questions", () => {
    expect(selectThinkingLevel("What is photosynthesis?", cap)).toBe("LOW");
    expect(selectThinkingLevel("Who is the RBI Governor?", cap)).toBe("LOW");
    expect(selectThinkingLevel("Capital of Assam?", cap)).toBe("LOW");
  });

  it("keeps simple explanations LOW while reserving MEDIUM for explicit reasoning and comparison", () => {
    expect(selectThinkingLevel("Explain photosynthesis simply.", cap)).toBe("LOW");
    expect(selectThinkingLevel("Explain the Battle of Plassey in simple language.", cap)).toBe("LOW");
    expect(selectThinkingLevel("Why did the Revolt of 1857 spread?", cap)).toBe("MEDIUM");
    expect(selectThinkingLevel("Compare Fundamental Rights and DPSPs.", cap)).toBe("MEDIUM");
  });

  it("reserves HIGH for explicit multi-step or unusually long questions", () => {
    expect(selectThinkingLevel("Derive the equation for the escape velocity step by step.", cap)).toBe("HIGH");
    expect(selectThinkingLevel("Show all steps for this multi-step problem.", cap)).toBe("HIGH");
    expect(selectThinkingLevel("context ".repeat(120), cap)).toBe("HIGH");
  });

  it("never exceeds the configured thinking ceiling", () => {
    expect(selectThinkingLevel("Derive this equation step by step.", "MEDIUM")).toBe("MEDIUM");
    expect(selectThinkingLevel("Explain this concept.", "LOW")).toBe("LOW");
  });
});
