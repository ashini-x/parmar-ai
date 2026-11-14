import { describe, expect, it } from "vitest";
import { formatSuccessfulQuestionAnswer } from "../src/telegram/answer-format";

describe("successful question answer heading", () => {
  it("adds the green dot and exact heading to a normal SSC answer", () => {
    expect(formatSuccessfulQuestionAnswer("Article 23 prohibits forced labour.", {
      responseMode: "text",
      answerScope: "ssc_ga_gs",
    })).toBe("🟢 Final answer\\n\\nArticle 23 prohibits forced labour.");
  });

  it("adds the same heading to a successful Fatman answer", () => {
    expect(formatSuccessfulQuestionAnswer("The book explains Article 23.", {
      responseMode: "text",
      answerScope: "ssc_support",
    })).toBe("🟢 Final answer\\n\\nThe book explains Article 23.");
  });

  it("does not add the heading to out-of-scope responses", () => {
    expect(formatSuccessfulQuestionAnswer("Please send an SSC-related doubt.", {
      responseMode: "text",
      answerScope: "out_of_scope",
    })).toBe("Please send an SSC-related doubt.");
  });

  it("does not add the heading to notices or quiz responses", () => {
    expect(formatSuccessfulQuestionAnswer("Please add a keyword.", {
      responseMode: "text",
      answerScope: "ssc_support",
      isNotice: true,
    })).toBe("Please add a keyword.");
    expect(formatSuccessfulQuestionAnswer("Quiz question", {
      responseMode: "quiz",
      answerScope: "ssc_ga_gs",
    })).toBe("Quiz question");
  });

  it("does not decorate an empty answer", () => {
    expect(formatSuccessfulQuestionAnswer("  ", {
      responseMode: "text",
      answerScope: "ssc_ga_gs",
    })).toBe("  ");
  });
});
