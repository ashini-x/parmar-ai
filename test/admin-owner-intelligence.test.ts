import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/config/env";
import worker from "../src";
import { handleAdminLogin } from "../src/admin/auth";
import { appendOwnerIntelligenceMessage } from "../src/admin/intelligence";

type ConversationRow = {
  id: string;
  owner_id: string;
  title: string;
  created_at: number;
  updated_at: number;
};
type MessageRow = {
  id: string;
  conversation_id: string;
  owner_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "pending" | "complete" | "partial" | "error";
  created_at: number;
};

class FakeOwnerStatement {
  private values: unknown[] = [];
  constructor(private readonly db: FakeOwnerD1, private readonly sql: string) {}
  bind(...values: unknown[]): this { this.values = values; return this; }
  async run(): Promise<{ success: boolean }> { this.db.execute(this.sql, this.values); return { success: true }; }
  async first<T>(): Promise<T | null> { return (this.db.read(this.sql, this.values)[0] as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.db.read(this.sql, this.values) as T[], success: true };
  }
}

class FakeOwnerD1 {
  readonly conversations = new Map<string, ConversationRow>();
  readonly messages = new Map<string, MessageRow>();
  prepare(sql: string): D1PreparedStatement {
    return new FakeOwnerStatement(this, sql) as unknown as D1PreparedStatement;
  }
  async batch(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean }>> {
    for (const statement of statements as unknown as FakeOwnerStatement[]) {
      const internal = statement as unknown as { sql: string; values: unknown[] };
      this.execute(internal.sql, internal.values);
    }
    return statements.map(() => ({ success: true }));
  }
  read(sql: string, values: unknown[]): Array<Record<string, unknown>> {
    if (sql.includes("FROM owner_intelligence_conversations")) {
      if (sql.includes("WHERE id = ? AND owner_id = ?")) {
        const row = this.conversations.get(String(values[0]));
        return row && row.owner_id === String(values[1]) ? [{ ...row }] : [];
      }
      if (sql.includes("WHERE owner_id = ?")) {
        return [...this.conversations.values()]
          .filter((row) => row.owner_id === String(values[0]))
          .sort((a, b) => b.updated_at - a.updated_at || b.created_at - a.created_at)
          .slice(0, Number(values[1] ?? 100))
          .map((row) => ({ ...row }));
      }
    }
    if (sql.includes("FROM owner_intelligence_messages")) {
      return [...this.messages.values()]
        .filter((row) => row.conversation_id === String(values[0]) && row.owner_id === String(values[1]))
        .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
        .map((row) => ({ ...row }));
    }
    throw new Error("Unexpected Owner D1 read: " + sql);
  }
  execute(sql: string, values: unknown[]): void {
    if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) return;
    if (sql.startsWith("INSERT INTO owner_intelligence_conversations")) {
      const [id, owner_id, title, created_at, updated_at] = values;
      this.conversations.set(String(id), {
        id: String(id), owner_id: String(owner_id), title: String(title),
        created_at: Number(created_at), updated_at: Number(updated_at),
      });
      return;
    }
    if (sql.startsWith("UPDATE owner_intelligence_conversations SET title")) {
      const [title, updated_at, id, owner_id] = values;
      const row = this.conversations.get(String(id));
      if (row && row.owner_id === String(owner_id)) {
        row.title = String(title); row.updated_at = Number(updated_at);
      }
      return;
    }
    if (sql.startsWith("UPDATE owner_intelligence_conversations SET updated_at")) {
      const [updated_at, id, owner_id] = values;
      const row = this.conversations.get(String(id));
      if (row && row.owner_id === String(owner_id)) row.updated_at = Number(updated_at);
      return;
    }
    if (sql.startsWith("INSERT INTO owner_intelligence_messages")) {
      const [id, conversation_id, owner_id, role, content, status, created_at] = values;
      this.messages.set(String(id), {
        id: String(id), conversation_id: String(conversation_id), owner_id: String(owner_id),
        role: role as MessageRow["role"], content: String(content), status: status as MessageRow["status"],
        created_at: Number(created_at),
      });
      return;
    }
    if (sql.startsWith("DELETE FROM owner_intelligence_messages")) {
      const [conversation_id, owner_id] = values;
      for (const [id, row] of this.messages) {
        if (row.conversation_id === String(conversation_id) && row.owner_id === String(owner_id)) this.messages.delete(id);
      }
      return;
    }
    if (sql.startsWith("DELETE FROM owner_intelligence_conversations")) {
      const [id, owner_id] = values;
      const row = this.conversations.get(String(id));
      if (row && row.owner_id === String(owner_id)) this.conversations.delete(String(id));
      return;
    }
    throw new Error("Unexpected Owner D1 write: " + sql);
  }
}

function appEnv(overrides: Partial<Env> = {}, database = new FakeOwnerD1()): Env {
  return Object.assign({}, {
    DB: database as unknown as Env["DB"],
    ADMIN_DASHBOARD_USER: "admin",
    ADMIN_DASHBOARD_PASSWORD: "admin-test-password",
    OWNER_DASHBOARD_USER: "owner",
    OWNER_DASHBOARD_PASSWORD: "owner-test-password",
    ADMIN_SESSION_SECRET: "owner-intelligence-test-signing-secret",
  }, overrides) as Env;
}

async function login(username: string, password: string, env: Env): Promise<string> {
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
    }, env.DB as unknown as FakeOwnerD1);
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
