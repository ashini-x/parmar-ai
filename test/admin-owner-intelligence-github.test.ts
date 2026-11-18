import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as workerTestBindings } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";
import worker from "../src";
import { handleAdminLogin } from "../src/admin/auth";

const ORIGIN = "https://parmar-ai.test";

function ownerEnv(owner = "owner-github-m43"): Env {
  return Object.assign({}, workerTestBindings, {
    OWNER_DASHBOARD_USER: owner,
    OWNER_DASHBOARD_PASSWORD: "owner-test-password",
    ADMIN_DASHBOARD_USER: "admin",
    ADMIN_DASHBOARD_PASSWORD: "admin-test-password",
    ADMIN_SESSION_SECRET: "owner-intelligence-github-test-secret",
  }) as Env;
}

async function login(env: Env, username: string, password: string): Promise<string> {
  const loginEnv = Object.assign({}, env, { DB: undefined }) as Env;
  const form = new FormData();
  form.set("username", username);
  form.set("password", password);
  const response = await handleAdminLogin(new Request(ORIGIN + "/admin/login", { method: "POST", body: form }), loginEnv);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(response.status).toBe(302);
  expect(cookie).not.toBe("");
  return cookie;
}

async function call(
  env: Env,
  path: string,
  cookie?: string,
  options: { method?: string; body?: unknown; origin?: string } = {},
): Promise<Response> {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.origin !== null) headers.set("Origin", options.origin ?? ORIGIN);
  const request = new Request(ORIGIN + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

describe("Owner Intelligence M4.3 GitHub authorization", () => {
  it("keeps GitHub status and setup behind the Owner session", async () => {
    const env = ownerEnv();
    const anonymous = await call(env, "/admin/api/intelligence/github/status");
    expect(anonymous.status).toBe(401);

    const adminCookie = await login(env, "admin", "admin-test-password");
    const nonOwner = await call(env, "/admin/api/intelligence/github/status", adminCookie);
    expect(nonOwner.status).toBe(403);

    const ownerCookie = await login(env, "owner-github-m43", "owner-test-password");
    const status = await call(env, "/admin/api/intelligence/github/status", ownerCookie);
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ ok: true, github: { status: "not_connected", installed: false } });
  });

  it("requires same-origin mutation and returns a dedicated least-privilege App manifest", async () => {
    const env = ownerEnv();
    const cookie = await login(env, "owner-github-m43", "owner-test-password");

    const crossOrigin = await call(env, "/admin/api/intelligence/github/start", cookie, {
      method: "POST",
      body: {},
      origin: "https://attacker.example",
    });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toEqual({ ok: false, error: "same_origin_required" });

    const started = await call(env, "/admin/api/intelligence/github/start", cookie, {
      method: "POST",
      body: {},
    });
    expect(started.status).toBe(200);
    const result = await started.json() as {
      action: string;
      manifest: {
        name: string;
        public: boolean;
        default_permissions: Record<string, string>;
        default_events: unknown[];
        redirect_url: string;
        setup_url: string;
      };
    };
    expect(result.action).toMatch(/^https:\/\/github\.com\/settings\/apps\/new\?state=/u);
    expect(result.manifest.name).toBe("Owner Gemini Intelligence");
    expect(result.manifest.public).toBe(false);
    expect(result.manifest.default_permissions).toEqual({ metadata: "read", contents: "write" });
    expect(result.manifest.default_events).toEqual([]);
    expect(result.manifest.redirect_url).toBe(ORIGIN + "/admin/intelligence/github/callback");
    expect(result.manifest.setup_url).toMatch(/^https:\/\/parmar-ai\.test\/admin\/intelligence\/github\/setup\?state=/u);

    const stateRows = await env.DB!.prepare("SELECT COUNT(*) AS count FROM owner_intelligence_github_states WHERE owner_id=?")
      .bind("owner-github-m43").first<{ count: number }>();
    expect(stateRows?.count).toBe(2);
  });

  it("shows the save flow only inside the authenticated Owner workspace", async () => {
    const env = ownerEnv();
    const anonymous = await call(env, "/admin/intelligence");
    expect(anonymous.status).toBe(401);

    const cookie = await login(env, "owner-github-m43", "owner-test-password");
    const page = await call(env, "/admin/intelligence", cookie);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="saveToGitHub"');
    expect(html).toContain('id="githubDialog"');
    expect(html).toContain("Confirm and save to GitHub");

    const script = await call(env, "/admin/intelligence.js", cookie);
    expect(script.status).toBe(200);
    const javascript = await script.text();
    expect(javascript).toContain("openGitHubDialog");
    expect(javascript).toContain("createGitHubPreview");
    expect(javascript).toContain("confirmGitHubSave");
  });
});
