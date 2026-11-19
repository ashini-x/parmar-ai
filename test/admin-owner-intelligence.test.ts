import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as workerTestBindings } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";
import worker from "../src";
import { handleAdminLogin } from "../src/admin/auth";
import {
  buildOwnerGeminiConversationContents,
  getOwnerIntelligenceSessionUsage,
  OWNER_INTELLIGENCE_SESSION_TOKEN_LIMIT,
  OWNER_INTELLIGENCE_RESPONSE_STYLE_INSTRUCTION,
  type OwnerIntelligenceMessage,
} from "../src/admin/intelligence";
import { countOwnerGeminiInputTokens, openOwnerGeminiStream } from "../src/admin/intelligence-provider";

vi.mock("../src/admin/intelligence-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admin/intelligence-provider")>();
  return {
    ...actual,
    countOwnerGeminiInputTokens: vi.fn(actual.countOwnerGeminiInputTokens),
    openOwnerGeminiStream: vi.fn(actual.openOwnerGeminiStream),
  };
});

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

type GenerationMetadataRow = {
  message_id: string;
  owner_id: string;
  model_id: string;
  thinking_level: string;
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
  elapsed_ms: number;
};

type SessionUsageRow = {
  conversation_id: string;
  owner_id: string;
  token_limit: number;
  used_tokens: number;
  reserved_tokens: number;
  locked_reason: string | null;
  updated_at: number;
};
type ReservationRow = {
  reservation_id: string;
  conversation_id: string;
  owner_id: string;
  reserved_tokens: number;
  status: "reserved" | "settled" | "released" | "expired";
  actual_tokens: number;
  usage_is_estimated: number;
  created_at: number;
  settled_at: number | null;
};

class FakeOwnerStatement {
  private values: unknown[] = [];
  constructor(private readonly db: FakeOwnerD1, private readonly sql: string) {}
  bind(...values: unknown[]): this { this.values = values; return this; }
  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    const changes = this.db.execute(this.sql, this.values);
    return { success: true, meta: { changes } };
  }
  async first<T>(): Promise<T | null> { return (this.db.read(this.sql, this.values)[0] as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.db.read(this.sql, this.values) as T[], success: true };
  }
}

