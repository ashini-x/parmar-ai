import { describe, expect, it } from "vitest";
import type { StudentProfile } from "../src/config/env";
import { buildProfileText } from "../src/telegram/profile";

const baseProfile: StudentProfile = {
  version: 2,
  targetExam: "SSC CGL",
  recentTopics: [
    "Greeting",
    "Sunlight & Vitamin D Synthesis",
    "Electromagnetic Radiation & Vitamins",
    "Fundamental Rights and Sources of Constitution",
    "Indian Geography",
  ],
  recentSubjects: [],
  attentionTopics: ["Greeting", "Indian Polity"],
  revisionQueue: ["Greeting", "Fundamental Rights"],
  learningSignals: [
    { topic: "Greeting", confusionCount: 3, weakCount: 0, lastSeenAt: 1 },
    { topic: "Indian Polity", confusionCount: 1, weakCount: 1, lastSeenAt: 2 },
  ],
  questionCount: 6,
  lastUpdatedAt: 0,
};

describe("Telegram study profile formatting", () => {
  it("organizes the profile into readable sections and omits conversational activity", () => {
    const text = buildProfileText(baseProfile, { dayCount: 0, dailyLimit: 10, unlimited: false });

    expect(text).toContain("**YOUR STUDY PROFILE**");
    expect(text).toContain("_Note: परमार्थAI is learning and creating your profile based on your doubts._");
    expect(text).toContain("Target exam: **SSC CGL**");
    expect(text).toContain("Questions tracked: **6**");
    expect(text).toContain("Today: **0/10** questions");
    expect(text).toContain("Sunlight & Vitamin D Synthesis");
    expect(text).toContain("Fundamental Rights and Sources of Constitution");
    expect(text).toContain("+ 1 more topic");
    expect(text).toContain("Indian Polity");
    expect(text).toContain("Fundamental Rights");
    expect(text).not.toContain("Greeting");
  });

  it("shows a simple state before an exam is selected and when usage is unlimited", () => {
    const text = buildProfileText({
      ...baseProfile,
      targetExam: "SSC (not specified)",
      recentTopics: [],
      attentionTopics: [],
      revisionQueue: [],
      learningSignals: [],
      questionCount: 0,
    }, { dayCount: 3, dailyLimit: 10, unlimited: true });

    expect(text).toContain("Target exam: **SSC · exam not selected**");
    expect(text).toContain("Today: **Unlimited** AI access");
    expect(text).toContain("Your study topics will appear here as you practise.");
    expect(text).toContain("Your revision list is building from practice.");
    expect(text).toContain("No clear weak areas yet.");
    expect(text).toContain("More practice will help identify learning patterns.");
  });
});
