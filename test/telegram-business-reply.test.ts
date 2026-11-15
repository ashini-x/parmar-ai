import { describe, expect, it } from "vitest";
import { BUSINESS_AUTO_REPLY_TEXT } from "../src/telegram/business-reply";

describe("Telegram personal-account business auto-reply", () => {
  it("uses the approved copy with a blank line between the two paragraphs", () => {
    expect(BUSINESS_AUTO_REPLY_TEXT).toBe(
      "Hi there, we've received your message and our support team will be in touch shortly.\\n\\n" +
      "For business queries, please send an email to partners@brvin.in",
    );
  });
});
