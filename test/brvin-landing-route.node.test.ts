import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src";
import type { Env } from "../src/config/env";

const testEnv = env as unknown as Env;

describe("BRɅIN public landing route", () => {
  it("serves the landing page without requiring an admin session", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request("https://example.com/brvin"), testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const html = await response.text();
    expect(html).toContain("Knowledge, with its sources intact.");
    expect(html).toContain("BRɅIN trust-focused design");
  });

  it("allows only GET on the public landing route", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request("https://example.com/brvin", { method: "POST" }), testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
