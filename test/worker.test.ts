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
        getProjectStatusV2: async () => ({ ok: true, data: { projectId: "fatman", ready: true, authorizedSourceCount: 1 } }),
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
      brvinRetrievalConnected: boolean;
      brvinReady: boolean;
      authorizedSources: number;
      brvinV2Connected: boolean;
      brvinV2Ready: boolean;
      brvinV2AuthorizedSources: number;
      service?: string;
      checks?: unknown;
    };

    expect(body).toEqual({
      ok: true,
      status: "healthy",
      brvinRetrievalConnected: true,
      brvinReady: true,
      authorizedSources: 1,
      brvinV2Connected: true,
      brvinV2Ready: true,
      brvinV2AuthorizedSources: 1,
    });
    expect(body.service).toBeUndefined();
    expect(body.checks).toBeUndefined();
  });
  it("fails health when BRVIN is reachable but Fatman has no authorized sources", async () => {
    const request = new IncomingRequest("http://example.com/health");
    const ctx = createExecutionContext();
    const healthEnv = Object.assign(Object.create(testEnv), {
      DB: undefined,
      BRVIN_SERVICE: {
        getProjectStatus: async () => ({ ok: true, ready: false, authorizedSourceCount: 0 }),
        getProjectStatusV2: async () => ({ ok: true, data: { projectId: "fatman", ready: false, authorizedSourceCount: 0 } }),
      },
    }) as Env;
    const response = await worker.fetch(request, healthEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      status: "degraded",
      brvinRetrievalConnected: true,
      brvinReady: false,
      authorizedSources: 0,
      brvinV2Connected: true,
      brvinV2Ready: false,
      brvinV2AuthorizedSources: 0,
    });
  });

  it("fails health when BRVIN client registration is unavailable", async () => {
    const request = new IncomingRequest("http://example.com/health");
    const ctx = createExecutionContext();
    const healthEnv = Object.assign(Object.create(testEnv), {
      DB: undefined,
      BRVIN_SERVICE: {
        getProjectStatus: async () => ({ ok: false, code: "CLIENT_NOT_REGISTERED", message: "Not registered.", retryable: false }),
        getProjectStatusV2: async () => ({ ok: false, code: "ENVIRONMENT_NOT_REGISTERED", message: "Not registered.", retryable: false }),
      },
    }) as Env;
    const response = await worker.fetch(request, healthEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      status: "degraded",
      brvinRetrievalConnected: false,
      brvinReady: false,
      authorizedSources: 0,
      brvinV2Connected: false,
      brvinV2Ready: false,
      brvinV2AuthorizedSources: 0,
    });
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
