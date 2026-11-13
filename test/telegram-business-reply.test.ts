import { describe, expect, it } from "vitest";
import { BUSINESS_AUTO_REPLY_TEXT } from "../src/telegram/business-reply";

describe("Telegram personal-account business auto-reply", () => {
  it("uses the approved copy with exactly one blank line between paragraphs", () => {
    expect(BUSINESS_AUTO_REPLY_TEXT).toBe(
      "Hi, thanks for reaching out.\n\n" +
      "I am BRɅIN, a neural engine developed using deep learning.\n\n" +
      "My creator is not online right now. Please send an email regarding your query to admin@brvin.in",
    );
  });
});
