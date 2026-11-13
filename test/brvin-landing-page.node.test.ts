import { describe, expect, it } from "vitest";
import { brvinLandingPage } from "../src/brvin/landing";

describe("BRɅIN public landing page", () => {
  it("renders the brand, focused trust badge and product sections", async () => {
    const response = brvinLandingPage();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<title>BRɅIN — Knowledge, with its sources intact</title>");
    expect(html).toContain("BRɅIN trust-focused design");
    expect(html).toContain("not a third-party security certification");
    expect(html).toContain("Permission checks first");
    expect(html).toContain("Source readiness");
    expect(html).toContain("Revocable access");
    expect(html).toContain("/admin/brvin");
    expect(html).not.toContain("ElevenLabs");
  });
});
