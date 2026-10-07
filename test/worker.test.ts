import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src";
import type { Env } from "../src/config/env";

const IncomingRequest = Request;
const testEnv = env as unknown as Env;

describe("Parmar AI production worker", () => {
  it("returns a healthy response", async () => {
    const request = new IncomingRequest("http://example.com/health");
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      status: string;
      checks: Record<string, boolean>;
    };

    expect(body.ok).toBe(true);
    expect(body.service).toBe("parmar-ai");
    expect(body.status).toBe("healthy");
    expect(body.checks).toBeDefined();
  });

  it("returns 404 for unknown routes", async () => {
    const request = new IncomingRequest("http://example.com/not-a-route");
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns 405 for an unsupported method", async () => {
    const request = new IncomingRequest("http://example.com/health", { method: "POST" });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
