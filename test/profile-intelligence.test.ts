import { describe, expect, it } from "vitest";
import { normalizeProfile } from "../src/core/job-store";

describe("v2.4 profile normalization", () => {
  it("always returns a usable learningSignals array", () => {
    const profile = normalizeProfile({
      version: 2,
      targetExam: "SSC CGL",
      recentTopics: ["Permanent Settlement"],
      recentSubjects: ["history"],
      attentionTopics: [],
      revisionQueue: [],
      questionCount: 2,
      lastUpdatedAt: 123,
    });

    expect(profile.version).toBe(2);
    expect(profile.learningSignals).toEqual([]);
  });

  it("migrates a v2.3 attention topic into one historical signal", () => {
    const profile = normalizeProfile({
      version: 1,
      targetExam: "SSC CGL",
      recentTopics: ["Permanent Settlement"],
      recentSubjects: ["history"],
      attentionTopics: ["Permanent Settlement"],
      revisionQueue: ["Permanent Settlement"],
      questionCount: 4,
      lastUpdatedAt: 456,
    });

    expect(profile.version).toBe(2);
    expect(profile.attentionTopics).toEqual([]);
    expect(profile.learningSignals).toEqual([
      { topic: "Permanent Settlement", confusionCount: 1, weakCount: 0, lastSeenAt: 456 },
    ]);
  });

  it("drops malformed learning-signal records instead of letting them reach find()", () => {
    const profile = normalizeProfile({
      version: 2,
      targetExam: "SSC CGL",
      recentTopics: [],
      recentSubjects: [],
      attentionTopics: [],
      revisionQueue: [],
      learningSignals: [null, { topic: "", confusionCount: 1 }, { topic: "Polity", confusionCount: 2, weakCount: 1, lastSeenAt: 9 }],
      questionCount: 1,
      lastUpdatedAt: 9,
    });

    expect(profile.learningSignals).toEqual([
      { topic: "Polity", confusionCount: 2, weakCount: 1, lastSeenAt: 9 },
    ]);
  });
});
