import { describe, expect, it } from "vitest";
import { HELP_VOICE_URL, START_WELCOME_VOICE_URL } from "../src/telegram/voice-assets";

describe("Telegram voice asset routing", () => {
  it("uses the dedicated recording for Help without changing the Start/Parmar Sir recording", () => {
    expect(HELP_VOICE_URL).toBe("https://raw.githubusercontent.com/ashini-x/parmar-ai/main/assets/telegram-help.ogg");
    expect(START_WELCOME_VOICE_URL).toBe("https://raw.githubusercontent.com/ashini-x/parmar-ai/main/assets/telegram-welcome.ogg");
    expect(HELP_VOICE_URL).not.toBe(START_WELCOME_VOICE_URL);
  });
});
