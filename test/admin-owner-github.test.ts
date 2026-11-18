import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as workerTestBindings } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import worker from "../src";
import { handleAdminLogin } from "../src/admin/auth";

const ORIGIN = "https://parmar-ai.test";
const CALLBACK = "/admin/api/intelligence/github/callback";

function ownerEnv(owner = "owner-github-test"): Env {
  return Object.assign({}, workerTestBindings, {
    OWNER_DASHBOARD_USER: owner,
    OWNER_DASHBOARD_PASSWORD: "owner-test-password",
    ADMIN_DASHBOARD_USER: "admin",
    ADMIN_DASHBOARD_PASSWORD: "admin-test-password",
    ADMIN_SESSION_SECRET: "owner-github-test-session-secret-0123456789abcdef",
  }) as Env;
}
async function login(env: Env): Promise<string> {
  const loginEnv = Object.assign({}, env, { DB: undefined }) as Env;
  const body = new FormData();
  body.set("username", env.OWNER_DASHBOARD_USER ?? "owner-github-test");
  body.set("password", "owner-test-password");
  const response = await handleAdminLogin(new Request(ORIGIN + "/admin/login", { method: "POST", body }), loginEnv);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(response.status).toBe(302);
  expect(cookie).not.toBe("");
  return cookie;
}
async function call(
  env: Env,
  path: string,
  cookie: string,
  options: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers({ Cookie: cookie });
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    headers.set("Origin", ORIGIN);
  }
  const request = new Request(ORIGIN + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}
function pemFromDer(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary).match(/.{1,64}/gu)?.join("\n") ?? "";
  return "-----BEGIN PRIVATE KEY-----\n" + base64 + "\n-----END PRIVATE KEY-----";
}

