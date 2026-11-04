import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const contactStart = workerSource.indexOf("function creatorContactPage()");
const contactEnd = workerSource.indexOf("\nconst worker =", contactStart);
const contactSource = workerSource.slice(contactStart, contactEnd);

describe("Project BRɅIN contact page shared alignment rails", () => {
  it("uses one centered, capped responsive rail for the contact page", () => {
    expect(contactSource).toContain("--content-rail-width: min(62vw, 420px)");
    expect(contactSource).toContain("width: var(--content-rail-width)");
    expect(contactSource).toContain("max-width: calc(100vw - 2 * clamp(16px, 4vw, 32px))");
    expect(contactSource).toContain("margin-inline: auto");
    expect(contactSource).toContain("overflow-x: clip");
  });

  it("aligns the trust card, heading, intro, button and expanded email card to the same rail", () => {
    expect(contactSource).toContain(".trust-badge {");
    expect(contactSource).toContain("width: 100%");
    expect(contactSource).toContain("h1 {");
    expect(contactSource).toContain("text-align: left");
    expect(contactSource).toContain(".contact-button {");
    expect(contactSource).toContain(".contact-details {");
    expect(contactSource).not.toContain("width: min(100%, 280px)");
    expect(contactSource).not.toContain("width: min(100%, 340px)");
  });

  it("preserves the original horizontal avatar card rather than stacking it on phones", () => {
    expect(contactSource).toContain('class="avatars"');
    expect(contactSource).toContain("Trusted by 115k users");
    expect(contactSource).toContain(".avatar + .avatar");
    expect(contactSource).toContain("@media (max-width: 520px)");
    expect(contactSource).toContain("width: 34px");
    expect(contactSource).not.toContain("flex-direction: column;\n        gap: 5px");
  });

  it("scales the title and protects very narrow screens and landscape layouts", () => {
    expect(contactSource).toContain("font-size: 40px");
    expect(contactSource).toContain("@media (max-width: 360px)");
    expect(contactSource).toContain("@media (max-width: 260px)");
    expect(contactSource).toContain("@media (max-height: 520px) and (orientation: landscape)");
    expect(contactSource).toContain("overflow-wrap: anywhere");
  });

  it("preserves the requested BRɅIN branding, email and existing contact interactions", () => {
    expect(contactSource).toContain("<title>Project BRɅIN</title>");
    expect(contactSource).toContain("<h1>Project BRɅIN</h1>");
    expect(contactSource).toContain('const creatorEmail = "projectbrvin@gmail.com"');
    expect(contactSource).toContain('contactToggle.addEventListener("click"');
    expect(contactSource).toContain("navigator.clipboard.writeText(email)");
    expect(contactSource).toContain("window.Telegram.WebApp.ready()");
  });
});
