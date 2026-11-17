import { env as cloudflareEnv, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";
import worker from "../src";
import { handleAdminLogin } from "../src/admin/auth";
import { appendOwnerIntelligenceMessage } from "../src/admin/intelligence";

const baseEnv = cloudflareEnv as unknown as Env;

function appEnv(overrides: Partial<Env> = {}): Env {
  return Object.assign(Object.create(baseEnv), {
    ADMIN_DASHBOARD_USER: "admin",
    ADMIN_DASHBOARD_PASSWORD: "admin-test-password",
    OWNER_DASHBOARD_USER: "owner",
    OWNER_DASHBOARD_PASSWORD: "owner-test-password",
    ADMIN_SESSION_SECRET: "owner-intelligence-test-signing-secret",
    ...overrides,
  }) as Env;
}

async function login(username: string, password: string, env: Env): Promise<string> {
  // Login does not need D1 for session signing; keep this focused on the Owner
  // workspace database and avoid invoking unrelated application migrations.
  const loginEnv = appEnv({
    ADMIN_DASHBOARD_USER: env.ADMIN_DASHBOARD_USER,
    ADMIN_DASHBOARD_PASSWORD: env.ADMIN_DASHBOARD_PASSWORD,
    OWNER_DASHBOARD_USER: env.OWNER_DASHBOARD_USER,
    OWNER_DASHBOARD_PASSWORD: env.OWNER_DASHBOARD_PASSWORD,
    ADMIN_SESSION_SECRET: env.ADMIN_SESSION_SECRET,
    DB: undefined,
  });
  const body = new FormData();
  body.set("username", username);
  body.set("password", password);
  const response = await handleAdminLogin(new Request("https://parmar-ai.test/admin/login", {
    method: "POST",
    body,
  }), loginEnv);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(response.status).toBe(302);
  expect(cookie).not.toBe("");
  return cookie;
}

async function call(
  env: Env,
  path: string,
  cookie = "",
  options: { method?: string; body?: unknown; origin?: string } = {},
): Promise<Response> {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.origin) headers.set("Origin", options.origin);
  const request = new Request("https://parmar-ai.test" + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

describe("Owner Intelligence workspace and conversation persistence", () => {
  it("denies anonymous and ordinary admin sessions on the workspace page and API", async () => {
    const env = appEnv();
    const adminCookie = await login("admin", "admin-test-password", env);

    const anonymousPage = await call(env, "/admin/intelligence");
    const adminPage = await call(env, "/admin/intelligence", adminCookie);
    const anonymousApi = await call(env, "/admin/api/intelligence/conversations");
    const adminApi = await call(env, "/admin/api/intelligence/conversations", adminCookie);

    expect(anonymousPage.status).toBe(401);
    expect(adminPage.status).toBe(403);
    expect(anonymousApi.status).toBe(401);
    expect(adminApi.status).toBe(403);
  });

  it("renders the private responsive Owner workspace for a valid Owner session", async () => {
    const env = appEnv();
    const ownerCookie = await login("owner", "owner-test-password", env);
    const response = await call(env, "/admin/intelligence", ownerCookie);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'nonce-");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html).toContain("BRɅIN Intelligence");
    expect(html).toContain("New chat");
    expect(html).toContain("Your conversations");
    expect(html).toContain("Gemini setup · M3");
    expect(html).toContain("Gemini responses and message sending arrive in the next model milestones.");
  });

  it("creates, lists, reopens, renames and deletes only the Owner's conversations and messages", async () => {
    const env = appEnv();
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";

    const badOrigin = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST",
      body: { title: "Blocked request" },
    });
    expect(badOrigin.status).toBe(403);

    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST",
      origin,
      body: { title: "Research notes" },
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { ok: boolean; conversation: { id: string; title: string } };
    expect(createdBody.ok).toBe(true);
    expect(createdBody.conversation.title).toBe("Research notes");

    const id = createdBody.conversation.id;
    const savedMessage = await appendOwnerIntelligenceMessage(env, {
      conversationId: id,
      role: "user",
      content: "Explain the relationship between eigenvalues and stability.",
    });
    expect(savedMessage?.role).toBe("user");

    const list = await call(env, "/admin/api/intelligence/conversations", ownerCookie);
    const listBody = await list.json() as { conversations: Array<{ id: string; title: string }> };
    expect(list.status).toBe(200);
    expect(listBody.conversations.some((item) => item.id === id && item.title === "Research notes")).toBe(true);

    const reopened = await call(env, "/admin/api/intelligence/conversations/" + id, ownerCookie);
    const reopenedBody = await reopened.json() as { conversation: { id: string }; messages: Array<{ content: string; role: string }> };
    expect(reopened.status).toBe(200);
    expect(reopenedBody.conversation.id).toBe(id);
    expect(reopenedBody.messages).toHaveLength(1);
    expect(reopenedBody.messages[0].content).toBe("Explain the relationship between eigenvalues and stability.");

    const renamed = await call(env, "/admin/api/intelligence/conversations/" + id, ownerCookie, {
      method: "PATCH",
      origin,
      body: { title: "Linear algebra research" },
    });
    const renamedBody = await renamed.json() as { conversation: { title: string } };
    expect(renamed.status).toBe(200);
    expect(renamedBody.conversation.title).toBe("Linear algebra research");

    const otherOwnerEnv = appEnv({
      OWNER_DASHBOARD_USER: "different-owner",
      OWNER_DASHBOARD_PASSWORD: "different-owner-password",
    });
    const otherOwnerCookie = await login("different-owner", "different-owner-password", otherOwnerEnv);
    const otherOwnerList = await call(otherOwnerEnv, "/admin/api/intelligence/conversations", otherOwnerCookie);
    const otherOwnerListBody = await otherOwnerList.json() as { conversations: Array<{ id: string }> };
    const crossOwnerRead = await call(otherOwnerEnv, "/admin/api/intelligence/conversations/" + id, otherOwnerCookie);
    expect(otherOwnerListBody.conversations.some((item) => item.id === id)).toBe(false);
    expect(crossOwnerRead.status).toBe(404);

    const deleted = await call(env, "/admin/api/intelligence/conversations/" + id, ownerCookie, {
      method: "DELETE",
      origin,
    });
    expect(deleted.status).toBe(200);
    const afterDelete = await call(env, "/admin/api/intelligence/conversations/" + id, ownerCookie);
    expect(afterDelete.status).toBe(404);

    const messageRows = await env.DB!.prepare(
      "SELECT id FROM owner_intelligence_messages WHERE conversation_id = ?",
    ).bind(id).all<{ id: string }>();
    expect(messageRows.results ?? []).toHaveLength(0);
  });

  it("rejects invalid titles and does not reveal conversations owned by another principal", async () => {
    const env = appEnv();
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";

    const invalid = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST",
      origin,
      body: { title: "   " },
    });
    expect(invalid.status).toBe(400);

    const missing = await call(env, "/admin/api/intelligence/conversations/not-a-uuid", ownerCookie);
    expect(missing.status).toBe(404);
  });
});
