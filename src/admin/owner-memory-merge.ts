/**
 * Append an Owner-reviewable Markdown section without rewriting any existing bytes.
 *
 * Each preview gets a unique marker. We deliberately never replace older sections:
 * an Owner may have edited text inside a previously generated section after saving it.
 */
export function appendOwnerMemorySection(
  existing: string,
  marker: string,
  heading: string,
  body: string,
): string {
  if (!/^[a-z0-9-]+$/iu.test(marker)) {
    throw new Error("The generated memory marker is invalid.");
  }
  const safeHeading = heading.trim();
  const safeBody = body.trim();
  if (!safeHeading) throw new Error("A generated memory section needs a heading.");
  if (!safeBody) return existing;

  const start = "<!-- " + marker + ":start -->";
  const end = "<!-- " + marker + ":end -->";
  // Treat a repeated request for the same preview as idempotent and fail safe
  // if either marker is already present, rather than risking replacement.
  if (existing.includes(start) || existing.includes(end)) return existing;

  const separator = existing.length === 0
    ? ""
    : existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return existing + separator + [
    start,
    safeHeading,
    "",
    safeBody,
    end,
    "",
  ].join("\n");
}
