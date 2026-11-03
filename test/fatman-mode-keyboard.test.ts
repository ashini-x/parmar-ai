import { describe, expect, it } from "vitest";
import { buildFatmanModeMarkup } from "../src/telegram/api";

describe("Fatman Telegram keyboard", () => {
  it("always exposes separate enter and exit actions", () => {
    expect(buildFatmanModeMarkup(false).inline_keyboard).toEqual([[
      { text: "Enter Fatman", callback_data: "fatman:enter" },
      { text: "Exit Fatman", callback_data: "fatman:exit" },
    ]]);
  });

  it("shows the active state while keeping Exit Fatman available", () => {
    expect(buildFatmanModeMarkup(true).inline_keyboard[0]).toEqual([
      { text: "Fatman ON ✓", callback_data: "fatman:enter" },
      { text: "Exit Fatman", callback_data: "fatman:exit" },
    ]);
  });
});
