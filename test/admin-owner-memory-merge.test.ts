import { describe, expect, it } from "vitest";
import { appendOwnerMemorySection } from "../src/admin/owner-memory-merge";

describe("append-only Owner memory sections", () => {
  it("keeps existing Owner-authored Markdown byte-for-byte before a new section", () => {
    const ownerText = [
      "# Progress",
      "",
      "Owner-authored sentence: retain this exact wording.",
      "<!-- M4.3 external GitHub edit marker -->",
      "",
    ].join("\n");
    const result = appendOwnerMemorySection(
      ownerText,
      "owner-intelligence-gemini-progress-preview-1",
      "## Gemini-proposed update · Owner review required",
      "A newly proposed progress addition.",
    );

    expect(result.startsWith(ownerText)).toBe(true);
    expect(result).toContain("Owner-authored sentence: retain this exact wording.");
    expect(result).toContain("<!-- M4.3 external GitHub edit marker -->");
    expect(result).toContain("A newly proposed progress addition.");
  });

  it("keeps earlier generated sections and Owner edits when a later preview appends", () => {
    const first = appendOwnerMemorySection(
      "# Progress\n",
      "owner-intelligence-gemini-progress-preview-1",
      "## Gemini-proposed update · Owner review required",
      "First model suggestion.",
    );
    const ownerEdited = first.replace("First model suggestion.", "Owner edited the first suggestion; keep it.");
    const second = appendOwnerMemorySection(
      ownerEdited,
      "owner-intelligence-gemini-progress-preview-2",
      "## Gemini-proposed update · Owner review required",
      "Second model suggestion.",
    );

    expect(second.startsWith(ownerEdited)).toBe(true);
    expect(second).toContain("Owner edited the first suggestion; keep it.");
    expect(second).toContain("Second model suggestion.");
  });

  it("is idempotent for an already present preview marker", () => {
    const first = appendOwnerMemorySection(
      "# Progress\n",
      "owner-intelligence-checkpoint-conversation-preview-1",
      "## Conversation checkpoint",
      "Source-linked checkpoint.",
    );
    const edited = first.replace("Source-linked checkpoint.", "Owner edited the checkpoint.");
    const retried = appendOwnerMemorySection(
      edited,
      "owner-intelligence-checkpoint-conversation-preview-1",
      "## Conversation checkpoint",
      "Replacement text must not overwrite the Owner edit.",
    );

    expect(retried).toBe(edited);
  });

  it("does not append an empty model suggestion", () => {
    const existing = "# Progress\n\nOwner-authored content.\n";
    expect(appendOwnerMemorySection(
      existing,
      "owner-intelligence-gemini-progress-preview-3",
      "## Gemini-proposed update · Owner review required",
      "  ",
    )).toBe(existing);
  });
});