describe("Owner Intelligence M4.3 GitHub App authorization", () => {
  it("creates a least-privilege App, verifies a selected installation with PKCE, and attaches a repository to an Owner topic", async () => {
    const env = ownerEnv();
    const cookie = await login(env);
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const privateKey = pemFromDer(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)));
    const appId = 52_001;
    const installationId = 77_001;
    const repositoryId = 88_001;
    const tokenRequests: Array<{ path: string; body: Record<string, unknown> }> = [];

    const githubFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      if (url === "https://api.github.com/app-manifests/manifest-code/conversions" && method === "POST") {
        return new Response(JSON.stringify({
          id: appId,
          slug: "brain-owner-memory",
          name: "BRɅIN Owner Memory",
          pem: privateKey,
          client_id: "Iv1.owner-memory-client",
          client_secret: "owner-memory-client-secret",
          permissions: { metadata: "read", contents: "write" },
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url === "https://github.com/login/oauth/access_token" && method === "POST") {
        const form = new URLSearchParams(String(init?.body ?? ""));
        expect(form.get("client_id")).toBe("Iv1.owner-memory-client");
        expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{80,}$/u);
        return new Response(JSON.stringify({ access_token: "ghu-temporary-user-token", token_type: "bearer" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://api.github.com/user") {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ghu-temporary-user-token");
        return new Response(JSON.stringify({ id: 9001, login: "owner-github-test" }), { status: 200 });
      }
      if (url === "https://api.github.com/user/installations?per_page=100&page=1") {
        return new Response(JSON.stringify({ installations: [{
          id: installationId,
          app_id: appId,
          account: { login: "ashini-x", type: "User" },
          repository_selection: "selected",
          permissions: { metadata: "read", contents: "write" },
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.github.com/app/installations/" + installationId + "/access_tokens" && method === "POST") {
        tokenRequests.push({ path: url, body });
        return new Response(JSON.stringify({ token: "ghs-short-lived-installation-token" }), { status: 201 });
      }
      if (url === "https://api.github.com/installation/repositories?per_page=100&page=1") {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ghs-short-lived-installation-token");
        return new Response(JSON.stringify({ repositories: [{
          id: repositoryId,
          full_name: "ashini-x/parmar-ai",
          private: true,
          archived: false,
          default_branch: "main",
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.github.com/repos/ashini-x/parmar-ai") {
        return new Response(JSON.stringify({
          id: repositoryId, full_name: "ashini-x/parmar-ai", archived: false,
        }), { status: 200 });
      }
      if (url === "https://api.github.com/repos/ashini-x/parmar-ai/branches/feature/test-branch") {
        return new Response(JSON.stringify({ name: "feature/test-branch" }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "Unexpected GitHub request: " + method + " " + url }), {
        status: 500, headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", githubFetch);

    const manifestStart = await call(env, "/admin/api/intelligence/github/app/manifest", cookie, {
      method: "POST", body: {},
    });
    expect(manifestStart.status).toBe(200);
    const manifestResult = await manifestStart.json() as {
      actionUrl: string;
      manifest: { public: boolean; setup_url: string; default_permissions: Record<string, string> };
    };
    expect(manifestResult.manifest.public).toBe(false);
    expect(manifestResult.manifest.default_permissions).toEqual({ metadata: "read", contents: "write" });
    expect(manifestResult.manifest.setup_url).toBe(ORIGIN + "/admin/api/intelligence/github/setup");
    expect(manifestResult.actionUrl).toContain("https://github.com/settings/apps/new?state=");

    const manifestState = new URL(manifestResult.actionUrl).searchParams.get("state");
    expect(manifestState).toBeTruthy();
    const manifestCallback = await call(env, CALLBACK + "?code=manifest-code&state=" + encodeURIComponent(manifestState!), cookie);
    expect(manifestCallback.status).toBe(303);
    expect(manifestCallback.headers.get("location")).toBe("/admin/intelligence?github=app-created");

    const replay = await call(env, CALLBACK + "?code=manifest-code&state=" + encodeURIComponent(manifestState!), cookie);
    expect(replay.headers.get("location")).toBe("/admin/intelligence?github=error");

    const appRow = await env.DB!.prepare(
      "SELECT app_id, app_slug, secret_ciphertext, status FROM owner_intelligence_github_app WHERE owner_id=?",
    ).bind("owner-github-test").first<{ app_id: number; app_slug: string; secret_ciphertext: string; status: string }>();
    expect(appRow).toBeTruthy();
    expect(appRow?.app_id).toBe(appId);
    expect(appRow?.app_slug).toBe("brain-owner-memory");
    expect(appRow?.status).toBe("created");
    expect(appRow?.secret_ciphertext).not.toContain(privateKey);
    expect(appRow?.secret_ciphertext).not.toContain("owner-memory-client-secret");

    const installStart = await call(env, "/admin/api/intelligence/github/install", cookie, { method: "POST", body: {} });
    expect(installStart.status).toBe(200);
    const installBody = await installStart.json() as { installationUrl: string };
    expect(installBody.installationUrl).toContain("https://github.com/apps/brain-owner-memory/installations/new?state=");
    const installationState = new URL(installBody.installationUrl).searchParams.get("state");

    const installationCallback = await call(
      env,
      "/admin/api/intelligence/github/setup?installation_id=" + installationId + "&setup_action=install&state=" + encodeURIComponent(installationState ?? ""),
      cookie,
    );
    expect(installationCallback.status).toBe(303);
    const authorizeUrl = new URL(installationCallback.headers.get("location") ?? "");
    expect(authorizeUrl.origin).toBe("https://github.com");
    expect(authorizeUrl.pathname).toBe("/login/oauth/authorize");
    expect(authorizeUrl.searchParams.get("client_id")).toBe("Iv1.owner-memory-client");
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const authorizationState = authorizeUrl.searchParams.get("state");
    expect(authorizationState).toBeTruthy();

    const authorized = await call(env, CALLBACK + "?code=user-code&state=" + encodeURIComponent(authorizationState!), cookie);
    expect(authorized.status).toBe(303);
    expect(authorized.headers.get("location")).toBe("/admin/intelligence?github=installed");

    const installationRow = await env.DB!.prepare(
      "SELECT installation_id, account_login, authorized_user, status FROM owner_intelligence_github_installations WHERE owner_id=? AND installation_id=?",
    ).bind("owner-github-test", installationId).first<{
      installation_id: number; account_login: string; authorized_user: string; status: string;
    }>();
    expect(installationRow).toEqual(expect.objectContaining({
      installation_id: installationId,
      account_login: "ashini-x",
      authorized_user: "owner-github-test",
      status: "active",
    }));

    const status = await call(env, "/admin/api/intelligence/github/status", cookie);
    const statusBody = await status.json() as { configured: boolean; app: { appId: number }; installations: Array<{ id: number }> };
    expect(statusBody.configured).toBe(true);
    expect(statusBody.app.appId).toBe(appId);
    expect(statusBody.installations).toEqual(expect.arrayContaining([expect.objectContaining({ id: installationId })]));
    expect(JSON.stringify(statusBody)).not.toContain("owner-memory-client-secret");
    expect(JSON.stringify(statusBody)).not.toContain("ghu-temporary-user-token");

    const repositories = await call(
      env,
      "/admin/api/intelligence/github/installations/" + installationId + "/repositories",
      cookie,
    );
    expect(repositories.status).toBe(200);
    const repositoryBody = await repositories.json() as { repositories: Array<{ id: number; fullName: string; private: boolean }> };
    expect(repositoryBody.repositories).toEqual([
      expect.objectContaining({ id: repositoryId, fullName: "ashini-x/parmar-ai", private: true }),
    ]);
    expect(tokenRequests[0].body.permissions).toEqual({ contents: "read" });

    const topicResponse = await call(env, "/admin/api/intelligence/topics", cookie, {
      method: "POST", body: { title: "BRɅIN" },
    });
    expect(topicResponse.status).toBe(201);
    const topic = (await topicResponse.json() as { topic: { id: string } }).topic;
    const attached = await call(env, "/admin/api/intelligence/github/topics/" + topic.id + "/repository", cookie, {
      method: "PATCH",
      body: {
        installationId,
        repositoryId,
        repositoryFullName: "ashini-x/parmar-ai",
        branch: "feature/test-branch",
        memoryRoot: "memory",
      },
    });
    expect(attached.status).toBe(200);
    const attachedBody = await attached.json() as { repository: string; branch: string; memoryRoot: string };
    expect(attachedBody).toEqual(expect.objectContaining({
      repository: "ashini-x/parmar-ai",
      branch: "feature/test-branch",
      memoryRoot: "memory",
    }));
    expect(tokenRequests[1].body.repository_ids).toEqual([repositoryId]);
    expect(tokenRequests[1].body.permissions).toEqual({ contents: "read" });

    const topicRow = await env.DB!.prepare(
      "SELECT github_installation_id, repository_id, repository_owner, repository_name, repository_branch, memory_root FROM owner_intelligence_topics WHERE id=? AND owner_id=?",
    ).bind(topic.id, "owner-github-test").first<Record<string, unknown>>();
    expect(topicRow).toEqual(expect.objectContaining({
      github_installation_id: installationId,
      repository_id: repositoryId,
      repository_owner: "ashini-x",
      repository_name: "parmar-ai",
      repository_branch: "feature/test-branch",
      memory_root: "memory",
    }));

    const page = await call(env, "/admin/intelligence", cookie);
    const html = await page.text();
    expect(html).toContain('id="githubConnect"');
    expect(html).toContain('id="githubAttachTopic"');
    const script = await call(env, "/admin/intelligence.js", cookie);
    expect(await script.text()).toContain('request("/admin/api/intelligence/github/app/manifest"');
  });

  it("rejects a cross-site App setup mutation and keeps GitHub APIs Owner-only", async () => {
    const env = ownerEnv("owner-github-csrf-test");
    const cookie = await login(env);
    const csrf = await call(env, "/admin/api/intelligence/github/app/manifest", cookie, {
      method: "POST", body: {},
    });
    // The shared helper supplies the trusted Origin; use a direct request to prove the guard rejects another origin.
    const request = new Request(ORIGIN + "/admin/api/intelligence/github/app/manifest", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    const context = createExecutionContext();
    const rejected = await worker.fetch(request, env, context);
    await waitOnExecutionContext(context);
    expect(rejected.status).toBe(403);
    expect(csrf.status).toBe(200);

    const nonOwner = ownerEnv("different-owner");
    const nonOwnerCookie = await login(nonOwner);
    const topic = "5f4c5aa9-6f75-4d09-9dc4-1c6bdc9d5b00";
    const forbidden = await call(nonOwner, "/admin/api/intelligence/github/topics/" + topic + "/repository", nonOwnerCookie, {
      method: "PATCH",
      body: { installationId: 77, repositoryId: 88, repositoryFullName: "someone/repo", branch: "main", memoryRoot: "memory" },
    });
    expect(forbidden.status).toBe(404);
  });
});
