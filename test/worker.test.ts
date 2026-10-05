import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src";

const IncomingRequest = Request;

describe("Parmar AI production worker", () => {
  it("returns a healthy response", async () => {
    const request = new IncomingRequest("http://example.com/health");
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      phase: string;
    };

    expect(body.ok).toBe(true);
    expect(body.service).toBe("parmar-ai");
    expect(body.phase).toBe("D");
  });

  it("returns 404 for unknown routes", async () => {
    const request = new IncomingRequest("http://example.com/not-a-route");
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns 405 for an unsupported method", async () => {
    const request = new IncomingRequest("http://example.com/health", {
      method: "POST",
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
