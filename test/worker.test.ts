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

    const healthEnv = Object.assign(Object.create(testEnv), {
      DB: undefined,
      BRVIN_SERVICE: {
        getProjectStatus: async () => ({ ok: true, ready: true, authorizedSourceCount: 1 }),
      },
    }) as Env;
    const response = await worker.fetch(request, healthEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const body = (await response.json()) as {
      ok: boolean;
      status: string;
      service?: string;
      brvinRetrievalConnected: boolean;
      brvinReady: boolean;
      authorizedSources: number;
      service?: string;
      checks?: unknown;
    };

    expect(body).toEqual({
      ok: true,
      status: "healthy",
      brvinRetrievalConnected: true,
      brvinReady: true,
      authorizedSources: 1,
    });
    expect(body.service).toBeUndefined();
    expect(body.checks).toBeUndefined();
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
