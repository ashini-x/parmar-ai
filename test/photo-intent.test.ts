import { describe, expect, it } from "vitest";
import { getCaptionedPhotoQuestion, PHOTO_CAPTION_REQUIRED_TEXT } from "../src/telegram/photo-intent";

describe("Telegram photo intent", () => {
  it("does not invent a question for a captionless photo or album", () => {
    expect(getCaptionedPhotoQuestion([])).toBeNull();
    expect(getCaptionedPhotoQuestion([""])).toBeNull();
    expect(getCaptionedPhotoQuestion(["   ", "\t"])).toBeNull();
  });

  it("uses the first non-empty caption in a Telegram album", () => {
    expect(getCaptionedPhotoQuestion(["", "  Solve question 4  ", "Explain the diagram"])).toBe("Solve question 4");
  });

  it("asks the student to specify the task and gives practical examples", () => {
    expect(PHOTO_CAPTION_REQUIRED_TEXT).toContain("question ke caption ke saath dobara bhejo");
    expect(PHOTO_CAPTION_REQUIRED_TEXT).toContain("Is question ko solve karo");
    expect(PHOTO_CAPTION_REQUIRED_TEXT).toContain("main task guess nahi karunga");
  });
});
