import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const contactStart = workerSource.indexOf("function creatorContactPage()");
const contactEnd = workerSource.indexOf("\\nconst worker =", contactStart);
const contactSource = workerSource.slice(contactStart, contactEnd);

describe("Project BRɅIN contact page responsive rails", () => {
  it("uses one centered fluid rail with a maximum width on larger displays", () => {
    expect(contactSource).toContain("--content-rail-width: min(62vw, 420px)");
    expect(contactSource).toContain("width: var(--content-rail-width)");
    expect(contactSource).toContain("max-width: calc(100vw - 2 * clamp(16px, 4vw, 32px))");
    expect(contactSource).toContain("margin-inline: auto");
    expect(contactSource).toContain("overflow-x: clip");
  });

  it("keeps every content element inside the rail and makes the button/card fluid", () => {
    expect(contactSource).toContain("main > *");
    expect(contactSource).toContain("max-width: 100%");
    expect(contactSource).toContain("width: min(100%, 280px)");
    expect(contactSource).toContain("width: min(100%, 340px)");
    expect(contactSource).toContain("width: 100%");
  });

  it("reflows the avatar trust card and email row on narrow screens", () => {
    expect(contactSource).toContain("@media (max-width: 520px)");
    expect(contactSource).toContain("flex-direction: column");
    expect(contactSource).toContain("white-space: normal");
    expect(contactSource).toContain("overflow-wrap: anywhere");
    expect(contactSource).toContain("@media (max-width: 280px)");
  });

  it("preserves the requested branding, address, and restored avatar card", () => {
    expect(contactSource).toContain("<title>Project BRɅIN</title>");
    expect(contactSource).toContain("<h1>Project BRɅIN</h1>");
    expect(contactSource).toContain('const creatorEmail = "projectbrvin@gmail.com"');
    expect(contactSource).toContain('class="avatars"');
    expect(contactSource).toContain("Trusted by 115k users");
  });
});
