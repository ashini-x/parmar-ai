import { describe, expect, it } from "vitest";
import { HELP_VOICE_URL, PARMAR_SIR_VOICE_URL, START_WELCOME_VOICE_URL } from "../src/telegram/voice-assets";

describe("Telegram voice asset routing", () => {
  it("keeps dedicated recordings for Help, Parmar Sir, and Start", () => {
    expect(HELP_VOICE_URL).toBe("https://raw.githubusercontent.com/ashini-x/parmar-ai/main/assets/telegram-help.ogg");
    expect(PARMAR_SIR_VOICE_URL).toBe("https://raw.githubusercontent.com/ashini-x/parmar-ai/main/assets/telegram-parmar.ogg");
    expect(START_WELCOME_VOICE_URL).toBe("https://raw.githubusercontent.com/ashini-x/parmar-ai/main/assets/telegram-welcome-20261114-v2.ogg");
    expect(new Set([HELP_VOICE_URL, PARMAR_SIR_VOICE_URL, START_WELCOME_VOICE_URL]).size).toBe(3);
  });
});
