import { describe, expect, it } from "vitest";
import { isStudyProfileTopic } from "../src/core/profile-topics";

describe("study profile topic filtering", () => {
  it("excludes generic and conversational labels", () => {
    for (const topic of ["", "General SSC doubt", "Greeting", "Greetings", "Hello", "Welcome", "Thanks", "Small talk"]) {
      expect(isStudyProfileTopic(topic)).toBe(false);
    }
  });

  it("keeps actual academic topics", () => {
    expect(isStudyProfileTopic("Sunlight & Vitamin D Synthesis")).toBe(true);
    expect(isStudyProfileTopic("Fundamental Rights and Sources of Constitution")).toBe(true);
    expect(isStudyProfileTopic("Hi-tech Industry")).toBe(true);
    expect(isStudyProfileTopic("General   SSC doubt")).toBe(false);
  });
});
