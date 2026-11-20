import { describe, expect, it } from "vitest";
import type { Env, ProfileContext } from "../src/config/env";
import { buildStandardArenaPrompt, buildUserPrompt } from "../src/ai/gemini";

const profileContext: ProfileContext = {
  profile: {
    version: 2,
    targetExam: "SSC CGL",
    recentTopics: ["Indian Constitution"],
    recentSubjects: ["polity"],
    attentionTopics: [],
    revisionQueue: [],
    learningSignals: [],
    questionCount: 3,
    lastUpdatedAt: 0,
  },
  recentTopicHint: "Indian Constitution",
  attentionTopicHint: "",
  revisionHint: "",
  recentConversation: [
    { question: "What is Article 32?", answer: "Article 32 provides the right to constitutional remedies." },
  ],
};

describe("Standard SSC Model Arena prompt parity", () => {
  it("uses the production prompt builder and carries browser conversation turns", () => {
    const env = {
      ENABLE_GOOGLE_SEARCH_GROUNDING: "false",
      GEMINI_THINKING_LEVEL: "HIGH",
    } as unknown as Env;
    const result = buildStandardArenaPrompt(env, "Explain this simply", profileContext);
    const expected = buildUserPrompt("Explain this simply", profileContext, false, false, result.requestedQuizCount);
    expect(result.prompt).toBe(expected);
    expect(result.prompt).toContain("Article 32 provides the right to constitutional remedies.");
    expect(result.clarificationPacket).toBeUndefined();
  });

  it("uses the same Telegram pre-generation clarification for a generic quiz without a topic", () => {
    const env = { ENABLE_GOOGLE_SEARCH_GROUNDING: "false" } as unknown as Env;
    const context: ProfileContext = {
      ...profileContext,
      profile: {
        ...profileContext.profile,
        recentTopics: [],
      },
      recentTopicHint: "",
      recentConversation: [],
    };
    const result = buildStandardArenaPrompt(env, "Give me a quiz", context);
    expect(result.clarificationPacket?.questionMode).toBe("mcq");
    expect(result.clarificationPacket?.answer).toContain("kis topic par chahiye");
  });
});
