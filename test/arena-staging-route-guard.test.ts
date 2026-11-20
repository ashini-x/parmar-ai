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

  it("requires admin auth and same-origin requests to reset cooldowns, and rejects production", async () => {
    const env = {
      ENVIRONMENT: "staging",
      ADMIN_DASHBOARD_USER: "arena-admin",
      ADMIN_DASHBOARD_PASSWORD: "arena-test-password",
      ADMIN_SESSION_SECRET: "arena-test-session-secret",
    } as Env;
    const origin = "https://arena-staging.example.workers.dev";
    const login = await worker.fetch(
      new Request(origin + "/admin/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "arena-admin", password: "arena-test-password" }),
      }),
      env,
      context,
    );
    expect(login.status).toBe(302);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toContain("parmar_admin_session=");

    const unauthenticated = await worker.fetch(
      new Request(origin + "/admin/api/arena/reset-breakers", {
        method: "POST",
        headers: { Origin: origin },
      }),
      env,
      context,
    );
    expect(unauthenticated.status).toBe(401);

    const wrongOrigin = await worker.fetch(
      new Request(origin + "/admin/api/arena/reset-breakers", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://attacker.example" },
      }),
      env,
      context,
    );
    expect(wrongOrigin.status).toBe(403);
    expect(await wrongOrigin.json()).toMatchObject({ ok: false, error: "csrf_origin_rejected" });

    const accepted = await worker.fetch(
      new Request(origin + "/admin/api/arena/reset-breakers", {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin },
      }),
      env,
      context,
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true, clearedCount: 0 });

    const productionEnv = { ...env, ENVIRONMENT: "production" } as Env;
    const productionResponse = await worker.fetch(
      new Request(origin + "/admin/api/arena/reset-breakers", {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin },
      }),
      productionEnv,
      context,
    );
    expect(productionResponse.status).toBe(404);
  });


  it("protects on-demand judging with admin auth, same-origin and staging-only checks", async () => {
    const env = {
      ENVIRONMENT: "staging",
      ADMIN_DASHBOARD_USER: "arena-admin",
      ADMIN_DASHBOARD_PASSWORD: "arena-test-password",
      ADMIN_SESSION_SECRET: "arena-test-session-secret",
    } as Env;
    const origin = "https://arena-staging.example.workers.dev";
    const login = await worker.fetch(
      new Request(origin + "/admin/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "arena-admin", password: "arena-test-password" }),
      }),
      env,
      context,
    );
    expect(login.status).toBe(302);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

    const payload = {
      question: "What does Article 17 of the Constitution abolish?",
      recentConversation: [],
      leftPacket: {
        responseMode: "text",
        answer: "Article 17 abolishes untouchability.",
        sscTakeaway: "Article 17 abolishes untouchability.",
        answerScope: "ssc_ga_gs",
      },
      rightPacket: null,
    };

    const unauthenticated = await worker.fetch(
      new Request(origin + "/admin/api/arena/judge", {
        method: "POST",
        headers: { "content-type": "application/json", Origin: origin },
        body: JSON.stringify(payload),
      }),
      env,
      context,
    );
    expect(unauthenticated.status).toBe(401);

    const wrongOrigin = await worker.fetch(
      new Request(origin + "/admin/api/arena/judge", {
        method: "POST",
        headers: { "content-type": "application/json", Cookie: cookie, Origin: "https://attacker.example" },
        body: JSON.stringify(payload),
      }),
      env,
      context,
    );
    expect(wrongOrigin.status).toBe(403);
    expect(await wrongOrigin.json()).toMatchObject({ ok: false, error: "csrf_origin_rejected" });

    const accepted = await worker.fetch(
      new Request(origin + "/admin/api/arena/judge", {
        method: "POST",
        headers: { "content-type": "application/json", Cookie: cookie, Origin: origin },
        body: JSON.stringify(payload),
      }),
      env,
      context,
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      ok: true,
      judge: { mode: "availability_only", winner: "left" },
      persistence: "stateless",
    });
    expect(env.DB).toBeUndefined();

    const productionEnv = { ...env, ENVIRONMENT: "production" } as Env;
    const productionResponse = await worker.fetch(
      new Request(origin + "/admin/api/arena/judge", {
        method: "POST",
        headers: { "content-type": "application/json", Cookie: cookie, Origin: origin },
        body: JSON.stringify(payload),
      }),
      productionEnv,
      context,
    );
    expect(productionResponse.status).toBe(404);
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
