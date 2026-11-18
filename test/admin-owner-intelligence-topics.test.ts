import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as workerTestBindings } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";
import worker from "../src";
import { handleAdminLogin } from "../src/admin/auth";

const ORIGIN = "https://parmar-ai.test";
function ownerEnv(owner = "owner"): Env {
  return Object.assign({}, workerTestBindings, {
    OWNER_DASHBOARD_USER: owner, OWNER_DASHBOARD_PASSWORD: "owner-test-password",
    ADMIN_DASHBOARD_USER: "admin", ADMIN_DASHBOARD_PASSWORD: "admin-test-password",
    ADMIN_SESSION_SECRET: "owner-intelligence-topic-test-secret",
  }) as Env;
}
async function login(env: Env, username = env.OWNER_DASHBOARD_USER ?? "owner"): Promise<string> {
  const loginEnv = Object.assign({}, env, { DB: undefined }) as Env;
  const body = new FormData(); body.set("username", username); body.set("password", "owner-test-password");
  const response = await handleAdminLogin(new Request(ORIGIN + "/admin/login", { method: "POST", body }), loginEnv);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(response.status).toBe(302); expect(cookie).not.toBe("");
  return cookie;
}
async function call(env: Env, path: string, cookie: string, options: { method?: string; body?: unknown } = {}): Promise<Response> {
  const headers = new Headers({ Cookie: cookie });
  if (options.body !== undefined) { headers.set("content-type", "application/json"); headers.set("Origin", ORIGIN); }
  const request = new Request(ORIGIN + path, {
    method: options.method ?? "GET", headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

describe("Owner Intelligence M4.2 Scratchpad and topics", () => {
  it("migrates an existing conversation additively without changing messages or 200K usage", async () => {
    const env = ownerEnv(); const db = env.DB!;
    const id = "a2a1e9f4-09c9-4ff2-a982-c22d17adf001"; const now = Date.now();
    await db.prepare(`CREATE TABLE IF NOT EXISTS owner_intelligence_conversations (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'New chat',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS owner_intelligence_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'complete', created_at INTEGER NOT NULL
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS owner_intelligence_session_usage (
      conversation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, token_limit INTEGER NOT NULL DEFAULT 200000,
      used_tokens INTEGER NOT NULL DEFAULT 0, reserved_tokens INTEGER NOT NULL DEFAULT 0,
      locked_reason TEXT, updated_at INTEGER NOT NULL
    )`).run();
    await db.prepare("INSERT INTO owner_intelligence_conversations (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, "owner", "Older conversation", now - 100, now).run();
    await db.prepare("INSERT INTO owner_intelligence_messages (id, conversation_id, owner_id, role, content, status, created_at) VALUES (?, ?, ?, 'user', ?, 'complete', ?)")
      .bind("a2a1e9f4-09c9-4ff2-a982-c22d17adf002", id, "owner", "Keep this original message.", now - 90).run();
    await db.prepare("INSERT INTO owner_intelligence_session_usage (conversation_id, owner_id, token_limit, used_tokens, reserved_tokens, updated_at) VALUES (?, ?, 200000, 1234, 0, ?)")
      .bind(id, "owner", now).run();

    const cookie = await login(env);
    const listed = await call(env, "/admin/api/intelligence/conversations", cookie);
    expect(listed.status).toBe(200);
    const body = await listed.json() as { conversations: Array<{ id: string; topic_id: string | null; session_kind: string; lifecycle_status: string }> };
    expect(body.conversations.find((item) => item.id === id)).toEqual(expect.objectContaining({
      topic_id: null, session_kind: "scratchpad", lifecycle_status: "active",
    }));
    const detail = await call(env, "/admin/api/intelligence/conversations/" + id, cookie);
    const detailBody = await detail.json() as {
      messages: Array<{ content: string }>; usage: { used_tokens: number; limit_tokens: number };
    };
    expect(detailBody.messages.map((message) => message.content)).toEqual(["Keep this original message."]);
    expect(detailBody.usage).toEqual(expect.objectContaining({ used_tokens: 1234, limit_tokens: 200000 }));
    const columns = await db.prepare("PRAGMA table_info(owner_intelligence_conversations)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toEqual(expect.arrayContaining(["topic_id", "session_kind", "lifecycle_status"]));
  });

  it("creates Owner topics, supports optional topic chats and defaults to Scratchpad", async () => {
    const env = ownerEnv(); const cookie = await login(env);
    const created = await call(env, "/admin/api/intelligence/topics", cookie, {
      method: "POST", body: { title: "BRɅIN Architecture" },
    });
    expect(created.status).toBe(201);
    const topic = (await created.json() as { topic: { id: string; title: string; slug: string } }).topic;
    expect(topic.title).toBe("BRɅIN Architecture");
    expect(topic.slug).toMatch(/^brain-architecture-/);

    const topics = await call(env, "/admin/api/intelligence/topics", cookie);
    expect((await topics.json() as { topics: Array<{ id: string }> }).topics.map((item) => item.id)).toContain(topic.id);

    const scratchResponse = await call(env, "/admin/api/intelligence/conversations", cookie, {
      method: "POST", body: { title: "Quick thought" },
    });
    const scratch = (await scratchResponse.json() as { conversation: { topic_id: string | null; session_kind: string; lifecycle_status: string } }).conversation;
    expect(scratch).toEqual(expect.objectContaining({ topic_id: null, session_kind: "scratchpad", lifecycle_status: "active" }));

    const topicResponse = await call(env, "/admin/api/intelligence/conversations", cookie, {
      method: "POST", body: { title: "Continue BRɅIN", topicId: topic.id },
    });
    expect(topicResponse.status).toBe(201);
    const conversation = (await topicResponse.json() as { conversation: { id: string; topic_id: string; topic_title: string; session_kind: string } }).conversation;
    expect(conversation).toEqual(expect.objectContaining({ topic_id: topic.id, topic_title: topic.title, session_kind: "topic" }));

    const renamed = await call(env, "/admin/api/intelligence/topics/" + topic.id, cookie, {
      method: "PATCH", body: { title: "BRɅIN Core" },
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json() as { topic: { title: string; slug: string } }).topic)
      .toEqual(expect.objectContaining({ title: "BRɅIN Core", slug: topic.slug }));
  });

  it("does not allow another Owner to attach a topic they do not own", async () => {
    const owner = ownerEnv(); const ownerCookie = await login(owner);
    const created = await call(owner, "/admin/api/intelligence/topics", ownerCookie, {
      method: "POST", body: { title: "Private topic" },
    });
    const topicId = (await created.json() as { topic: { id: string } }).topic.id;
    const other = ownerEnv("other-owner"); const otherCookie = await login(other, "other-owner");
    const rejected = await call(other, "/admin/api/intelligence/conversations", otherCookie, {
      method: "POST", body: { title: "Not allowed", topicId },
    });
    expect(rejected.status).toBe(400);
    expect((await rejected.json() as { message: string }).message).toContain("not available to this Owner");
  });

  it("serves Scratchpad-default and optional-topic controls to the authenticated Owner", async () => {
    const env = ownerEnv(); const cookie = await login(env);
    const response = await call(env, "/admin/intelligence.js", cookie);
    expect(response.status).toBe(200);
    const script = await response.text();
    expect(script).toContain('id="newChatTopic"');
    expect(script).toContain("Scratchpad");
    expect(script).toContain('request(api+"/topics")');
    expect(script).toContain("conversationBody.topicId");
  });
});
