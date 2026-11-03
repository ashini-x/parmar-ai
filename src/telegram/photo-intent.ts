/**
 * Resolve a single task caption for a Telegram photo album.
 * Telegram attaches an album caption to one item only, so any non-empty
 * caption in the group is sufficient. Never invent a task for a blank album.
 */
export function getCaptionedPhotoQuestion(captions: readonly string[]): string | null {
  return captions.map((caption) => String(caption ?? "").trim()).find(Boolean) ?? null;
}

export const PHOTO_CAPTION_REQUIRED_TEXT = [
  "📸 Photos mil gaye.",
  "",
  "In photos mein kis cheez ki help chahiye? Photo/album ko ek short question ke caption ke saath dobara bhejo, jaise:",
  "• “Is question ko solve karo”",
  "• “Is diagram ko samjhao”",
  "• “Image ka text padho”",
  "",
  "Bina sawaal ke main task guess nahi karunga. 🙂",
].join("\n");