class FakeOwnerD1 {
  readonly conversations = new Map<string, ConversationRow>();
  readonly messages = new Map<string, MessageRow>();
  readonly generationMetadata = new Map<string, GenerationMetadataRow>();
  readonly sessionUsage = new Map<string, SessionUsageRow>();
  readonly reservations = new Map<string, ReservationRow>();
  prepare(sql: string): D1PreparedStatement {
    return new FakeOwnerStatement(this, sql) as unknown as D1PreparedStatement;
  }
  async batch(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean; meta: { changes: number } }>> {
    const results: Array<{ success: boolean; meta: { changes: number } }> = [];
    let previousChanges = 0;
    for (const statement of statements as unknown as FakeOwnerStatement[]) {
      const internal = statement as unknown as { sql: string; values: unknown[] };
      previousChanges = this.execute(internal.sql, internal.values, previousChanges);
      results.push({ success: true, meta: { changes: previousChanges } });
    }
    return results;
  }
  read(sql: string, values: unknown[]): Array<Record<string, unknown>> {
    if (sql.startsWith("PRAGMA table_info(owner_intelligence_conversations)")) {
      return ["id", "owner_id", "title", "created_at", "updated_at", "topic_id", "session_kind", "lifecycle_status", "cross_project_memory_enabled", "parent_conversation_id", "rollover_handoff_id"]
        .map((name) => ({ name }));
    }
    if (sql.includes("FROM owner_intelligence_handoffs") && sql.includes("successor_conversation_id=?")) return [];
    if (sql.includes("FROM owner_intelligence_conversation_memory_snapshots")) return [];
    if (sql.includes("cross_project_memory_enabled")) {
      const row = this.conversations.get(String(values[0]));
      return row && row.owner_id === String(values[1]) ? [{ cross_project_memory_enabled: 0 }] : [];
    }
    if (sql.includes("FROM owner_intelligence_session_usage")) {
      const row = this.sessionUsage.get(String(values[0]));
      return row && row.owner_id === String(values[1]) ? [{ ...row }] : [];
    }
    if (sql.includes("FROM owner_intelligence_token_reservations")) {
      if (sql.includes("WHERE reservation_id = ?")) {
        const row = this.reservations.get(String(values[0]));
        return row && row.conversation_id === String(values[1]) && row.owner_id === String(values[2]) &&
          row.status === "reserved" ? [{ reserved_tokens: row.reserved_tokens }] : [];
      }
      return [...this.reservations.values()]
        .filter((row) => row.conversation_id === String(values[0]) && row.owner_id === String(values[1]) &&
          row.status === "reserved" && row.created_at <= Number(values[2]))
        .map((row) => ({ reservation_id: row.reservation_id, reserved_tokens: row.reserved_tokens }));
    }
    if (sql.includes("MAX(created_at)")) {
      const latest = [...this.messages.values()]
        .filter((row) => row.conversation_id === String(values[0]) && row.owner_id === String(values[1]))
        .reduce((max, row) => Math.max(max, row.created_at), 0);
      return [{ latest: latest || null }];
    }
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
      const source = sql.includes("WHERE m.id = ?")
        ? [...this.messages.values()].filter((row) => row.id === String(values[0]) && row.owner_id === String(values[1]))
        : [...this.messages.values()].filter((row) => row.conversation_id === String(values[0]) && row.owner_id === String(values[1]));
      return source
        .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
        .map((row) => ({ ...row, ...(this.generationMetadata.get(row.id) ?? {}) }));
    }
    throw new Error("Unexpected Owner D1 read: " + sql);
  }
  execute(sql: string, values: unknown[], previousChanges = 0): number {
    if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX") || sql.startsWith("CREATE UNIQUE INDEX") || sql.startsWith("ALTER TABLE owner_intelligence_conversations")) return 0;
    if (sql.startsWith("INSERT OR IGNORE INTO owner_intelligence_session_usage")) {
      const [limit, updatedAt, conversationId, ownerId] = values;
      const conversation = this.conversations.get(String(conversationId));
      if (!conversation || conversation.owner_id !== String(ownerId) || this.sessionUsage.has(String(conversationId))) return 0;
      const used = [...this.messages.values()]
        .filter((message) => message.conversation_id === String(conversationId) &&
          message.owner_id === String(ownerId) && message.role === "assistant")
        .reduce((sum, message) => sum + Number(this.generationMetadata.get(message.id)?.total_tokens ?? 0), 0);
      this.sessionUsage.set(String(conversationId), {
        conversation_id: String(conversationId), owner_id: String(ownerId), token_limit: Number(limit),
        used_tokens: used, reserved_tokens: 0, locked_reason: null, updated_at: Number(updatedAt),
      });
      return 1;
    }
    if (sql.includes("UPDATE owner_intelligence_session_usage") &&
        sql.includes("SET reserved_tokens = reserved_tokens +")) {
      const [reserved, updatedAt, conversationId, ownerId, requested] = values;
      const row = this.sessionUsage.get(String(conversationId));
      if (!row || row.owner_id !== String(ownerId) || row.reserved_tokens !== 0 ||
          row.used_tokens + row.reserved_tokens + Number(requested) > row.token_limit || row.locked_reason) return 0;
      row.reserved_tokens += Number(reserved); row.updated_at = Number(updatedAt);
      return 1;
    }
    if (sql.includes("UPDATE owner_intelligence_session_usage") &&
        sql.includes("SET used_tokens = used_tokens +")) {
      const [charge, reserved, updatedAt, conversationId, ownerId] = values;
      const row = this.sessionUsage.get(String(conversationId));
      if (!row || row.owner_id !== String(ownerId)) return 0;
      row.used_tokens += Number(charge);
      row.reserved_tokens = Math.max(0, row.reserved_tokens - Number(reserved));
      row.updated_at = Number(updatedAt);
      return 1;
    }
    if (sql.startsWith("UPDATE owner_intelligence_session_usage SET locked_reason")) {
      const [reason, updatedAt, conversationId, ownerId] = values;
      const row = this.sessionUsage.get(String(conversationId));
      if (!row || row.owner_id !== String(ownerId) || row.locked_reason) return 0;
      row.locked_reason = String(reason); row.updated_at = Number(updatedAt);
      return 1;
    }
    if (sql.startsWith("INSERT INTO owner_intelligence_token_reservations")) {
      if (previousChanges !== 1) return 0;
      const [reservationId, conversationId, ownerId, reservedTokens, createdAt] = values;
      this.reservations.set(String(reservationId), {
        reservation_id: String(reservationId), conversation_id: String(conversationId), owner_id: String(ownerId),
        reserved_tokens: Number(reservedTokens), status: "reserved", actual_tokens: 0,
        usage_is_estimated: 0, created_at: Number(createdAt), settled_at: null,
      });
      return 1;
    }
    if (sql.startsWith("UPDATE owner_intelligence_token_reservations SET status = 'expired'")) {
      const [settledAt, conversationId, ownerId, cutoff] = values;
      let changes = 0;
      for (const row of this.reservations.values()) {
        if (row.conversation_id === String(conversationId) && row.owner_id === String(ownerId) &&
            row.status === "reserved" && row.created_at <= Number(cutoff)) {
          row.status = "expired"; row.actual_tokens = row.reserved_tokens;
          row.usage_is_estimated = 1; row.settled_at = Number(settledAt); changes += 1;
        }
      }
      return changes;
    }
    if (sql.includes("UPDATE owner_intelligence_token_reservations") &&
        sql.includes("SET status = ?")) {
      const [status, actualTokens, estimated, settledAt, reservationId, conversationId, ownerId] = values;
      const row = this.reservations.get(String(reservationId));
      if (!row || row.conversation_id !== String(conversationId) || row.owner_id !== String(ownerId) || row.status !== "reserved") return 0;
      row.status = status as ReservationRow["status"];
      row.actual_tokens = Number(actualTokens); row.usage_is_estimated = Number(estimated);
      row.settled_at = Number(settledAt);
      return 1;
    }
    if (sql.startsWith("INSERT INTO owner_intelligence_generation_metadata")) {
      const [message_id, owner_id, model_id, thinking_level] = values;
      this.generationMetadata.set(String(message_id), {
        message_id: String(message_id), owner_id: String(owner_id), model_id: String(model_id),
        thinking_level: String(thinking_level), prompt_tokens: 0, output_tokens: 0, total_tokens: 0, elapsed_ms: 0,
      });
      return 1;
    }
    if (sql.startsWith("UPDATE owner_intelligence_generation_metadata")) {
      const [prompt_tokens, output_tokens, total_tokens, elapsed_ms, message_id, owner_id] = values;
      const row = this.generationMetadata.get(String(message_id));
      if (row && row.owner_id === String(owner_id)) {
        row.prompt_tokens = Number(prompt_tokens); row.output_tokens = Number(output_tokens);
        row.total_tokens = Number(total_tokens); row.elapsed_ms = Number(elapsed_ms);
        return 1;
      }
      return 0;
    }
    if (sql.startsWith("UPDATE owner_intelligence_messages SET content = ?, status = ?")) {
      const [content, status, id, owner_id] = values;
      const row = this.messages.get(String(id));
      if (row && row.owner_id === String(owner_id) && row.role === "assistant") {
        row.content = String(content); row.status = status as MessageRow["status"];
        return 1;
      }
      return 0;
    }
    if (sql.startsWith("UPDATE owner_intelligence_messages SET content = ?, status = 'complete'")) {
      const [content, id, owner_id] = values;
      const row = this.messages.get(String(id));
      if (row && row.owner_id === String(owner_id) && row.role === "user") {
        row.content = String(content); row.status = "complete";
        return 1;
      }
      return 0;
    }
    if (sql.startsWith("INSERT INTO owner_intelligence_conversations")) {
      const [id, owner_id, title, created_at, updated_at] = values;
      this.conversations.set(String(id), {
        id: String(id), owner_id: String(owner_id), title: String(title),
        created_at: Number(created_at), updated_at: Number(updated_at),
      });
      return 1;
    }
    if (sql.startsWith("UPDATE owner_intelligence_conversations SET title")) {
      const [title, updated_at, id, owner_id] = values;
      const row = this.conversations.get(String(id));
      if (row && row.owner_id === String(owner_id)) {
        row.title = String(title); row.updated_at = Number(updated_at);
        return 1;
      }
      return 0;
    }
    if (sql.startsWith("UPDATE owner_intelligence_conversations SET updated_at")) {
      const [updated_at, id, owner_id] = values;
      const row = this.conversations.get(String(id));
      if (row && row.owner_id === String(owner_id)) {
        row.updated_at = Number(updated_at);
        return 1;
      }
      return 0;
    }
    if (sql.startsWith("INSERT INTO owner_intelligence_messages")) {
      const [id, conversation_id, owner_id, role, content, status, created_at] = values;
      this.messages.set(String(id), {
        id: String(id), conversation_id: String(conversation_id), owner_id: String(owner_id),
        role: role as MessageRow["role"], content: String(content), status: status as MessageRow["status"],
        created_at: Number(created_at),
      });
      return 1;
    }
    if (sql.startsWith("DELETE FROM owner_intelligence_messages WHERE id = ?")) {
      const [id, owner_id] = values;
      const row = this.messages.get(String(id));
      if (row && row.owner_id === String(owner_id)) {
        this.messages.delete(String(id));
        this.generationMetadata.delete(String(id));
        return 1;
      }
      return 0;
    }
    if (sql.startsWith("DELETE FROM owner_intelligence_messages")) {
      const [conversation_id, owner_id] = values;
      let changes = 0;
      for (const [id, row] of this.messages) {
        if (row.conversation_id === String(conversation_id) && row.owner_id === String(owner_id)) {
          this.messages.delete(id); this.generationMetadata.delete(id); changes += 1;
        }
      }
      return changes;
    }
    if (sql.startsWith("DELETE FROM owner_intelligence_conversations")) {
      const [id, owner_id] = values;
      const row = this.conversations.get(String(id));
      if (row && row.owner_id === String(owner_id)) {
        this.conversations.delete(String(id));
        this.sessionUsage.delete(String(id));
        for (const [reservationId, reservation] of this.reservations) {
          if (reservation.conversation_id === String(id) && reservation.owner_id === String(owner_id)) this.reservations.delete(reservationId);
        }
        return 1;
      }
      return 0;
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

describe("Owner Gemini conversation context builder", () => {
  it("omits failed and empty assistant rows and merges adjacent user turns after a failed generation", () => {
    const messages: OwnerIntelligenceMessage[] = [
      { id: "1", conversation_id: "c", role: "user", content: "Earlier question", status: "complete", created_at: 1 },
      { id: "2", conversation_id: "c", role: "assistant", content: "Earlier answer", status: "complete", created_at: 2 },
      { id: "3", conversation_id: "c", role: "user", content: "Can you see what we were discussing?", status: "complete", created_at: 3 },
      { id: "4", conversation_id: "c", role: "assistant", content: "", status: "error", created_at: 4 },
      { id: "5", conversation_id: "c", role: "user", content: "I am retrying with another model.", status: "complete", created_at: 5 },
      { id: "6", conversation_id: "c", role: "assistant", content: "", status: "pending", created_at: 6 },
    ];

    expect(buildOwnerGeminiConversationContents(messages)).toEqual([
      { role: "user", text: "Earlier question" },
      { role: "model", text: "Earlier answer" },
      { role: "user", text: "Can you see what we were discussing?\n\nI am retrying with another model." },
    ]);
  });

  it("keeps the newest valid user-led suffix within the context budget without deleting stored history", () => {
    const messages: OwnerIntelligenceMessage[] = [];
    for (let index = 0; index < 20; index += 1) {
      messages.push({
        id: "u" + index, conversation_id: "c", role: "user",
        content: "U".repeat(25_000) + index, status: "complete", created_at: index * 2 + 1,
      });
      messages.push({
        id: "a" + index, conversation_id: "c", role: "assistant",
        content: "A".repeat(25_000) + index, status: "complete", created_at: index * 2 + 2,
      });
    }
    messages.push({
      id: "latest", conversation_id: "c", role: "user",
      content: "Newest prompt must remain.", status: "complete", created_at: 99,
    });
    const contents = buildOwnerGeminiConversationContents(messages);
    expect(contents[0]?.role).toBe("user");
    expect(contents[contents.length - 1]).toEqual({ role: "user", text: "Newest prompt must remain." });
    expect(contents.length).toBeLessThanOrEqual(49);
    expect(contents.every((turn, index) => turn.text.length > 0 && turn.text.length <= 300_000 &&
      (index === 0 || turn.role !== contents[index - 1].role))).toBe(true);
    expect(contents.reduce((total, turn) => total + turn.text.length, 0)).toBeLessThanOrEqual(300_000);
    expect(messages).toHaveLength(41);
  });
});

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
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html).not.toContain('class="topbar"');
    expect(html).not.toContain('class="avatar"');
    expect(html).toContain("New chat");
    expect(html).toContain("Your conversations");
    expect(html).toContain('id="bottomDock"');
    expect(html).toContain('id="sessionBudget"');
    expect(html).toContain("SESSION TOKENS");
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("brain-universal");
    expect(html).not.toContain("/admin/intelligence-fonts/");
    expect(html).not.toContain("Poppins");
    expect(html).toContain('font-family:"OpenAI Sans",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif');
    expect(response.headers.get("content-security-policy")).toContain("font-src 'self'");
    expect(html).not.toContain('Welcome back Sir.');
    expect(html).toContain('<p class="welcome-tagline">INTELLIGENCE · WELCOME BACK</p>');
    expect(html).toContain('<div class="welcome"><div class="welcome-brand" aria-label="BRɅIN"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7197 1446"');
    expect(html).not.toContain('viewBox="0 0 3470 1446"');
    expect(html).toContain('<header class="sidebar-header"><div class="brand"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7197 1446"');
    expect(html).not.toContain('class="brand-mark"');
    expect(html).not.toContain('class="brand-sub"');
    expect(html).not.toContain("INTELLIGENCE · PRIVATE");
    expect(html).toContain('.welcome-brand svg{display:block;width:clamp(230px,34vw,320px);height:auto}');
    expect(html).toContain('.welcome .welcome-tagline{display:block;width:clamp(230px,34vw,320px);font-size:9px;font-weight:300;letter-spacing:.16em;line-height:1.25;color:#858585;text-transform:uppercase;text-align:left;margin:0}');
    expect(html).not.toContain('.welcome h1{');
    expect(html).not.toContain('.welcome-mark{');
    expect(html).toContain('.sidebar-header{flex:0 0 auto;padding:7px 8px 24px}');
    expect(html).toContain('.brand svg{display:block;width:120px;height:auto}');
    expect(html).not.toContain(".welcome-brand::after");
    expect(html).toContain('linearGradient id="owner-intelligence-wordmark-fill"');
    expect(html).not.toContain("Your thinking space.");
    expect(html).not.toContain("A private workspace for research");
    expect(html).not.toContain("PRIVATE OWNER WORKSPACE");
    expect(html).not.toContain('class="welcome-mark"');
    expect(html).not.toContain('class="next-step"');
    expect(html).toContain("200,000 left");
    expect(html).not.toContain('id="sessionBudget" hidden');
    expect(html).toContain('id="messageInput" disabled rows="1" placeholder="Write a message…"');
    expect(html).not.toContain('maxlength="50000"');
    expect(html).toContain(".messages{flex:1;min-height:0;overflow-y:auto");
    expect(html).toContain(".bottom-dock{flex:0 0 auto;width:min(820px,calc(100% - 44px));margin:0 auto;padding:4px 0 10px;background:transparent}");
    expect(html).toContain("background:#000;color:#ededed");
    expect(html).toContain(":root{background:#000;color:#ededed}");
    expect(html).toContain(".app,.main,.content,.stage,.messages{background:#000}");
    expect(html).toContain(".sidebar{background:#050505;border-right-color:#191919}");
    expect(html).toContain(".message-user .message-body{flex:0 1 min(78%,660px);width:min(78%,660px);min-width:min(240px,100%);max-width:min(78%,660px);background:#191919;border-color:#303030;overflow-wrap:anywhere}");
    expect(html).toContain(".user-message-content.is-collapsed{max-height:112px;overflow:hidden;position:relative}");
    expect(html).toContain(".user-message-content{white-space:pre-wrap!important;overflow-wrap:anywhere;line-height:1.65}");
    expect(html).toContain("background:linear-gradient(180deg,rgba(25,25,25,0),#191919)");
    expect(html).toContain(".user-message-toggle[hidden]{display:none}");

    expect(html).toContain(".message-user .message-body{flex:0 1 min(78%,660px);width:min(78%,660px);min-width:min(240px,100%);max-width:min(78%,660px);background:#191919;border-color:#303030;overflow-wrap:anywhere}");
    expect(html).toContain("body{overflow:hidden;background:#000}");
    expect(html).toContain(".sidebar{width:292px;flex:0 0 292px;background:#141414;");
    expect(html).toContain(".composer textarea{display:block;width:100%;resize:none;min-height:34px;max-height:144px;overflow-y:auto");
    const dockStart = html.indexOf('<div class="bottom-dock" id="bottomDock">');
    const composerStart = html.indexOf('<textarea id="messageInput"');
    const messagesStart = html.indexOf('<div class="messages" id="messages"');
    expect(dockStart).toBeGreaterThan(messagesStart);
    expect(composerStart).toBeGreaterThan(dockStart);
    expect(html).toContain('<div class="sidebar-scroll" id="sidebarScroll">');
    expect(html).toContain("width:292px;flex:0 0 292px");
    expect(html).toContain("overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#343434 transparent");
    expect(html).toContain(".sidebar-scroll::-webkit-scrollbar{width:6px}");
    expect(html).toContain("width:min(320px,88vw)");
    const sidebarHeaderStart = html.indexOf('<header class="sidebar-header">');
    const sidebarHeaderEnd = html.indexOf("</header>", sidebarHeaderStart);
    const scrollRegionStart = html.indexOf('<div class="sidebar-scroll" id="sidebarScroll">');
    const newChatStart = html.indexOf('<button class="new-chat"', scrollRegionStart);
    expect(sidebarHeaderStart).toBeGreaterThanOrEqual(0);
    expect(sidebarHeaderEnd).toBeGreaterThan(sidebarHeaderStart);
    expect(scrollRegionStart).toBeGreaterThan(sidebarHeaderEnd);
    expect(html.indexOf('<div class="brand">', scrollRegionStart)).toBe(-1);
    expect(newChatStart).toBeGreaterThan(scrollRegionStart);
    const footerStart = html.indexOf('<div class="side-footer">');
    const scrollRegionEnd = html.indexOf('</div>\n  <div class="side-footer">', scrollRegionStart);
    expect(scrollRegionStart).toBeGreaterThanOrEqual(0);
    expect(scrollRegionEnd).toBeGreaterThan(scrollRegionStart);
    expect(footerStart).toBeGreaterThan(scrollRegionEnd);
    expect(html).toContain('id="modelSelect"');
    expect(html).toContain('id="modelRetry"');
    expect(html).toContain('id="thinkingSelect"');
    expect(html).not.toContain('id="composerHint"');
    expect(html).toContain('<div class="composer-controls">');
    const composerControlsStart = html.indexOf('<div class="composer-controls">');
    const composerBottomStart = html.indexOf('<div class="composer-bottom">');
    const modelChooserStart = html.indexOf('<label class="model-picker">', composerControlsStart);
    const thinkingChooserStart = html.indexOf('<label class="thinking-picker">', composerControlsStart);
    const menuButtonStart = html.indexOf('id="mobileMenu"', composerControlsStart);
    expect(composerControlsStart).toBeGreaterThan(composerBottomStart);
    expect(menuButtonStart).toBeGreaterThan(composerControlsStart);
    expect(modelChooserStart).toBeGreaterThan(menuButtonStart);
    expect(thinkingChooserStart).toBeGreaterThan(modelChooserStart);
    expect(html.indexOf('<header class="topbar">')).toBe(-1);
    expect(html).toContain("Responses stream from your selected model.");
    expect(html).toContain(".message-assistant .message-body{background:transparent;border:0;border-radius:0;padding:0;box-shadow:none}");
    expect(html).toContain(".md-table-card");
    expect(html).toContain(".md-callout-success");
    expect(html).toContain(".md-callout-danger");
    expect(html).toContain('<script src="/admin/intelligence.js" defer></script>');
    expect(html).not.toContain("<script nonce=");
  });

  it("serves the Owner workspace JavaScript as a protected same-origin asset", async () => {
    const env = appEnv();
    const adminCookie = await login("admin", "admin-test-password", env);
    const ownerCookie = await login("owner", "owner-test-password", env);

    expect((await call(env, "/admin/intelligence.js")).status).toBe(401);
    expect((await call(env, "/admin/intelligence.js", adminCookie)).status).toBe(403);

    const response = await call(env, "/admin/intelligence.js", ownerCookie);
    const script = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(script).toContain("/admin/api/intelligence/models");
    expect(script).toContain('document.getElementById("newChat").addEventListener');
    expect(script).toContain("The Owner workspace request timed out");
    expect(script).toContain("Could not load conversations");
    expect(script).toContain("appendActivityCard");
    expect(script).toContain("welcomeBrand.appendChild(buildOwnerWordmarkSvgNode())");
    expect(script).toContain('var ownerWordmarkGlyphs = [{');
    expect(script).toContain('document.createElementNS(ns,"svg")');
    expect(script).toContain('viewBox","0 0 7197 1446"');
    expect(script).not.toContain(".innerHTML");
    expect(script).not.toContain('Welcome back Sir.');
    expect(script).toContain('node("p","welcome-tagline","INTELLIGENCE · WELCOME BACK")');
    expect(script).not.toContain('What are we hunting today?');
    expect(script).not.toContain("Your thinking space.");
    expect(script).not.toContain("PRIVATE OWNER WORKSPACE");
    expect(script).toContain("function renderRichMarkdown(target,markdown)");
    expect(script).toContain("var expandedUserMessageIds=Object.create(null)");
    expect(script).toContain("var USER_MESSAGE_PREVIEW_HEIGHT=112");
    expect(script).toContain('richContent.classList.add("user-message-content","is-collapsed")');
    expect(script).toContain('node("button","user-message-toggle","Show more ↓")');
    expect(script).toContain('userMessageToggle.textContent=expanded?"Show less ↑":"Show more ↓"');
    expect(script).toContain("richContent.scrollHeight>USER_MESSAGE_PREVIEW_HEIGHT+2");
    expect(script).toContain("delete expandedUserMessageIds[item.id]");

    expect(script).toContain("function renderMarkdownTable(lines,start)");
    expect(script).toContain("function renderRichList(lines,start)");
    expect(script).toContain('"md-callout md-callout-"+type');
    expect(script).toContain("isMarkdownTableSeparator");
    expect(script).toContain("isMarkdownBlockStart");
    expect(script).toContain("function buildResponseToolbar(item)");
    expect(script).not.toContain("Good response");
    expect(script).not.toContain("Needs improvement");
    expect(script).not.toContain("👍");
    expect(script).not.toContain("👎");
    expect(script).toContain('node("button","response-tool","Copy")');
    expect(script).toContain('node("button","response-tool","↻")');
    expect(script).toContain("md-table-card");
    expect(script).toContain("navigator.clipboard.writeText(item.content||\"\")");
    expect(script).toContain("document.createTextNode(source.slice(cursor,match.index))");
    expect(script).not.toContain(".innerHTML");
    expect(script).toContain("Gemini is working");
    expect(script).toContain("Response is streaming");
    expect(script).toContain("✓ Completed");
    expect(script).toContain("The model is sending response text.");
    expect(script).toContain("Vertex AI has accepted the request");
    expect(script).toContain("meta-pill level");
    expect(script).not.toContain("composerHint");
    expect(script).toContain('document.getElementById("mobileMenu").addEventListener');
    expect(script).toContain("function resizeComposerInput()");
    expect(script).toContain('optimisticMessageId="optimistic-"+crypto.randomUUID()');
    expect(script).toContain("messageInput.value=\"\";\n      resizeComposerInput();");
    expect(script).toContain("promptAccepted=true");
    expect(script).toContain("state.messages=state.messages.filter(function(item){return item.id!==optimisticMessageId;});");
    expect(script).toContain("editingMessageId=editTargetId");
    expect(script).toContain('messageInput.addEventListener("input",function(){resizeComposerInput();updateComposer();});');
    expect(script).toContain("maxHeight=144");
    expect(script).toContain("try{await refreshList(conversationId);}catch(_error){}");
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("state.sessionUsage||{limit_tokens:200000,used_tokens:0,reserved_tokens:0,remaining_tokens:200000,locked:false}");
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
    expect(created.status, await created.clone().text()).toBe(201);
    const createdBody = await created.json() as { ok: boolean; conversation: { id: string; title: string } };
    expect(createdBody.ok).toBe(true);
    expect(createdBody.conversation.title).toBe("Research notes");

    const id = createdBody.conversation.id;
    const noOriginMessage = await call(env, "/admin/api/intelligence/conversations/" + id + "/messages", ownerCookie, {
      method: "POST",
      body: { content: "This must be rejected without an Origin header." },
    });
    expect(noOriginMessage.status).toBe(403);

    const saved = await call(env, "/admin/api/intelligence/conversations/" + id + "/messages", ownerCookie, {
      method: "POST",
      origin,
      body: { content: "Explain the relationship between eigenvalues and stability." },
    });
    const savedBody = await saved.json() as { message: { role: string; content: string } };
    expect(saved.status).toBe(201);
    expect(savedBody.message.role).toBe("user");
    expect(savedBody.message.content).toBe("Explain the relationship between eigenvalues and stability.");

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

    const actualDb = env.DB as unknown as FakeOwnerD1;
    expect([...actualDb.messages.values()].filter((message) => message.conversation_id === id)).toHaveLength(0);
  });


  it("accepts novel-length prompts up to the expanded 300,000-character limit", async () => {
    const env = appEnv();
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";
    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "Long novel input" },
    });
    const createdBody = await created.json() as { conversation: { id: string } };
    const id = createdBody.conversation.id;
    const novel = "N".repeat(250_000);
    const saved = await call(env, "/admin/api/intelligence/conversations/" + id + "/messages", ownerCookie, {
      method: "POST", origin, body: { content: novel },
    });
    expect(saved.status, await saved.clone().text()).toBe(201);
    const savedBody = await saved.json() as { message: { content: string } };
    expect(savedBody.message.content).toHaveLength(250_000);
    expect(savedBody.message.content).toBe(novel);

    const tooLong = await call(env, "/admin/api/intelligence/conversations/" + id + "/messages", ownerCookie, {
      method: "POST", origin, body: { content: "N".repeat(300_001) },
    });
    expect(tooLong.status).toBe(400);
    const reopened = await call(env, "/admin/api/intelligence/conversations/" + id, ownerCookie);
    const reopenedBody = await reopened.json() as { messages: Array<{ content: string }> };
    expect(reopenedBody.messages).toHaveLength(1);
    expect(reopenedBody.messages[0].content).toHaveLength(250_000);
  });

  it("keeps the streaming generation endpoint Owner-only and rejects unsupported model thinking levels", async () => {
    const env = appEnv();
    const adminCookie = await login("admin", "admin-test-password", env);
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";
    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "Generation guard test" },
    });
    const createdBody = await created.json() as { conversation: { id: string } };
    const path = "/admin/api/intelligence/conversations/" + createdBody.conversation.id + "/generate";

    expect((await call(env, path, "")).status).toBe(401);
    expect((await call(env, path, adminCookie, { method: "POST", origin, body: {} })).status).toBe(403);
    const unsupported = await call(env, path, ownerCookie, {
      method: "POST",
      origin,
      body: { content: "Test", modelId: "gemini-4-argon", thinkingLevel: "XHIGH" },
    });
    const unsupportedBody = await unsupported.json() as { error: string };
    expect(unsupported.status).toBe(400);
    expect(unsupportedBody.error).toBe("thinking_level_not_supported");
    expect((env.DB as unknown as FakeOwnerD1).messages.size).toBe(0);
  });

  it("edits and regenerates the stored prompt without retaining obsolete later turns", async () => {
    const env = appEnv();
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";
    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "Edit and regenerate" },
    });
    const createdBody = await created.json() as { conversation: { id: string } };
    const id = createdBody.conversation.id;
    const saved = await call(env, "/admin/api/intelligence/conversations/" + id + "/messages", ownerCookie, {
      method: "POST", origin, body: { content: "Original question" },
    });
    const savedBody = await saved.json() as { message: { id: string } };
    const db = env.DB as unknown as FakeOwnerD1;
    db.messages.set("obsolete-assistant", {
      id: "obsolete-assistant", conversation_id: id, owner_id: "owner",
      role: "assistant", content: "Obsolete answer", status: "complete", created_at: Date.now() + 1,
    });

    const editPath = "/admin/api/intelligence/conversations/" + id + "/generate";
    const edited = await call(env, editPath, ownerCookie, {
      method: "POST", origin,
      body: {
        content: "Corrected question",
        editMessageId: savedBody.message.id,
        modelId: "gemini-4-argon",
        thinkingLevel: "MEDIUM",
      },
    });
    expect(edited.status).toBe(503); // CountTokens preflight fails before any prompt edit is committed.
    expect(db.messages.has("obsolete-assistant")).toBe(true);
    expect(db.messages.get(savedBody.message.id)?.content).toBe("Original question");
    expect([...db.messages.values()].filter((row) => row.role === "assistant")).toHaveLength(1);
    expect(db.generationMetadata.size).toBe(0);

    const regenerated = await call(env, editPath, ownerCookie, {
      method: "POST", origin,
      body: { action: "regenerate", modelId: "gemini-4-argon", thinkingLevel: "MEDIUM" },
    });
    expect(regenerated.status).toBe(503);
    expect(db.messages.has("obsolete-assistant")).toBe(true);
    expect(db.messages.get(savedBody.message.id)?.content).toBe("Original question");
    expect([...db.messages.values()].filter((row) => row.role === "assistant")).toHaveLength(1);
    expect([...db.messages.values()].filter((row) => row.role === "user")).toHaveLength(1);
  });

  it("warns before rollover, rejects in-flight work, then creates one provenance-rich linked successor", async () => {
    const env = appEnv({ DB: (workerTestBindings as unknown as Env).DB });
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";
    const db = env.DB!;
    const topicResponse = await call(env, "/admin/api/intelligence/topics", ownerCookie, {
      method: "POST", origin, body: { title: "Rollover acceptance topic" },
    });
    const topicBody = await topicResponse.json() as { topic: { id: string } };
    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "M4.5 source chat", topicId: topicBody.topic.id },
    });
    const createdBody = await created.json() as { conversation: { id: string } };
    const sourceId = createdBody.conversation.id;

    // Initialise the M4.4 snapshot schema, then attach a deterministic pinned snapshot fixture.
    const memoryInfo = await call(env, "/admin/api/intelligence/conversations/" + sourceId + "/memory", ownerCookie);
    expect(memoryInfo.status).toBe(200);
    const snapshotId = crypto.randomUUID();
    const commitSha = "a".repeat(40);
    const blobSha = "b".repeat(40);
    const now = Date.now();
    const filesJson = JSON.stringify([{ path: "project-memory.md", blobSha, content: "# Pinned project memory\n\nAccepted scope." }]);
    await db.prepare(
      "INSERT INTO owner_intelligence_conversation_memory_snapshots (snapshot_id,owner_id,conversation_id,project_id,project_name,workstream_id,feature_id,is_primary,is_active,hub_repository_id,hub_repository_owner,hub_repository_name,hub_branch,hub_commit_sha,hub_manifest_path,hub_manifest_blob_sha,catalog_entry_path,catalog_entry_blob_sha,project_manifest_path,project_manifest_blob_sha,scope_manifest_path,scope_manifest_blob_sha,scope_manifests_json,manifest_schema_version,files_json,token_count,token_model_id,cross_project_opt_in,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(snapshotId, "owner", sourceId, "project-m45", "M4.5 fixture", null, null, 1, 1, 1463342529,
      "ashini-x", "owner-memory-hub", "main", commitSha, "hub.yaml", blobSha, "catalog/projects.yaml", blobSha,
      "projects/m45/project.yaml", blobSha, null, null, "[]", 1, filesJson, 12, "gemini-4-hydrogen", 0, now).run();

    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO owner_intelligence_messages (id,conversation_id,owner_id,role,content,status,created_at) VALUES (?,?,?,'user',?,'complete',?)")
        .bind(userMessageId, sourceId, "owner", "Continue the M4.5 automatic rollover and handoff milestone.", now + 1),
      db.prepare("INSERT INTO owner_intelligence_messages (id,conversation_id,owner_id,role,content,status,created_at) VALUES (?,?,?,'assistant',?,'complete',?)")
        .bind(assistantMessageId, sourceId, "owner", "Keep the 200,000-token cap and retain the source transcript. The project is pinned to owner-memory-hub main.", now + 2),
      db.prepare("UPDATE owner_intelligence_session_usage SET used_tokens=189999,reserved_tokens=0 WHERE conversation_id=? AND owner_id=?")
        .bind(sourceId, "owner"),
    ]);

    const belowThreshold = await call(env, "/admin/api/intelligence/conversations/" + sourceId + "/rollover", ownerCookie, {
      method: "POST", origin, body: {},
    });
    expect(belowThreshold.status).toBe(409);
    expect((await belowThreshold.json() as { error: string }).error).toBe("rollover_threshold_not_reached");

    await db.prepare("UPDATE owner_intelligence_session_usage SET used_tokens=190000,reserved_tokens=25 WHERE conversation_id=? AND owner_id=?")
      .bind(sourceId, "owner").run();
    const busy = await call(env, "/admin/api/intelligence/conversations/" + sourceId + "/rollover", ownerCookie, {
      method: "POST", origin, body: {},
    });
    expect(busy.status).toBe(409);
    expect((await busy.json() as { error: string }).error).toBe("generation_in_progress");

    await db.prepare("UPDATE owner_intelligence_session_usage SET reserved_tokens=0 WHERE conversation_id=? AND owner_id=?")
      .bind(sourceId, "owner").run();
    const rolled = await call(env, "/admin/api/intelligence/conversations/" + sourceId + "/rollover", ownerCookie, {
      method: "POST", origin, body: {},
    });
    const rolledBody = await rolled.json() as {
      conversation: { id: string; lifecycle_status: string; parent_conversation_id: string | null; topic_id: string | null };
      handoff: { id: string; markdown: string; source_message_ids: string[]; github_sync_status: string };
      usage: { limit_tokens: number; used_tokens: number; reserved_tokens: number; remaining_tokens: number };
    };
    expect(rolled.status).toBe(200);
    expect(rolledBody.conversation.id).not.toBe(sourceId);
    expect(rolledBody.conversation.lifecycle_status).toBe("active");
    expect(rolledBody.conversation.parent_conversation_id).toBe(sourceId);
    expect(rolledBody.conversation.topic_id).toBe(topicBody.topic.id);
    expect(rolledBody.usage).toEqual(expect.objectContaining({
      limit_tokens: 200000, used_tokens: 0, reserved_tokens: 0, remaining_tokens: 200000,
    }));
    expect(rolledBody.handoff.github_sync_status).toBe("pending_review");
    expect(rolledBody.handoff.source_message_ids).toEqual([userMessageId, assistantMessageId]);
    expect(rolledBody.handoff.markdown).toContain("Continue the M4.5 automatic rollover");
    expect(rolledBody.handoff.markdown).toContain(commitSha);
    expect(rolledBody.handoff.markdown).toContain(userMessageId);

    const sourceDetail = await call(env, "/admin/api/intelligence/conversations/" + sourceId, ownerCookie);
    const sourceBody = await sourceDetail.json() as {
      conversation: { lifecycle_status: string; successor_conversation_id: string };
      messages: Array<{ id: string; content: string }>;
      usage: { used_tokens: number; limit_tokens: number };
    };
    expect(sourceBody.conversation.lifecycle_status).toBe("archived");
    expect(sourceBody.conversation.successor_conversation_id).toBe(rolledBody.conversation.id);
    expect(sourceBody.messages.map((message) => message.id)).toEqual([userMessageId, assistantMessageId]);
    expect(sourceBody.usage).toEqual(expect.objectContaining({ used_tokens: 190000, limit_tokens: 200000 }));

    const successorDetail = await call(env, "/admin/api/intelligence/conversations/" + rolledBody.conversation.id, ownerCookie);
    const successorBody = await successorDetail.json() as {
      projectMemory: { snapshots: Array<{ commitSha: string; files: Array<{ path: string; blobSha: string }> }> };
      handoff: { id: string; markdown: string };
    };
    expect(successorBody.projectMemory.snapshots).toHaveLength(1);
    expect(successorBody.projectMemory.snapshots[0].commitSha).toBe(commitSha);
    expect(successorBody.projectMemory.snapshots[0].files).toEqual([{ path: "project-memory.md", blobSha }]);
    expect(successorBody.handoff.id).toBe(rolledBody.handoff.id);

    const retry = await call(env, "/admin/api/intelligence/conversations/" + sourceId + "/rollover", ownerCookie, {
      method: "POST", origin, body: {},
    });
    expect(retry.status).toBe(200);
    expect((await retry.json() as { conversation: { id: string } }).conversation.id).toBe(rolledBody.conversation.id);
    const successorCount = await db.prepare("SELECT COUNT(*) AS count FROM owner_intelligence_conversations WHERE owner_id=? AND parent_conversation_id=?")
      .bind("owner", sourceId).first<{ count: number }>();
    expect(Number(successorCount?.count)).toBe(1);
    const memoryJob = await db.prepare(
      "SELECT status,idempotency_key,attempt_count FROM owner_intelligence_memory_jobs WHERE owner_id=? AND source_conversation_id=? AND job_type='rollover'",
    ).bind("owner", sourceId).first<{ status: string; idempotency_key: string; attempt_count: number }>();
    expect(memoryJob).toEqual(expect.objectContaining({
      status: "pending_review", idempotency_key: "rollover:" + sourceId, attempt_count: 0,
    }));

    vi.mocked(countOwnerGeminiInputTokens).mockClear();
    const archivedGeneration = await call(env, "/admin/api/intelligence/conversations/" + sourceId + "/generate", ownerCookie, {
      method: "POST", origin,
      body: { content: "This archived source must reject a request.", modelId: "gemini-4-hydrogen", thinkingLevel: "HIGH" },
    });
    expect(archivedGeneration.status).toBe(404);
    expect(countOwnerGeminiInputTokens).not.toHaveBeenCalled();

    const blockedSourceAppend = await call(env, "/admin/api/intelligence/conversations/" + sourceId + "/messages", ownerCookie, {
      method: "POST", origin, body: { content: "This must not alter the archived transcript." },
    });
    expect(blockedSourceAppend.status).toBe(404);

    let countedHandoffPrompt = "";
    vi.mocked(countOwnerGeminiInputTokens).mockClear().mockImplementationOnce(async (_env, input) => {
      countedHandoffPrompt = input.contents[0]?.text || "";
      return 5;
    });
    vi.mocked(openOwnerGeminiStream).mockClear().mockImplementationOnce(async () => (async function* () {
      yield { type: "done" as const, usage: { promptTokens: 5, outputTokens: 5, totalTokens: 10 }, elapsedMs: 5 };
    })());
    const continued = await call(env, "/admin/api/intelligence/conversations/" + rolledBody.conversation.id + "/generate", ownerCookie, {
      method: "POST", origin,
      body: { content: "Continue from the handoff now.", modelId: "gemini-4-hydrogen", thinkingLevel: "HIGH" },
    });
    expect(continued.status).toBe(200);
    await continued.text();
    expect(countedHandoffPrompt).toContain("ROLLOVER HANDOFF REFERENCE DATA");
    expect(countedHandoffPrompt).toContain(commitSha);
    expect(countedHandoffPrompt).toContain(userMessageId);
  });

  it("keeps a 200,000-token budget per conversation and blocks a full session server-side", async () => {
    const env = appEnv();
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";
    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "Capped session" },
    });
    const createdBody = await created.json() as { conversation: { id: string } };
    const id = createdBody.conversation.id;
    const db = env.DB as unknown as FakeOwnerD1;
    db.sessionUsage.set(id, {
      conversation_id: id, owner_id: "owner", token_limit: OWNER_INTELLIGENCE_SESSION_TOKEN_LIMIT,
      used_tokens: OWNER_INTELLIGENCE_SESSION_TOKEN_LIMIT, reserved_tokens: 0,
      locked_reason: null, updated_at: Date.now(),
    });

    const detail = await call(env, "/admin/api/intelligence/conversations/" + id, ownerCookie);
    const detailBody = await detail.json() as { usage: { limit_tokens: number; used_tokens: number; remaining_tokens: number; locked: boolean } };
    expect(detail.status).toBe(200);
    expect(detailBody.usage).toEqual(expect.objectContaining({
      limit_tokens: 200_000, used_tokens: 200_000, remaining_tokens: 0, locked: true,
    }));

    const blocked = await call(env, "/admin/api/intelligence/conversations/" + id + "/generate", ownerCookie, {
      method: "POST", origin,
      body: { content: "This must not be sent.", modelId: "gemini-4-carbon", thinkingLevel: "HIGH" },
    });
    const blockedBody = await blocked.json() as { error: string; usage: { locked: boolean } };
    expect(blocked.status).toBe(409);
    expect(blockedBody.error).toBe("session_token_limit_reached");
    expect(blockedBody.usage.locked).toBe(true);
    expect(db.messages.size).toBe(0); // A rejected prompt is not persisted as an unanswered user turn.

    const next = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "Fresh session" },
    });
    const nextBody = await next.json() as { conversation: { id: string } };
    const freshUsage = await getOwnerIntelligenceSessionUsage(env, nextBody.conversation.id);
    expect(freshUsage).toEqual(expect.objectContaining({
      limit_tokens: 200_000, used_tokens: 0, remaining_tokens: 200_000, locked: false,
    }));
  });

  it("permits the exact final prompt-plus-one-output-token reservation and then locks at 200,000", async () => {
    const env = appEnv({ DB: (workerTestBindings as unknown as Env).DB });
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";
    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "Exact final reservation" },
    });
    const createdBody = await created.json() as { conversation: { id: string } };
    const id = createdBody.conversation.id;
    const db = env.DB!;
    await getOwnerIntelligenceSessionUsage(env, id);
    await db.prepare(
      "UPDATE owner_intelligence_session_usage SET used_tokens = ? WHERE conversation_id = ? AND owner_id = ?",
    ).bind(OWNER_INTELLIGENCE_SESSION_TOKEN_LIMIT - 10, id, "owner").run();

    let requestedOutputLimit = 0;
    let countedSystemInstruction = "";
    let streamedSystemInstruction = "";
    vi.mocked(countOwnerGeminiInputTokens).mockClear().mockImplementationOnce(async (_env, input) => {
      countedSystemInstruction = input.systemInstruction ?? "";
      return 5;
    });
    vi.mocked(openOwnerGeminiStream).mockClear().mockImplementationOnce(async (_env, input) => {
      requestedOutputLimit = input.maxOutputTokens ?? 0;
      streamedSystemInstruction = input.systemInstruction ?? "";
      return (async function* () {
        yield {
          type: "done" as const,
          usage: { promptTokens: 5, outputTokens: 5, totalTokens: 10 },
          elapsedMs: 12,
        };
      })();
    });
    const path = "/admin/api/intelligence/conversations/" + id + "/generate";
    const generated = await call(env, path, ownerCookie, {
      method: "POST", origin,
      body: {
        content: "This request exactly fills the final ten tokens.",
        modelId: "gemini-4-hydrogen",
        thinkingLevel: "HIGH",
      },
    });
    expect(generated.status).toBe(200);
    await generated.text();

    expect(requestedOutputLimit).toBe(5);
    expect(countedSystemInstruction).toBe(OWNER_INTELLIGENCE_RESPONSE_STYLE_INSTRUCTION);
    expect(streamedSystemInstruction).toBe(OWNER_INTELLIGENCE_RESPONSE_STYLE_INSTRUCTION);
    expect(countedSystemInstruction).toContain("independently choose the clearest response structure");
    expect(countedSystemInstruction).toContain("Markdown comparison table automatically");
    expect(countedSystemInstruction).toContain("> [!SUCCESS]");
    expect(countedSystemInstruction).toContain("Do not force every response to contain every format");
    const messagesAfterCompletion = await db.prepare(
      "SELECT role, status FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ? ORDER BY created_at ASC",
    ).bind(id, "owner").all<{ role: string; status: string }>();
    expect(messagesAfterCompletion.results.filter((row) => row.role === "user")).toHaveLength(1);
    expect(messagesAfterCompletion.results.filter((row) => row.role === "assistant").map((row) => row.status)).toEqual(["complete"]);
    const settled = await getOwnerIntelligenceSessionUsage(env, id);
    expect(settled).toEqual(expect.objectContaining({
      limit_tokens: 200_000,
      used_tokens: 200_000,
      reserved_tokens: 0,
      remaining_tokens: 0,
      locked: true,
    }));

    const countBeforeRejectedPrompt = Number((await db.prepare(
      "SELECT COUNT(*) AS count FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ? AND role = 'user'",
    ).bind(id, "owner").first<{ count: number }>())?.count ?? 0);
    const rejected = await call(env, path, ownerCookie, {
      method: "POST", origin,
      body: {
        content: "This prompt must not be persisted after the exact budget is consumed.",
        modelId: "gemini-4-hydrogen",
        thinkingLevel: "HIGH",
      },
    });
    const rejectedBody = await rejected.json() as { error: string };
    expect(rejected.status).toBe(409);
    expect(rejectedBody.error).toBe("session_token_limit_reached");
    const countAfterRejectedPrompt = Number((await db.prepare(
      "SELECT COUNT(*) AS count FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ? AND role = 'user'",
    ).bind(id, "owner").first<{ count: number }>())?.count ?? 0);
    expect(countAfterRejectedPrompt).toBe(countBeforeRejectedPrompt);
  });

  it("rejects a request that is one output token beyond the remaining budget before persisting its prompt", async () => {
    const env = appEnv({ DB: (workerTestBindings as unknown as Env).DB });
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";
    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "One token over" },
    });
    const createdBody = await created.json() as { conversation: { id: string } };
    const id = createdBody.conversation.id;
    const db = env.DB!;
    await getOwnerIntelligenceSessionUsage(env, id);
    await db.prepare(
      "UPDATE owner_intelligence_session_usage SET used_tokens = ? WHERE conversation_id = ? AND owner_id = ?",
    ).bind(OWNER_INTELLIGENCE_SESSION_TOKEN_LIMIT - 10, id, "owner").run();

    vi.mocked(countOwnerGeminiInputTokens).mockClear().mockResolvedValueOnce(10);
    vi.mocked(openOwnerGeminiStream).mockClear();
    const path = "/admin/api/intelligence/conversations/" + id + "/generate";
    const response = await call(env, path, ownerCookie, {
      method: "POST", origin,
      body: {
        content: "This request cannot fit the minimum one output token.",
        modelId: "gemini-4-hydrogen",
        thinkingLevel: "HIGH",
      },
    });
    const responseBody = await response.json() as { error: string; usage: { used_tokens: number; reserved_tokens: number; locked: boolean } };

    expect(response.status).toBe(409);
    expect(responseBody.error).toBe("session_token_limit_reached");
    expect(responseBody.usage).toEqual(expect.objectContaining({
      used_tokens: 199_990,
      reserved_tokens: 0,
      locked: true,
    }));
    expect(openOwnerGeminiStream).not.toHaveBeenCalled();
    const messageCount = Number((await db.prepare(
      "SELECT COUNT(*) AS count FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ?",
    ).bind(id, "owner").first<{ count: number }>())?.count ?? 0);
    const reservationCount = Number((await db.prepare(
      "SELECT COUNT(*) AS count FROM owner_intelligence_token_reservations WHERE conversation_id = ? AND owner_id = ?",
    ).bind(id, "owner").first<{ count: number }>())?.count ?? 0);
    expect(messageCount).toBe(0);
    expect(reservationCount).toBe(0);
  });

  it("allows only one atomic D1 reservation when two same-chat requests cross preflight together", async () => {
    const env = appEnv({ DB: (workerTestBindings as unknown as Env).DB });
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";
    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "Reservation race" },
    });
    const createdBody = await created.json() as { conversation: { id: string } };
    const id = createdBody.conversation.id;
    const db = env.DB!;
    await getOwnerIntelligenceSessionUsage(env, id);
    await db.prepare(
      "UPDATE owner_intelligence_session_usage SET used_tokens = ? WHERE conversation_id = ? AND owner_id = ?",
    ).bind(OWNER_INTELLIGENCE_SESSION_TOKEN_LIMIT - 100, id, "owner").run();

    let countCalls = 0;
    let releaseCountTokens!: () => void;
    const bothRequestsAtPreflight = new Promise<void>((resolve) => { releaseCountTokens = resolve; });
    vi.mocked(countOwnerGeminiInputTokens).mockClear();
    const synchronizedCount = async () => {
      countCalls += 1;
      if (countCalls === 2) releaseCountTokens();
      await bothRequestsAtPreflight;
      return 10;
    };
    vi.mocked(countOwnerGeminiInputTokens)
      .mockImplementationOnce(synchronizedCount)
      .mockImplementationOnce(synchronizedCount);
    vi.mocked(openOwnerGeminiStream).mockClear().mockImplementationOnce(async (_env, _input, signal) =>
      (async function* () {
        yield { type: "delta" as const, text: "partial output" };
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      })(),
    );
    const path = "/admin/api/intelligence/conversations/" + id + "/generate";
    const requests = await Promise.all([
      call(env, path, ownerCookie, {
        method: "POST", origin,
        body: { content: "First concurrent request.", modelId: "gemini-4-hydrogen", thinkingLevel: "HIGH" },
      }),
      call(env, path, ownerCookie, {
        method: "POST", origin,
        body: { content: "Second concurrent request.", modelId: "gemini-4-hydrogen", thinkingLevel: "HIGH" },
      }),
    ]);

    expect(countCalls).toBe(2);
    expect(requests.filter((response) => response.status === 200)).toHaveLength(1);
    expect(requests.filter((response) => response.status === 409)).toHaveLength(1);
    const blocked = requests.find((response) => response.status === 409)!;
    const blockedBody = await blocked.json() as { error: string; usage: { reserved_tokens: number } };
    expect(blockedBody.error).toBe("generation_in_progress");
    expect(blockedBody.usage.reserved_tokens).toBe(100);
    const reservationCount = Number((await db.prepare(
      "SELECT COUNT(*) AS count FROM owner_intelligence_token_reservations WHERE conversation_id = ? AND owner_id = ? AND status = 'reserved'",
    ).bind(id, "owner").first<{ count: number }>())?.count ?? 0);
    const userMessageCount = Number((await db.prepare(
      "SELECT COUNT(*) AS count FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ? AND role = 'user'",
    ).bind(id, "owner").first<{ count: number }>())?.count ?? 0);
    expect(reservationCount).toBe(1);
    expect(userMessageCount).toBe(1);
    const inFlight = await getOwnerIntelligenceSessionUsage(env, id);
    expect(inFlight).toEqual(expect.objectContaining({
      used_tokens: 199_900,
      reserved_tokens: 100,
      remaining_tokens: 0,
      locked: false,
    }));

    const accepted = requests.find((response) => response.status === 200)!;
    await accepted.body?.cancel();
  });

  it("backfills existing chats from generation totalTokenCount without charging new chats", async () => {
    const env = appEnv();
    const ownerCookie = await login("owner", "owner-test-password", env);
    const origin = "https://parmar-ai.test";
    const created = await call(env, "/admin/api/intelligence/conversations", ownerCookie, {
      method: "POST", origin, body: { title: "Existing token history" },
    });
    const createdBody = await created.json() as { conversation: { id: string } };
    const id = createdBody.conversation.id;
    const db = env.DB as unknown as FakeOwnerD1;
    db.messages.set("historic-user", {
      id: "historic-user", conversation_id: id, owner_id: "owner",
      role: "user", content: "Historic question", status: "complete", created_at: 1,
    });
    db.messages.set("historic-assistant", {
      id: "historic-assistant", conversation_id: id, owner_id: "owner",
      role: "assistant", content: "Historic answer", status: "complete", created_at: 2,
    });
    db.generationMetadata.set("historic-assistant", {
      message_id: "historic-assistant", owner_id: "owner", model_id: "gemini-4-carbon",
      thinking_level: "HIGH", prompt_tokens: 800, output_tokens: 200,
      total_tokens: 1_250, elapsed_ms: 900,
    });

    const usage = await getOwnerIntelligenceSessionUsage(env, id);
    expect(usage).toEqual(expect.objectContaining({
      limit_tokens: 200_000, used_tokens: 1_250, reserved_tokens: 0,
      remaining_tokens: 198_750, locked: false,
    }));
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

  it("protects the project-aware Gemini model catalogue and returns a safe unconfigured state to Owner", async () => {
    const env = appEnv();
    const adminCookie = await login("admin", "admin-test-password", env);
    const ownerCookie = await login("owner", "owner-test-password", env);

    expect((await call(env, "/admin/api/intelligence/models")).status).toBe(401);
    expect((await call(env, "/admin/api/intelligence/models", adminCookie)).status).toBe(403);
    const response = await call(env, "/admin/api/intelligence/models", ownerCookie);
    const body = await response.json() as {
      ok: boolean;
      configured: boolean;
      error: string;
      models: Array<{ selectable: boolean; availability: string }>;
    };
    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.configured).toBe(false);
    expect(body.error).toBe("vertex_not_configured");
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models.every((model) => !model.selectable && model.availability === "unverified")).toBe(true);
  });
});
