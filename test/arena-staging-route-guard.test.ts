import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";
import worker from "../src/index";

const stagingEnv = { ENVIRONMENT: "staging" } as Env;
const context = {} as ExecutionContext;

describe("Arena staging Worker route isolation", () => {
  it("exposes the admin login route", async () => {
    const response = await worker.fetch(
      new Request("https://arena-staging.example.workers.dev/admin/login"),
      stagingEnv,
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Private operations dashboard");
  });

  it.each([
    "/",
    "/health",
    "/contact",
    "/telegram/setup",
    "/telegram/webhook",
    "/brvin/connection-probe",
  ])("does not expose non-admin route %s in staging", async (path) => {
    const response = await worker.fetch(
      new Request("https://arena-staging.example.workers.dev" + path, {
        method: path.includes("webhook") || path.includes("setup") ? "POST" : "GET",
      }),
      stagingEnv,
      context,
    );

    expect(response.status).toBe(404);
  });
});
