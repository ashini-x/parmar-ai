import { describe, expect, it } from "vitest";
import { buildSimpleGreetingReply, isSimpleGreeting } from "../src/telegram/greetings";

describe("standalone Telegram greetings", () => {
  it.each([
    "hi",
    "Hiii!",
    "hello",
    "Hey there 👋",
    "good morning",
    "Namaste 🙏",
    "NAMASKAR!",
  ])("recognizes %s as a standalone greeting", (value) => {
    expect(isSimpleGreeting(value)).toBe(true);
  });

  it.each([
    "hi, explain the Preamble",
    "hello what is Article 21?",
    "history",
    "Hindi",
    "Hey, give me 10 MCQs",
    "/start",
    "",
  ])("does not intercept a real request: %s", (value) => {
    expect(isSimpleGreeting(value)).toBe(false);
  });

  it("uses a short English greeting for English salutations", () => {
    expect(buildSimpleGreetingReply("hi")).toContain("SSC GA/GS doubt");
  });

  it("uses the bot's Hinglish style for Namaste", () => {
    expect(buildSimpleGreetingReply("Namaste")).toContain("seedha point pe aate hain");
  });
});
