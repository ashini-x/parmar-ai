import { describe, expect, it } from "vitest";
import { isBotIdentityQuestion, selectThinkingLevel, type ThinkingLevel } from "../src/ai/gemini";

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


describe("Parmar AI and BRɅIN identity intent detection", () => {
  it("recognizes direct identity and development questions", () => {
    expect(isBotIdentityQuestion("Who are you?")).toBe(true);
    expect(isBotIdentityQuestion("Who developed you?")).toBe(true);
    expect(isBotIdentityQuestion("Who created Parmar AI?")).toBe(true);
    expect(isBotIdentityQuestion("How were you trained?")).toBe(true);
  });

  it("recognizes BRɅIN and digital-brain questions", () => {
    expect(isBotIdentityQuestion("What is BRɅIN?")).toBe(true);
    expect(isBotIdentityQuestion("What does BRVIN do?")).toBe(true);
    expect(isBotIdentityQuestion("What is a digital brain?")).toBe(true);
    expect(isBotIdentityQuestion("Digital brain kya hai?")).toBe(true);
    expect(isBotIdentityQuestion("How does BRɅIN work?")).toBe(true);
  });

  it("does not misclassify ordinary SSC creator questions as bot identity", () => {
    expect(isBotIdentityQuestion("Who founded the Indian National Congress?")).toBe(false);
    expect(isBotIdentityQuestion("Who created the Constitution of India?")).toBe(false);
  });
});
