import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as workerTestBindings } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import worker from "../src";
import { handleAdminLogin } from "../src/admin/auth";

const ORIGIN = "https://parmar-ai.test";
function ownerEnv(): Env {
  return Object.assign({}, workerTestBindings, {
    OWNER_DASHBOARD_USER: "owner",
    OWNER_DASHBOARD_PASSWORD: "owner-test-password",
    ADMIN_DASHBOARD_USER: "admin",
    ADMIN_DASHBOARD_PASSWORD: "admin-test-password",
    ADMIN_SESSION_SECRET: "owner-intelligence-github-test-secret-".padEnd(64, "x"),
  }) as Env;
}
async function login(env: Env): Promise<string> {
  const loginEnv = Object.assign({}, env, { DB: undefined }) as Env;
  const form = new FormData();
  form.set("username", "owner");
  form.set("password", "owner-test-password");
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
  options: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    headers.set("Origin", ORIGIN);
  }
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
async function appPrivateKey(): Promise<string> {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  return "-----BEGIN PRIVATE KEY-----\n" + btoa(binary) + "\n-----END PRIVATE KEY-----";
}

describe("Owner Intelligence M4.3 GitHub App authorization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers a dedicated private App with only metadata read and contents write", async () => {
    const env = ownerEnv();
    const cookie = await login(env);
    const response = await call(env, "/admin/api/intelligence/github/app/manifest", cookie, { method: "POST", body: {} });
    expect(response.status).toBe(200);
    const body = await response.json() as { actionUrl: string; manifest: {
      name: string; public: boolean; default_permissions: Record<string, string>;
      default_events: string[]; setup_url: string; callback_urls: string[];
    } };
    expect(body.manifest).toMatchObject({
      name: "BRɅIN Owner Memory",
      public: false,
      default_permissions: { metadata: "read", contents: "write" },
      default_events: [],
      setup_url: ORIGIN + "/admin/api/intelligence/github/callback",
      callback_urls: [ORIGIN + "/admin/api/intelligence/github/callback"],
    });
    expect(Object.keys(body.manifest.default_permissions).sort()).toEqual(["contents", "metadata"]);
    expect(new URL(body.actionUrl).origin).toBe("https://github.com");
    expect(new URL(body.actionUrl).pathname).toBe("/settings/apps/new");
    expect(new URL(body.actionUrl).searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const noOrigin = await call(env, "/admin/api/intelligence/github/app/manifest", undefined, { method: "POST", body: {} });
    expect(noOrigin.status).toBe(401);
  });

  it("verifies the installing GitHub user with PKCE before accepting an installation, then scopes repository tokens", async () => {
    const env = ownerEnv();
    const cookie = await login(env);
    const privateKey = await appPrivateKey();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url.startsWith("https://api.github.com/app-manifests/") && method === "POST") {
        return new Response(JSON.stringify({
          id: 987654,
          slug: "brvin-owner-memory",
          name: "BRɅIN Owner Memory",
          pem: privateKey,
          client_id: "Iv1.owner-memory-test",
          client_secret: "github-app-client-secret-test",
          permissions: { metadata: "read", contents: "write" },
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url === "https://github.com/login/oauth/access_token" && method === "POST") {
        const form = new URLSearchParams(String(init?.body || ""));
        expect(form.get("client_id")).toBe("Iv1.owner-memory-test");
        expect(form.get("client_secret")).toBe("github-app-client-secret-test");
        expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{80,}$/);
        return new Response(JSON.stringify({ access_token: "temporary-user-token" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.github.com/user") {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer temporary-user-token");
        return new Response(JSON.stringify({ id: 42, login: "owner" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.github.com/user/installations?per_page=100&page=1") {
        return new Response(JSON.stringify({ installations: [{
          id: 555, app_id: 987654, account: { login: "owner", type: "User" },
          repository_selection: "selected", permissions: { metadata: "read", contents: "write" },
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.github.com/app/installations/555/access_tokens" && method === "POST") {
        const body = JSON.parse(String(init?.body || "{}")) as { repository_ids?: number[]; permissions?: Record<string, string> };
        expect(body).toEqual({ permissions: { contents: "write" }, repository_ids: [222] });
        return new Response(JSON.stringify({ token: "short-lived-installation-token", expires_at: "2026-11-18T23:00:00Z" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.github.com/installation/repositories?per_page=100&page=1") {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer short-lived-installation-token");
        return new Response(JSON.stringify({ repositories: [{
          id: 222, full_name: "owner/private-repo", private: true, archived: false, default_branch: "main",
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.github.com/repos/owner/private-repo") {
        return new Response(JSON.stringify({ id: 222, full_name: "owner/private-repo", archived: false }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.github.com/repos/owner/private-repo/branches/main") {
        return new Response(JSON.stringify({ name: "main" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: "unexpected request" }), { status: 500, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const start = await call(env, "/admin/api/intelligence/github/app/manifest", cookie, { method: "POST", body: {} });
    const startBody = await start.json() as { actionUrl: string };
    const manifestState = new URL(startBody.actionUrl).searchParams.get("state")!;
    const manifestCallback = await call(env, "/admin/api/intelligence/github/callback?code=manifest-code&state=" + encodeURIComponent(manifestState));
    expect(manifestCallback.status).toBe(200);
    expect(await manifestCallback.text()).toContain("/admin/intelligence?github=app-created");

    const statusAfterCreate = await call(env, "/admin/api/intelligence/github/status", cookie);
    expect((await statusAfterCreate.json() as { configured: boolean; authorized: boolean }))
      .toEqual({ ok: true, configured: true, authorized: false, app: expect.any(Object), installations: [] });

    const install = await call(env, "/admin/api/intelligence/github/install", cookie, { method: "POST", body: {} });
    const installBody = await install.json() as { installationUrl: string };
    expect(installBody.installationUrl).toContain("https://github.com/apps/brvin-owner-memory/installations/new?state=");
    const installationState = new URL(installBody.installationUrl).searchParams.get("state")!;

    const setupCallback = await call(env, "/admin/api/intelligence/github/callback?installation_id=555&setup_action=install&state=" + encodeURIComponent(installationState));
    expect(setupCallback.status).toBe(303);
    const authorizeUrl = new URL(setupCallback.headers.get("location")!);
    expect(authorizeUrl.origin).toBe("https://github.com");
    expect(authorizeUrl.pathname).toBe("/login/oauth/authorize");
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The setup_url installation_id is not persisted as trusted before user authorization.
    const statusBeforeUserVerification = await call(env, "/admin/api/intelligence/github/status", cookie);
    expect((await statusBeforeUserVerification.json() as { installations: unknown[] }).installations).toHaveLength(0);

    const userCallback = await call(env, "/admin/api/intelligence/github/callback?code=user-auth-code&state=" + encodeURIComponent(authorizeUrl.searchParams.get("state")!));
    expect(userCallback.status).toBe(200);
    expect(await userCallback.text()).toContain("/admin/intelligence?github=installed");

    const status = await call(env, "/admin/api/intelligence/github/status", cookie);
    const statusBody = await status.json() as { authorized: boolean; installations: Array<{ id: number; account: string; authorizedUser: string }> };
    expect(statusBody.authorized).toBe(true);
    expect(statusBody.installations).toEqual([expect.objectContaining({ id: 555, account: "owner", authorizedUser: "owner" })]);

    const repositories = await call(env, "/admin/api/intelligence/github/installations/555/repositories", cookie);
    expect(repositories.status).toBe(200);
    expect((await repositories.json() as { repositories: Array<{ id: number; fullName: string; private: boolean }> }).repositories)
      .toEqual([expect.objectContaining({ id: 222, fullName: "owner/private-repo", private: true })]);

    const topicResponse = await call(env, "/admin/api/intelligence/topics", cookie, { method: "POST", body: { title: "BRɅIN Memory" } });
    const topicId = (await topicResponse.json() as { topic: { id: string } }).topic.id;
    const attached = await call(env, "/admin/api/intelligence/github/topics/" + topicId + "/repository", cookie, {
      method: "PATCH",
      body: { installationId: 555, repositoryId: 222, repositoryFullName: "owner/private-repo", branch: "main", memoryRoot: "memory" },
    });
    expect(attached.status).toBe(200);
    expect((await attached.json() as { repository: string; branch: string; memoryRoot: string }))
      .toEqual(expect.objectContaining({ repository: "owner/private-repo", branch: "main", memoryRoot: "memory" }));

    // User access tokens are used only for verification and are never written into the Owner D1 tables.
    const columns = await env.DB!.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='owner_intelligence_github_installations'").first<{ sql: string }>();
    expect(columns?.sql).not.toContain("access_token");
    expect(fetchMock.mock.calls.some(call => String(call[0]) === "https://api.github.com/user")).toBe(true);
  });

  it("rejects cross-origin mutations and never accepts a forged setup installation without a verified user token", async () => {
    const env = ownerEnv();
    const cookie = await login(env);
    const headers = new Headers({ Cookie: cookie, "content-type": "application/json", Origin: "https://evil.example" });
    const forged = await worker.fetch(new Request(ORIGIN + "/admin/api/intelligence/github/install", {
      method: "POST", headers, body: "{}",
    }), env);
    expect(forged.status).toBe(403);
  });
});
