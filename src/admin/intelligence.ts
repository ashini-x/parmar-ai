import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { Env } from "../config/env";
import { json, methodNotAllowed, notFound } from "../http/response";
import { openOwnerGeminiStream, ownerIntelligenceModelsResponse, OWNER_GEMINI_MODEL_REGISTRY, OwnerGeminiProviderError, type OwnerGeminiStreamEvent, type OwnerThinkingLevel } from "./intelligence-provider";

export interface OwnerIntelligenceConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface OwnerIntelligenceMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "pending" | "complete" | "partial" | "error";
  created_at: number;
  model_id?: string | null;
  thinking_level?: OwnerThinkingLevel | null;
  prompt_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  elapsed_ms?: number | null;
}

interface OwnerConversationRow extends OwnerIntelligenceConversation {
  owner_id: string;
}

interface OwnerMessageRow extends OwnerIntelligenceMessage {
  owner_id: string;
}

const readyDatabases = new WeakSet<object>();
const MAX_TITLE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 50_000;
const MAX_CONVERSATIONS = 100;

/**
 * Creates an entirely separate Owner chat store. Only a completed binding is
 * cached: Cloudflare request contexts must not await a module-global pending
 * Promise created by another request. CREATE IF NOT EXISTS is safe on races.
 */
export async function ensureOwnerIntelligenceSchema(env: Env): Promise<void> {
  const db = env.DB;
  if (!db) throw new Error("The Owner Intelligence database is not configured.");
  if (readyDatabases.has(db)) return;

  const results = await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS owner_intelligence_conversations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_owner_intelligence_conversations_owner_updated
      ON owner_intelligence_conversations(owner_id, updated_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS owner_intelligence_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('pending','complete','partial','error')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES owner_intelligence_conversations(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_owner_intelligence_messages_conversation_created
      ON owner_intelligence_messages(owner_id, conversation_id, created_at ASC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS owner_intelligence_generation_metadata (
      message_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      thinking_level TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      elapsed_ms INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (message_id) REFERENCES owner_intelligence_messages(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_owner_intelligence_generation_owner
      ON owner_intelligence_generation_metadata(owner_id, model_id)`),
  ]);
  if (results.some((result) => !result.success)) {
    throw new Error("D1 did not confirm the Owner Intelligence schema.");
  }
  readyDatabases.add(db);
}

function ownerPrincipal(env: Env): string {
  const configured = env.OWNER_DASHBOARD_USER?.trim().toLowerCase();
  if (!configured) throw new Error("The Owner Intelligence principal is not configured.");
  return configured;
}

function normalizedTitle(value: unknown): string {
  if (typeof value !== "string") throw new Error("A conversation title is required.");
  const title = value.replace(/\s+/gu, " ").trim();
  if (!title) throw new Error("A conversation title cannot be empty.");
  if (title.length > MAX_TITLE_LENGTH) throw new Error("Conversation titles must be 80 characters or fewer.");
  return title;
}

function mapConversation(row: OwnerConversationRow): OwnerIntelligenceConversation {
  return { id: row.id, title: row.title, created_at: Number(row.created_at), updated_at: Number(row.updated_at) };
}

function mapMessage(row: OwnerMessageRow): OwnerIntelligenceMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    status: row.status,
    created_at: Number(row.created_at),
    ...(row.model_id ? { model_id: row.model_id } : {}),
    ...(row.thinking_level ? { thinking_level: row.thinking_level } : {}),
    ...(row.prompt_tokens !== undefined && row.prompt_tokens !== null ? { prompt_tokens: Number(row.prompt_tokens) } : {}),
    ...(row.output_tokens !== undefined && row.output_tokens !== null ? { output_tokens: Number(row.output_tokens) } : {}),
    ...(row.total_tokens !== undefined && row.total_tokens !== null ? { total_tokens: Number(row.total_tokens) } : {}),
    ...(row.elapsed_ms !== undefined && row.elapsed_ms !== null ? { elapsed_ms: Number(row.elapsed_ms) } : {}),
  };
}

export async function listOwnerIntelligenceConversations(env: Env): Promise<OwnerIntelligenceConversation[]> {
  await ensureOwnerIntelligenceSchema(env);
  const result = await env.DB!.prepare(
    "SELECT id, owner_id, title, created_at, updated_at FROM owner_intelligence_conversations WHERE owner_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT ?",
  ).bind(ownerPrincipal(env), MAX_CONVERSATIONS).all<OwnerConversationRow>();
  return (result.results ?? []).map(mapConversation);
}

export async function createOwnerIntelligenceConversation(
  env: Env,
  title = "New chat",
): Promise<OwnerIntelligenceConversation> {
  await ensureOwnerIntelligenceSchema(env);
  const id = crypto.randomUUID();
  const now = Date.now();
  const safeTitle = normalizedTitle(title);
  const result = await env.DB!.prepare(
    "INSERT INTO owner_intelligence_conversations (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, ownerPrincipal(env), safeTitle, now, now).run();
  if (!result.success) throw new Error("D1 did not confirm the new conversation.");
  return { id, title: safeTitle, created_at: now, updated_at: now };
}

export async function getOwnerIntelligenceConversation(
  env: Env,
  id: string,
): Promise<{ conversation: OwnerIntelligenceConversation; messages: OwnerIntelligenceMessage[] } | null> {
  await ensureOwnerIntelligenceSchema(env);
  const ownerId = ownerPrincipal(env);
  const row = await env.DB!.prepare(
    "SELECT id, owner_id, title, created_at, updated_at FROM owner_intelligence_conversations WHERE id = ? AND owner_id = ?",
  ).bind(id, ownerId).first<OwnerConversationRow>();
  if (!row) return null;

  const result = await env.DB!.prepare(
    `SELECT m.id, m.conversation_id, m.owner_id, m.role, m.content, m.status, m.created_at,
      g.model_id, g.thinking_level, g.prompt_tokens, g.output_tokens, g.total_tokens, g.elapsed_ms
     FROM owner_intelligence_messages m
     LEFT JOIN owner_intelligence_generation_metadata g
       ON g.message_id = m.id AND g.owner_id = m.owner_id
     WHERE m.conversation_id = ? AND m.owner_id = ?
     ORDER BY m.created_at ASC, m.id ASC`,
  ).bind(id, ownerId).all<OwnerMessageRow>();
  return { conversation: mapConversation(row), messages: (result.results ?? []).map(mapMessage) };
}

export async function renameOwnerIntelligenceConversation(
  env: Env,
  id: string,
  title: string,
): Promise<OwnerIntelligenceConversation | null> {
  await ensureOwnerIntelligenceSchema(env);
  const result = await env.DB!.prepare(
    "UPDATE owner_intelligence_conversations SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
  ).bind(normalizedTitle(title), Date.now(), id, ownerPrincipal(env)).run();
  if (!result.success) throw new Error("D1 did not confirm the conversation rename.");
  const row = await env.DB!.prepare(
    "SELECT id, owner_id, title, created_at, updated_at FROM owner_intelligence_conversations WHERE id = ? AND owner_id = ?",
  ).bind(id, ownerPrincipal(env)).first<OwnerConversationRow>();
  return row ? mapConversation(row) : null;
}

export async function deleteOwnerIntelligenceConversation(env: Env, id: string): Promise<boolean> {
  await ensureOwnerIntelligenceSchema(env);
  const ownerId = ownerPrincipal(env);
  const existing = await env.DB!.prepare(
    "SELECT id FROM owner_intelligence_conversations WHERE id = ? AND owner_id = ?",
  ).bind(id, ownerId).first<{ id: string }>();
  if (!existing) return false;

  const results = await env.DB!.batch([
    env.DB!.prepare("DELETE FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ?").bind(id, ownerId),
    env.DB!.prepare("DELETE FROM owner_intelligence_conversations WHERE id = ? AND owner_id = ?").bind(id, ownerId),
  ]);
  if (results.some((result) => !result.success)) {
    throw new Error("D1 did not confirm conversation deletion.");
  }
  return true;
}

/** Store a future model turn without mixing it into student Telegram records. */
export async function appendOwnerIntelligenceMessage(
  env: Env,
  input: {
    conversationId: string;
    role: OwnerIntelligenceMessage["role"];
    content: string;
    status?: OwnerIntelligenceMessage["status"];
    modelId?: string;
    thinkingLevel?: OwnerThinkingLevel;
  },
): Promise<OwnerIntelligenceMessage | null> {
  await ensureOwnerIntelligenceSchema(env);
  const status = input.status ?? "complete";
  if (typeof input.content !== "string" || input.content.length > MAX_MESSAGE_LENGTH ||
      (input.content.length === 0 && !(input.role === "assistant" && status === "pending"))) {
    throw new Error("Message content must contain between 1 and 50,000 characters.");
  }
  if ((input.modelId && !input.thinkingLevel) || (!input.modelId && input.thinkingLevel)) {
    throw new Error("Generation metadata is incomplete.");
  }
  const ownerId = ownerPrincipal(env);
  const conversation = await env.DB!.prepare(
    "SELECT id FROM owner_intelligence_conversations WHERE id = ? AND owner_id = ?",
  ).bind(input.conversationId, ownerId).first<{ id: string }>();
  if (!conversation) return null;

  const latest = await env.DB!.prepare(
    "SELECT MAX(created_at) AS latest FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ?",
  ).bind(input.conversationId, ownerId).first<{ latest: number | null }>();
  const createdAt = Math.max(Date.now(), Number(latest?.latest ?? 0) + 1);
  const message: OwnerIntelligenceMessage = {
    id: crypto.randomUUID(),
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    status,
    created_at: createdAt,
    ...(input.modelId ? { model_id: input.modelId } : {}),
    ...(input.thinkingLevel ? { thinking_level: input.thinkingLevel } : {}),
  };
  const statements = [
    env.DB!.prepare(
      "INSERT INTO owner_intelligence_messages (id, conversation_id, owner_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(message.id, message.conversation_id, ownerId, message.role, message.content, message.status, message.created_at),
    env.DB!.prepare(
      "UPDATE owner_intelligence_conversations SET updated_at = ? WHERE id = ? AND owner_id = ?",
    ).bind(message.created_at, input.conversationId, ownerId),
  ];
  if (input.modelId && input.thinkingLevel) {
    statements.push(env.DB!.prepare(
      "INSERT INTO owner_intelligence_generation_metadata (message_id, owner_id, model_id, thinking_level) VALUES (?, ?, ?, ?)",
    ).bind(message.id, ownerId, input.modelId, input.thinkingLevel));
  }
  const results = await env.DB!.batch(statements);
  if (results.some((result) => !result.success)) throw new Error("D1 did not confirm the message save.");
  return message;
}

async function updateOwnerAssistantMessage(
  env: Env,
  messageId: string,
  content: string,
  status: OwnerIntelligenceMessage["status"],
  usage?: { promptTokens: number; outputTokens: number; totalTokens: number; elapsedMs: number },
): Promise<OwnerIntelligenceMessage | null> {
  await ensureOwnerIntelligenceSchema(env);
  if (content.length > MAX_MESSAGE_LENGTH) throw new Error("The generated response exceeded the supported message size.");
  const ownerId = ownerPrincipal(env);
  const results = await env.DB!.batch([
    env.DB!.prepare(
      "UPDATE owner_intelligence_messages SET content = ?, status = ? WHERE id = ? AND owner_id = ? AND role = 'assistant'",
    ).bind(content, status, messageId, ownerId),
    ...(usage ? [env.DB!.prepare(
      `UPDATE owner_intelligence_generation_metadata
       SET prompt_tokens = ?, output_tokens = ?, total_tokens = ?, elapsed_ms = ?
       WHERE message_id = ? AND owner_id = ?`,
    ).bind(usage.promptTokens, usage.outputTokens, usage.totalTokens, usage.elapsedMs, messageId, ownerId)] : []),
  ]);
  if (results.some((result) => !result.success)) throw new Error("D1 did not confirm the assistant response update.");
  const row = await env.DB!.prepare(
    `SELECT m.id, m.conversation_id, m.owner_id, m.role, m.content, m.status, m.created_at,
      g.model_id, g.thinking_level, g.prompt_tokens, g.output_tokens, g.total_tokens, g.elapsed_ms
     FROM owner_intelligence_messages m
     LEFT JOIN owner_intelligence_generation_metadata g
       ON g.message_id = m.id AND g.owner_id = m.owner_id
     WHERE m.id = ? AND m.owner_id = ? AND m.role = 'assistant'`,
  ).bind(messageId, ownerId).first<OwnerMessageRow>();
  return row ? mapMessage(row) : null;
}

async function prepareOwnerPrompt(
  env: Env,
  conversationId: string,
  input: { content?: string; editMessageId?: string; action?: "regenerate" },
): Promise<OwnerIntelligenceMessage[] | null> {
  await ensureOwnerIntelligenceSchema(env);
  const ownerId = ownerPrincipal(env);
  const conversation = await env.DB!.prepare(
    "SELECT id, title FROM owner_intelligence_conversations WHERE id = ? AND owner_id = ?",
  ).bind(conversationId, ownerId).first<{ id: string; title: string }>();
  if (!conversation) return null;
  const existing = await env.DB!.prepare(
    "SELECT id, conversation_id, owner_id, role, content, status, created_at FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ? ORDER BY created_at ASC, id ASC",
  ).bind(conversationId, ownerId).all<OwnerMessageRow>();
  const ordered = existing.results ?? [];
  const statements: D1PreparedStatement[] = [];

  if (input.action === "regenerate") {
    let targetIndex = -1;
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      if (ordered[i].role === "user") { targetIndex = i; break; }
    }
    if (targetIndex < 0) throw new Error("There is no user message to regenerate.");
    for (const row of ordered.slice(targetIndex + 1)) {
      statements.push(env.DB!.prepare("DELETE FROM owner_intelligence_messages WHERE id = ? AND owner_id = ?").bind(row.id, ownerId));
    }
  } else if (input.editMessageId) {
    if (typeof input.content !== "string" || !input.content.trim() || input.content.length > MAX_MESSAGE_LENGTH) {
      throw new Error("Enter a message between 1 and 50,000 characters.");
    }
    const targetIndex = ordered.findIndex((row) => row.id === input.editMessageId && row.role === "user");
    if (targetIndex < 0) throw new Error("The user message to edit was not found.");
    const target = ordered[targetIndex];
    statements.push(env.DB!.prepare(
      "UPDATE owner_intelligence_messages SET content = ?, status = 'complete' WHERE id = ? AND owner_id = ? AND role = 'user'",
    ).bind(input.content.trim(), target.id, ownerId));
    for (const row of ordered.slice(targetIndex + 1)) {
      statements.push(env.DB!.prepare("DELETE FROM owner_intelligence_messages WHERE id = ? AND owner_id = ?").bind(row.id, ownerId));
    }
  } else {
    if (typeof input.content !== "string" || !input.content.trim() || input.content.length > MAX_MESSAGE_LENGTH) {
      throw new Error("Enter a message between 1 and 50,000 characters.");
    }
    const message = await appendOwnerIntelligenceMessage(env, {
      conversationId, role: "user", content: input.content.trim(),
    });
    if (!message) return null;
    if (conversation.title === "New chat") {
      const title = input.content.trim().replace(/\s+/gu, " ").slice(0, MAX_TITLE_LENGTH);
      await env.DB!.prepare(
        "UPDATE owner_intelligence_conversations SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      ).bind(title, message.created_at, conversationId, ownerId).run();
    }
  }
  if (statements.length) {
    const result = await env.DB!.batch(statements);
    if (result.some((item) => !item.success)) throw new Error("D1 did not confirm the prompt edit or regeneration reset.");
  }
  const result = await env.DB!.prepare(
    "SELECT id, conversation_id, owner_id, role, content, status, created_at FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ? ORDER BY created_at ASC, id ASC",
  ).bind(conversationId, ownerId).all<OwnerMessageRow>();
  return (result.results ?? []).map(mapMessage);
}

function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin &&
      request.headers.get("Sec-Fetch-Site") !== "cross-site";
  } catch {
    return false;
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > 205_000) return null;
  const raw = await request.text();
  if (raw.length > 205_000) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function validConversationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}


function streamEvent(controller: ReadableStreamDefaultController<Uint8Array>, type: string, value: unknown): void {
  controller.enqueue(new TextEncoder().encode("event: " + type + "\ndata: " + JSON.stringify(value) + "\n\n"));
}

async function handleOwnerGeneration(
  request: Request,
  env: Env,
  conversationId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  if (!isSameOriginMutation(request)) return json({ ok: false, error: "same_origin_required" }, 403);
  const body = await readJsonBody(request);
  const allowedKeys = new Set(["content", "modelId", "thinkingLevel", "editMessageId", "action"]);
  if (!body || Object.keys(body).some((key) => !allowedKeys.has(key)) ||
      typeof body.modelId !== "string" || typeof body.thinkingLevel !== "string" ||
      (body.action !== undefined && body.action !== "regenerate") ||
      (body.editMessageId !== undefined && typeof body.editMessageId !== "string") ||
      (body.content !== undefined && typeof body.content !== "string")) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  const definition = OWNER_GEMINI_MODEL_REGISTRY.find((item) => item.id === body.modelId);
  if (!definition) return json({ ok: false, error: "model_not_supported" }, 400);
  const thinkingLevel = body.thinkingLevel as OwnerThinkingLevel;
  if (!definition.thinkingLevels.includes(thinkingLevel)) {
    return json({ ok: false, error: "thinking_level_not_supported", message: "Choose a thinking level supported by the selected model." }, 400);
  }
  if (body.action === "regenerate" && (body.content !== undefined || body.editMessageId !== undefined)) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  if (body.editMessageId && body.action) return json({ ok: false, error: "invalid_request" }, 400);
  if (!body.action && typeof body.content !== "string") return json({ ok: false, error: "message_required" }, 400);

  let messages: OwnerIntelligenceMessage[] | null;
  try {
    messages = await prepareOwnerPrompt(env, conversationId, {
      content: body.content as string | undefined,
      editMessageId: body.editMessageId as string | undefined,
      action: body.action as "regenerate" | undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The prompt could not be prepared.";
    return json({ ok: false, error: "prompt_update_failed", message }, 400);
  }
  if (!messages) return notFound();

  const contents = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-49)
    .map((message) => ({ role: message.role === "assistant" ? "model" as const : "user" as const, text: message.content }));
  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return json({ ok: false, error: "latest_message_missing" }, 409);
  }
  const assistantMessage = await appendOwnerIntelligenceMessage(env, {
    conversationId,
    role: "assistant",
    content: "",
    status: "pending",
    modelId: definition.id,
    thinkingLevel,
  });
  if (!assistantMessage) return notFound();

  const abortController = new AbortController();
  const abortFromRequest = () => abortController.abort();
  if (request.signal.aborted) abortController.abort();
  else request.signal.addEventListener("abort", abortFromRequest, { once: true });

  let upstream: AsyncGenerator<OwnerGeminiStreamEvent>;
  try {
    upstream = await openOwnerGeminiStream(env, {
      modelId: definition.id,
      thinkingLevel,
      contents,
      maxOutputTokens: 8_192,
    }, abortController.signal);
  } catch (error) {
    request.signal.removeEventListener("abort", abortFromRequest);
    const providerError = error instanceof OwnerGeminiProviderError ? error : null;
    const status = providerError?.status === 400 ? 400 : providerError?.status === 401 || providerError?.status === 403 ? 502 : 503;
    const message = providerError?.message ?? "The model request could not be started.";
    await updateOwnerAssistantMessage(env, assistantMessage.id, "", "error");
    return json({ ok: false, error: "generation_start_failed", message }, status);
  }

  let generatedText = "";
  let lastPersistedLength = 0;
  let lastPersistedAt = Date.now();
  let finalMessage: OwnerIntelligenceMessage | null = null;
  let finalizePromise: Promise<OwnerIntelligenceMessage | null> | null = null;

  const finalize = (
    status: OwnerIntelligenceMessage["status"],
    usage?: { promptTokens: number; outputTokens: number; totalTokens: number; elapsedMs: number },
  ): Promise<OwnerIntelligenceMessage | null> => {
    if (!finalizePromise) {
      finalizePromise = updateOwnerAssistantMessage(env, assistantMessage.id, generatedText, status, usage)
        .then((message) => { finalMessage = message; return message; });
    }
    return finalizePromise;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEvent = (type: string, value: unknown) => {
        try { streamEvent(controller, type, value); return true; }
        catch { return false; }
      };
      safeEvent("meta", {
        message: assistantMessage,
        model: definition.label,
        thinkingLevel,
      });
      void (async () => {
        let completed = false;
        try {
          for await (const event of upstream) {
            if (event.type === "delta") {
              generatedText += event.text;
              if (generatedText.length > MAX_MESSAGE_LENGTH) {
                throw new OwnerGeminiProviderError("The response exceeded the supported 50,000-character message size.");
              }
              if (generatedText.length - lastPersistedLength >= 1_024 || Date.now() - lastPersistedAt >= 1_000) {
                await updateOwnerAssistantMessage(env, assistantMessage.id, generatedText, "partial");
                lastPersistedLength = generatedText.length;
                lastPersistedAt = Date.now();
              }
              if (!safeEvent("delta", { text: event.text })) {
                abortController.abort();
                break;
              }
            } else {
              finalMessage = await finalize("complete", {
                promptTokens: event.usage.promptTokens,
                outputTokens: event.usage.outputTokens,
                totalTokens: event.usage.totalTokens,
                elapsedMs: event.elapsedMs,
              });
              safeEvent("done", { message: finalMessage, usage: event.usage, elapsedMs: event.elapsedMs });
              completed = true;
              break;
            }
          }
        } catch (error) {
          const stopped = abortController.signal.aborted ||
            (error instanceof OwnerGeminiProviderError && error.message === "Generation was stopped.");
          const status: OwnerIntelligenceMessage["status"] = generatedText ? "partial" : "error";
          finalMessage = await finalize(status);
          if (!stopped) {
            const message = error instanceof OwnerGeminiProviderError
              ? error.message : "The response stream failed. Any received text has been retained.";
            safeEvent("error", { message, partial: Boolean(generatedText) });
          }
        } finally {
          if (!completed && !finalizePromise) {
            finalMessage = await finalize(generatedText ? "partial" : "error");
          }
          request.signal.removeEventListener("abort", abortFromRequest);
          try { controller.close(); } catch { /* the client may have cancelled the stream */ }
        }
      })();
    },
    async cancel() {
      abortController.abort();
      try {
        await finalize(generatedText ? "partial" : "error");
      } finally {
        request.signal.removeEventListener("abort", abortFromRequest);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-content-type-options": "nosniff",
      "x-accel-buffering": "no",
    },
  });
}

export async function handleOwnerIntelligenceApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/admin/api/intelligence/models") {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    return ownerIntelligenceModelsResponse(env);
  }

  const generationMatch = url.pathname.match(/^\/admin\/api\/intelligence\/conversations\/([0-9a-f-]{36})\/generate$/iu);
  if (generationMatch && validConversationId(generationMatch[1])) {
    return handleOwnerGeneration(request, env, generationMatch[1]);
  }

  const root = "/admin/api/intelligence/conversations";
  if (url.pathname === root) {
    if (request.method === "GET") {
      return json({ ok: true, conversations: await listOwnerIntelligenceConversations(env) });
    }
    if (request.method === "POST") {
      if (!isSameOriginMutation(request)) return json({ ok: false, error: "same_origin_required" }, 403);
      const body = await readJsonBody(request);
      if (!body || (body.title !== undefined && typeof body.title !== "string")) {
        return json({ ok: false, error: "invalid_request" }, 400);
      }
      try {
        const conversation = await createOwnerIntelligenceConversation(env, body.title === undefined ? "New chat" : body.title);
        return json({ ok: true, conversation }, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid conversation title.";
        return json({ ok: false, error: "invalid_title", message }, 400);
      }
    }
    return methodNotAllowed(["GET", "POST"]);
  }

  const prefix = root + "/";
  if (!url.pathname.startsWith(prefix)) return notFound();
  const suffix = url.pathname.slice(prefix.length).split("/");
  if ((suffix.length !== 1 && !(suffix.length === 2 && suffix[1] === "messages")) || !validConversationId(suffix[0])) return notFound();
  const id = suffix[0];

  if (suffix.length === 2 && suffix[1] === "messages") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    if (!isSameOriginMutation(request)) return json({ ok: false, error: "same_origin_required" }, 403);
    const body = await readJsonBody(request);
    if (!body || Object.keys(body).length !== 1 || typeof body.content !== "string") {
      return json({ ok: false, error: "invalid_request" }, 400);
    }
    try {
      const message = await appendOwnerIntelligenceMessage(env, {
        conversationId: id,
        role: "user",
        content: body.content,
      });
      return message ? json({ ok: true, message }, 201) : notFound();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid message content.";
      return json({ ok: false, error: "invalid_message", message }, 400);
    }
  }

  if (request.method === "GET") {
    const result = await getOwnerIntelligenceConversation(env, id);
    return result ? json({ ok: true, ...result }) : notFound();
  }
  if (request.method === "PATCH") {
    if (!isSameOriginMutation(request)) return json({ ok: false, error: "same_origin_required" }, 403);
    const body = await readJsonBody(request);
    if (!body || Object.keys(body).length !== 1 || typeof body.title !== "string") {
      return json({ ok: false, error: "invalid_request" }, 400);
    }
    try {
      const conversation = await renameOwnerIntelligenceConversation(env, id, body.title);
      return conversation ? json({ ok: true, conversation }) : notFound();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid conversation title.";
      return json({ ok: false, error: "invalid_title", message }, 400);
    }
  }
  if (request.method === "DELETE") {
    if (!isSameOriginMutation(request)) return json({ ok: false, error: "same_origin_required" }, 403);
    const deleted = await deleteOwnerIntelligenceConversation(env, id);
    return deleted ? json({ ok: true, deleted: true }) : notFound();
  }
  return methodNotAllowed(["GET", "PATCH", "DELETE"]);
}

function workspaceHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#171717">
<title>BRɅIN Intelligence</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#212121;color:#ececec;font-synthesis:none}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{overflow:hidden;background:#212121}button,textarea{font:inherit}button{color:inherit;cursor:pointer}
.app{display:flex;height:100dvh;min-height:480px;background:#212121}
.sidebar{width:274px;flex:0 0 274px;background:#171717;border-right:1px solid #303030;display:flex;flex-direction:column;padding:16px 12px;z-index:5}
.brand{display:flex;align-items:center;gap:10px;padding:7px 8px 20px}.brand-mark{width:34px;height:34px;display:grid;place-items:center;border:1px solid #555;border-radius:11px;color:#fff;font-size:15px;font-weight:700;letter-spacing:-1px}.brand-name{font-size:15px;font-weight:650;letter-spacing:.02em}.brand-sub{color:#8a8a8a;font-size:10px;letter-spacing:.12em;margin-top:3px}
.new-chat{display:flex;align-items:center;gap:10px;width:100%;border:1px solid #454545;background:#242424;border-radius:10px;padding:11px 12px;text-align:left;font-size:13px;font-weight:600}.new-chat:hover{background:#303030}.plus{font-size:19px;font-weight:300;line-height:14px}
.section-label{font-size:10px;color:#858585;text-transform:uppercase;letter-spacing:.13em;padding:23px 9px 9px}
.history{flex:1;overflow:auto;min-height:0}.history-empty{font-size:12px;line-height:1.55;color:#777;padding:10px 9px}.history-item{display:flex;align-items:center;gap:4px;margin:2px 0;border-radius:9px;padding:3px}.history-item.active{background:#303030}.history-item:hover{background:#292929}.history-open{min-width:0;flex:1;border:0;background:none;text-align:left;padding:8px 7px;font-size:12px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:6px}.history-action{border:0;background:transparent;color:#8b8b8b;border-radius:6px;padding:5px 6px;font-size:12px}.history-action:hover{background:#414141;color:#fff}
.side-footer{border-top:1px solid #303030;padding:12px 5px 2px}.owner-note{display:flex;align-items:center;gap:8px;padding:7px 7px 10px;font-size:11px;color:#a1a1a1}.owner-dot{width:7px;height:7px;border-radius:50%;background:#4dba87}.logout{width:100%;border:0;background:transparent;color:#aaa;text-align:left;padding:9px 8px;border-radius:8px;font-size:12px}.logout:hover{background:#292929;color:#fff}
.main{display:flex;flex:1;min-width:0;flex-direction:column;position:relative}.topbar{height:60px;flex:0 0 60px;border-bottom:1px solid #333;display:flex;align-items:center;justify-content:space-between;padding:0 24px;gap:12px}.top-left{display:flex;align-items:center;gap:11px;min-width:0}.mobile-menu{display:none;border:0;background:transparent;font-size:19px;padding:7px}.page-title{font-size:14px;font-weight:600;white-space:nowrap}.private-tag{font-size:10px;color:#9b9b9b;border:1px solid #404040;border-radius:20px;padding:5px 8px}.top-right{display:flex;align-items:center;gap:9px}.model-retry{border:1px solid #555;background:#303030;color:#e5e5e5;border-radius:8px;padding:7px 9px;font-size:10px;cursor:pointer}.model-retry:hover{background:#414141}.model-retry:disabled{opacity:.55;cursor:wait}.model-retry[hidden]{display:none}.model-picker{display:flex;align-items:center;gap:7px;border:1px solid #444;border-radius:9px;background:#252525;padding:6px 9px;min-width:0}.model-label{font-size:9px;color:#888;letter-spacing:.1em}.model-picker select{max-width:178px;min-width:112px;border:0;outline:none;background:transparent;color:#e8e8e8;font-size:11px;font-weight:600}.model-picker select:disabled,.thinking-picker select:disabled{opacity:.65;cursor:default}.thinking-picker{display:flex;align-items:center;gap:7px;border:1px solid #444;border-radius:9px;background:#252525;padding:6px 9px;min-width:0}.thinking-picker select{max-width:110px;min-width:80px;border:0;outline:none;background:transparent;color:#e8e8e8;font-size:11px;font-weight:600}.avatar{width:29px;height:29px;border-radius:50%;display:grid;place-items:center;background:#3d3d3d;color:#f0f0f0;font-size:11px;font-weight:700}
.content{flex:1;overflow:auto;display:flex;justify-content:center;padding:36px 22px 18px}.stage{width:min(820px,100%);min-height:100%;display:flex;flex-direction:column}.conversation-heading{font-size:12px;color:#999;margin:0 0 22px;min-height:18px}.messages{flex:1;display:flex;flex-direction:column;gap:22px;padding-bottom:30px}.welcome{margin:auto auto 50px;width:min(600px,100%);text-align:center}.welcome-mark{width:56px;height:56px;border:1px solid #565656;border-radius:18px;display:grid;place-items:center;margin:0 auto 22px;font-size:22px;font-weight:700;letter-spacing:-2px;background:#282828}.welcome h1{font-size:27px;letter-spacing:-.04em;font-weight:600;margin:0 0 12px}.welcome p{font-size:13px;color:#a0a0a0;line-height:1.7;margin:0 auto;max-width:480px}.next-step{display:inline-flex;margin-top:22px;border:1px solid #464646;border-radius:20px;padding:7px 11px;font-size:10px;color:#aaa;letter-spacing:.02em}
.message{display:flex;gap:14px;align-items:flex-start;max-width:100%;padding:0 5px}.message-avatar{flex:0 0 30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#383838;font-size:10px;font-weight:700}.message-body{min-width:0;flex:1;font-size:14px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere;color:#e4e4e4}.message-role{font-size:10px;color:#929292;margin:0 0 5px;text-transform:uppercase;letter-spacing:.08em}.message-actions{display:flex;gap:7px;margin-top:8px}.message-action{border:1px solid #444;background:transparent;color:#aaa;border-radius:7px;padding:4px 8px;font-size:10px}.message-action:hover{background:#333;color:#fff}.message-status{font-size:10px;color:#a0a0a0;margin-top:6px}
.composer-wrap{padding:12px 0 5px}.composer{border:1px solid #484848;background:#2b2b2b;border-radius:17px;padding:12px 13px 9px;box-shadow:0 8px 30px rgba(0,0,0,.12)}.composer textarea{display:block;width:100%;resize:none;min-height:42px;max-height:130px;outline:none;border:0;background:transparent;color:#aaa;font-size:13px;line-height:1.5}.composer textarea::placeholder{color:#858585}.composer-bottom{display:flex;justify-content:space-between;align-items:center;gap:10px;padding-top:8px}.composer-hint{font-size:10px;color:#848484}.send-action{border:0;background:#ececec;color:#171717;border-radius:10px;width:30px;height:30px;font-size:17px;font-weight:700;cursor:pointer}.send-action:disabled{background:#444;color:#8b8b8b;cursor:not-allowed}.send-action.stop{background:#d7d7d7;color:#171717}.send-action:not(:disabled):hover{background:#fff}.disclaimer{text-align:center;color:#777;font-size:10px;padding:10px 5px 0;line-height:1.5}
.loading{color:#999;font-size:12px;padding:12px 8px}.error{color:#f2a4a4;font-size:12px;padding:12px 8px}
@media(max-width:760px){.sidebar{position:fixed;inset:0 auto 0 0;width:min(300px,86vw);transform:translateX(-101%);transition:transform .2s ease;box-shadow:none}.sidebar.open{transform:translateX(0);box-shadow:20px 0 60px rgba(0,0,0,.35)}.mobile-menu{display:inline-grid;place-items:center}.topbar{padding:0 13px}.content{padding:28px 16px 12px}.welcome h1{font-size:24px}.model-picker,.thinking-picker{padding:6px 7px;gap:4px}.model-label{display:none}.model-picker select{max-width:122px;min-width:80px}.thinking-picker select{max-width:90px;min-width:64px}.private-tag{display:none}.composer-wrap{padding-top:18px}}
@media(max-width:390px){.model-picker{max-width:122px}.model-picker select{max-width:94px;min-width:0}.thinking-picker{max-width:94px}.thinking-picker select{max-width:70px;min-width:0}.page-title{font-size:13px}.avatar{display:none}}
</style>
</head>
<body>
<div class="app">
<aside class="sidebar" id="sidebar" aria-label="Conversation sidebar">
  <div class="brand"><div class="brand-mark">BɅ</div><div><div class="brand-name">BRɅIN</div><div class="brand-sub">INTELLIGENCE · PRIVATE</div></div></div>
  <button class="new-chat" id="newChat" type="button"><span class="plus">＋</span><span>New chat</span></button>
  <div class="section-label">Your conversations</div>
  <div class="history" id="history" aria-live="polite"><div class="loading">Loading conversations…</div></div>
  <div class="side-footer"><div class="owner-note"><span class="owner-dot"></span><span>Owner workspace · Private</span></div><form method="post" action="/admin/logout"><button class="logout" type="submit">↗&nbsp; Sign out</button></form></div>
</aside>
<main class="main">
  <header class="topbar">
    <div class="top-left"><button class="mobile-menu" id="mobileMenu" type="button" aria-label="Open conversations">☰</button><div class="page-title">BRɅIN Intelligence</div><span class="private-tag">OWNER ONLY</span></div>
    <div class="top-right"><label class="model-picker"><span class="model-label">MODEL</span><select id="modelSelect" aria-label="Select Gemini model" disabled><option value="">Checking models…</option></select></label><button class="model-retry" id="modelRetry" type="button" hidden>Retry</button><label class="thinking-picker"><span class="model-label">THINKING</span><select id="thinkingSelect" aria-label="Select thinking level" disabled><option value="">—</option></select></label><div class="avatar" aria-label="Owner">O</div></div>
  </header>
  <section class="content" aria-label="Conversation workspace">
    <div class="stage">
      <div class="conversation-heading" id="conversationHeading"></div>
      <div class="messages" id="messages" aria-live="polite">
        <div class="welcome"><div class="welcome-mark">BɅ</div><h1>Your thinking space.</h1><p>A private workspace for research, reasoning, writing, mathematics, coding and ideas. Your conversations are stored separately from the student learning system.</p><span class="next-step">PRIVATE OWNER WORKSPACE</span></div>
      </div>
      <div class="composer-wrap">
        <div class="composer"><textarea id="messageInput" disabled rows="1" maxlength="50000" placeholder="Write a message…"></textarea><div class="composer-bottom"><span class="composer-hint" id="composerHint">Choose a verified Gemini model and thinking level to begin.</span><button class="send-action" id="sendMessage" type="button" disabled aria-label="Send message">↑</button></div></div>
        <div class="disclaimer">Responses stream from your selected model. Thinking tokens, quotas and billing remain subject to Google Cloud limits.</div>
      </div>
    </div>
  </section>
</main>
</div>
<script nonce="${nonce}">
(function(){
  "use strict";
  var api="/admin/api/intelligence/conversations";
  var state={conversations:[],activeId:null,messages:[],selectedModelId:null,selectedThinkingLevel:null,models:[]};
  var history=document.getElementById("history");
  var messages=document.getElementById("messages");
  var heading=document.getElementById("conversationHeading");
  var sidebar=document.getElementById("sidebar");
  var messageInput=document.getElementById("messageInput");
  var sendButton=document.getElementById("sendMessage");
  var composerHint=document.getElementById("composerHint");
  var modelSelect=document.getElementById("modelSelect");
  var thinkingSelect=document.getElementById("thinkingSelect");
  var modelRetry=document.getElementById("modelRetry");
  var modelLoadInProgress=false;
  var modelLoadMessage="Checking configured Gemini models…";
  var modelLoadController=null;
  var sending=false;
  var activeAbortController=null;
  var editingMessageId=null;
  function node(tag,className,text){var el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
  function errorText(error){return error&&error.message?error.message:"Something went wrong. Please retry.";}
  async function request(path,options){
    var response=await fetch(path,Object.assign({credentials:"same-origin",cache:"no-store"},options||{}));
    var body={};
    try{body=await response.json();}catch(_error){}
    if(!response.ok||body.ok===false){throw new Error(body.message||body.error||("Request failed ("+response.status+")"));}
    return body;
  }
  function populateThinkingLevels(modelId){
    var model=state.models.find(function(item){return item.id===modelId;});
    thinkingSelect.replaceChildren();
    if(!model||!Array.isArray(model.thinkingLevels)||!model.thinkingLevels.length){
      thinkingSelect.appendChild(node("option","","Unavailable"));
      thinkingSelect.disabled=true;state.selectedThinkingLevel=null;return;
    }
    model.thinkingLevels.forEach(function(level){
      var labels={MINIMAL:"Minimal",LOW:"Low",MEDIUM:"Medium",HIGH:"High",XHIGH:"Extra high"};
      var option=node("option","",labels[level]||level);
      option.value=level;thinkingSelect.appendChild(option);
    });
    state.selectedThinkingLevel=model.defaultThinkingLevel||model.thinkingLevels[0];
    thinkingSelect.value=state.selectedThinkingLevel;
    thinkingSelect.disabled=false;
    thinkingSelect.title="Thinking level supported by "+model.label+" · default "+state.selectedThinkingLevel;
  }
  async function loadModels(){
    if(modelLoadInProgress)return;
    modelLoadInProgress=true;
    modelLoadMessage="Checking configured Gemini models…";
    state.models=[];
    state.selectedModelId=null;
    state.selectedThinkingLevel=null;
    modelSelect.replaceChildren(node("option","","Checking models…"));
    modelSelect.disabled=true;
    modelRetry.hidden=true;
    modelRetry.disabled=true;
    thinkingSelect.replaceChildren(node("option","","—"));
    thinkingSelect.disabled=true;
    updateComposer();

    var controller=new AbortController();
    modelLoadController=controller;
    var timeoutId=window.setTimeout(function(){controller.abort();},45000);
    try{
      var response=await fetch("/admin/api/intelligence/models",{
        credentials:"same-origin",
        cache:"no-store",
        signal:controller.signal
      });
      var result={};
      try{result=await response.json();}catch(_error){}
      modelSelect.replaceChildren();
      if(!response.ok||result.ok!==true||!Array.isArray(result.models)){
        var unavailable=node("option","","Vertex AI unavailable");
        unavailable.value="";
        modelSelect.appendChild(unavailable);
        modelSelect.disabled=true;
        modelSelect.title=result.error==="vertex_not_configured"
          ?"Vertex AI credentials or project configuration are missing."
          :"The Vertex AI model catalogue could not be checked. Use Retry to try again.";
        modelLoadMessage=result.error==="vertex_not_configured"
          ?"Vertex AI is not configured for this Owner workspace."
          :"The Gemini model catalogue could not be checked. Retry the model check.";
        modelRetry.hidden=result.error==="vertex_not_configured";
        updateComposer();
        return;
      }
      var available=result.models.filter(function(model){
        return model&&model.selectable===true&&typeof model.id==="string"&&typeof model.label==="string";
      });
      if(!available.length){
        var none=node("option","","No verified models");
        none.value="";
        modelSelect.appendChild(none);
        modelSelect.disabled=true;
        modelSelect.title="No candidate model passed the current project/location check. Verify Google Cloud access, API enablement, region and quotas.";
        modelLoadMessage="No Gemini model passed the project/location check. Retry after checking Google Cloud access.";
        modelRetry.hidden=false;
        updateComposer();
        return;
      }
      available.forEach(function(model){
        var option=node("option","",model.label);
        option.value=model.id;
        modelSelect.appendChild(option);
      });
      state.models=available;
      var preferred=available.find(function(model){return model.id==="gemini-4-hydrogen";})||
        available.find(function(model){return model.id==="gemini-3.8-flash";})||available[0];
      modelSelect.value=preferred.id;
      state.selectedModelId=preferred.id;
      populateThinkingLevels(preferred.id);
      modelSelect.disabled=false;
      modelSelect.title="Project/location verified · "+available.length+" available model(s) · "+String(result.location||"configured location");
      modelRetry.hidden=true;
      modelLoadMessage=null;
      updateComposer();
    }catch(error){
      var timedOut=controller.signal.aborted||(error&&error.name==="AbortError");
      modelSelect.replaceChildren();
      var failed=node("option","",timedOut?"Model check timed out":"Model check unavailable");
      failed.value="";
      modelSelect.appendChild(failed);
      modelSelect.disabled=true;
      modelSelect.title=timedOut
        ?"The model catalogue request exceeded 45 seconds. Retry the check."
        :"Could not reach the private Owner model catalogue. Check the connection and retry.";
      modelRetry.hidden=false;
      modelLoadMessage=timedOut
        ?"The Gemini model check timed out after 45 seconds. Retry the check."
        :"The Gemini model catalogue could not be reached. Retry the check.";
      updateComposer();
    }finally{
      window.clearTimeout(timeoutId);
      if(modelLoadController===controller)modelLoadController=null;
      modelLoadInProgress=false;
      modelRetry.disabled=false;
    }
  }
  function showWelcome(){
    if(!state.activeId)heading.textContent="";
    messages.replaceChildren();
    var welcome=node("div","welcome");
    welcome.appendChild(node("div","welcome-mark","BɅ"));
    welcome.appendChild(node("h1","","Your thinking space."));
    welcome.appendChild(node("p","","A private workspace for research, reasoning, writing, mathematics, coding and ideas. Your conversations are stored separately from the student learning system."));
    welcome.appendChild(node("span","next-step","PRIVATE OWNER WORKSPACE"));
    messages.appendChild(welcome);
    updateComposer();
  }
  function renderMessages(items){
    messages.replaceChildren();
    if(!items.length){showWelcome();return;}
    items.forEach(function(item,index){
      var wrap=node("article","message");
      wrap.appendChild(node("div","message-avatar",item.role==="assistant"?"BɅ":item.role==="system"?"·":"O"));
      var body=node("div","message-body");
      var roleLabel=item.role;
      if(item.role==="assistant"&&item.model_id){
        var model=state.models.find(function(entry){return entry.id===item.model_id;});
        roleLabel=(model?model.label:item.model_id)+" · "+String(item.thinking_level||"");
      }
      body.appendChild(node("div","message-role",roleLabel));
      body.appendChild(node("div","",item.content|| (item.status==="pending"?"Generating…":"")));
      if(item.status==="pending")body.appendChild(node("div","message-status","Generating response…"));
      else if(item.status==="partial")body.appendChild(node("div","message-status","Stopped · partial response saved"));
      else if(item.status==="error")body.appendChild(node("div","message-status","Generation failed"));
      if(item.role==="user"&&!sending){
        var edit=node("button","message-action","Edit");
        edit.type="button";edit.addEventListener("click",function(){
          editingMessageId=item.id;messageInput.value=item.content;messageInput.focus();updateComposer();
        });
        var actions=node("div","message-actions");actions.appendChild(edit);body.appendChild(actions);
      }else if(item.role==="assistant"&&item.status!=="pending"&&!sending&&index===items.length-1){
        var retry=node("button","message-action","Regenerate");
        retry.type="button";retry.addEventListener("click",function(){generateMessage({action:"regenerate"});});
        var actions2=node("div","message-actions");actions2.appendChild(retry);body.appendChild(actions2);
      }
      wrap.appendChild(body);messages.appendChild(wrap);
    });
  }
  function renderHistory(){
    history.replaceChildren();
    if(!state.conversations.length){history.appendChild(node("div","history-empty","Your saved conversations will appear here."));return;}
    state.conversations.forEach(function(conversation){
      var row=node("div","history-item"+(conversation.id===state.activeId?" active":""));
      var open=node("button","history-open",conversation.title);
      open.type="button";open.title=conversation.title;
      open.addEventListener("click",function(){openConversation(conversation.id);sidebar.classList.remove("open");});
      row.appendChild(open);
      var rename=node("button","history-action","✎");rename.type="button";rename.setAttribute("aria-label","Rename "+conversation.title);rename.title="Rename";
      rename.addEventListener("click",function(){renameConversation(conversation);});
      row.appendChild(rename);
      var remove=node("button","history-action","×");remove.type="button";remove.setAttribute("aria-label","Delete "+conversation.title);remove.title="Delete";
      remove.addEventListener("click",function(){deleteConversation(conversation);});
      row.appendChild(remove);history.appendChild(row);
    });
  }
  async function refreshList(preferredId){
    var result=await request(api);
    state.conversations=result.conversations||[];
    if(preferredId){state.activeId=preferredId;}
    else if(!state.conversations.some(function(item){return item.id===state.activeId;})){state.activeId=state.conversations.length?state.conversations[0].id:null;}
    renderHistory();
    if(state.activeId){await openConversation(state.activeId);}
    else{state.messages=[];showWelcome();}
  }
  async function openConversation(id){
    var result=await request(api+"/"+encodeURIComponent(id));
    state.activeId=result.conversation.id;state.messages=result.messages||[];
    heading.textContent=result.conversation.title;
    renderHistory();renderMessages(state.messages);
    updateComposer();
  }
  function updateComposer(){
    var hasText=messageInput.value.trim().length>0;
    var canGenerate=Boolean(state.activeId&&state.selectedModelId&&state.selectedThinkingLevel);
    sendButton.disabled=sending?false:(!canGenerate||!hasText);
    sendButton.textContent=sending?"■":"↑";
    sendButton.classList.toggle("stop",sending);
    sendButton.setAttribute("aria-label",sending?"Stop generation":"Send message");
    messageInput.disabled=!state.activeId||sending;
    modelSelect.disabled=sending||!state.models.length;
    thinkingSelect.disabled=sending||!state.selectedThinkingLevel;
    composerHint.textContent=sending
      ?"Generating with "+state.selectedModelId+" · "+state.selectedThinkingLevel+" · select Stop to keep the partial answer"
      :modelLoadMessage?modelLoadMessage
      :editingMessageId?"Editing a previous message · sending will replace it and remove later turns"
      :"Your selected model and thinking level will be used for this response.";
  }

  function stopGeneration(){
    if(activeAbortController)activeAbortController.abort();
  }

  function updateStreamingMessage(messageId,update){
    var item=state.messages.find(function(entry){return entry.id===messageId;});
    if(!item){item=update;state.messages.push(item);}
    else Object.keys(update).forEach(function(key){item[key]=update[key];});
    renderMessages(state.messages);
  }

  function handleStreamBlock(block,messageId){
    var eventName="message";
    var dataLines=[];
    block.split(/\r?\n/u).forEach(function(line){
      if(line.indexOf("event:")===0)eventName=line.slice(6).trim();
      else if(line.indexOf("data:")===0)dataLines.push(line.slice(5).trim());
    });
    if(!dataLines.length)return;
    var data;
    try{data=JSON.parse(dataLines.join("\n"));}catch(_error){throw new Error("The response stream returned invalid data.");}
    if(eventName==="meta"){
      if(data.message)updateStreamingMessage(data.message.id,data.message);
    }else if(eventName==="delta"){
      var item=state.messages.find(function(entry){return entry.id===messageId;})||
        state.messages.slice().reverse().find(function(entry){return entry.role==="assistant"&&entry.status==="pending";});
      if(item){item.content=(item.content||"")+String(data.text||"");renderMessages(state.messages);}
    }else if(eventName==="done"){
      if(data.message)updateStreamingMessage(data.message.id,data.message);
    }else if(eventName==="error"){
      var target=state.messages.find(function(entry){return entry.id===messageId;});
      if(target){target.status=data.partial?"partial":"error";renderMessages(state.messages);}
      throw new Error(data.message||"Generation failed.");
    }
  }

  async function generateMessage(options){
    options=options||{};
    if(sending||!state.activeId||!state.selectedModelId||!state.selectedThinkingLevel)return;
    var content=messageInput.value.trim();
    if(!options.action&&!content)return;
    var conversationId=state.activeId;
    var requestBody={modelId:state.selectedModelId,thinkingLevel:state.selectedThinkingLevel};
    if(options.action)requestBody.action=options.action;
    else{
      requestBody.content=content;
      if(editingMessageId)requestBody.editMessageId=editingMessageId;
    }
    sending=true;activeAbortController=new AbortController();updateComposer();
    var assistantId=null;
    try{
      var response=await fetch(api+"/"+encodeURIComponent(conversationId)+"/generate",{
        method:"POST",
        credentials:"same-origin",
        cache:"no-store",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(requestBody),
        signal:activeAbortController.signal
      });
      if(!response.ok){
        var failure={};try{failure=await response.json();}catch(_error){}
        throw new Error(failure.message||failure.error||("Generation request failed ("+response.status+")"));
      }
      await openConversation(conversationId);
      var pending=state.messages.slice().reverse().find(function(item){return item.role==="assistant"&&item.status==="pending";});
      assistantId=pending?pending.id:null;
      if(!response.body)throw new Error("The streaming response body is unavailable.");
      var reader=response.body.getReader();
      var decoder=new TextDecoder();
      var buffer="";
      function consume(block){handleStreamBlock(block,assistantId);}
      while(true){
        var next=await reader.read();
        buffer+=decoder.decode(next.value,{stream:!next.done});
        var boundary=/\r?\n\r?\n/u.exec(buffer);
        while(boundary){
          var block=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length);consume(block);
          boundary=/\r?\n\r?\n/u.exec(buffer);
        }
        if(next.done)break;
      }
      if(buffer.trim())consume(buffer);
      await reader.cancel().catch(function(){});
    }catch(error){
      if(!(error&&error.name==="AbortError")){
        if(error&&error.message)showError(error);
      }
    }finally{
      sending=false;activeAbortController=null;editingMessageId=null;
      messageInput.value="";
      try{await refreshList(conversationId);}catch(_error){}
      updateComposer();
    }
  }

  function saveMessage(){return generateMessage({});}

  async function newConversation(){
    try{
      var result=await request(api,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:"New chat"})});
      await refreshList(result.conversation.id);
      sidebar.classList.remove("open");
    }catch(error){showError(error);}
  }
  async function renameConversation(conversation){
    var title=window.prompt("Rename conversation",conversation.title);
    if(title===null)return;
    try{
      await request(api+"/"+encodeURIComponent(conversation.id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({title:title})});
      await refreshList(conversation.id);
    }catch(error){showError(error);}
  }
  async function deleteConversation(conversation){
    if(!window.confirm("Delete this conversation and its saved messages? This cannot be undone."))return;
    try{
      await request(api+"/"+encodeURIComponent(conversation.id),{method:"DELETE"});
      if(state.activeId===conversation.id)state.activeId=null;
      await refreshList();
    }catch(error){showError(error);}
  }
  function showError(error){
    var notice=node("div","error",errorText(error));
    messages.replaceChildren(notice);
  }
  document.getElementById("newChat").addEventListener("click",newConversation);
  document.getElementById("mobileMenu").addEventListener("click",function(){sidebar.classList.toggle("open");});
  sendButton.addEventListener("click",function(){if(sending)stopGeneration();else saveMessage();});
  messageInput.addEventListener("input",updateComposer);
  messageInput.addEventListener("keydown",function(event){
    if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();if(sending)return;saveMessage();}
  });
  modelSelect.addEventListener("change",function(){
    state.selectedModelId=modelSelect.value||null;
    populateThinkingLevels(state.selectedModelId);
    updateComposer();
  });
  thinkingSelect.addEventListener("change",function(){
    state.selectedThinkingLevel=thinkingSelect.value||null;
    updateComposer();
  });
  modelRetry.addEventListener("click",function(){loadModels();});
  loadModels();
  refreshList().catch(showError);
})();
</script>
</body>
</html>`;
}

export async function ownerIntelligencePage(env: Env): Promise<Response> {
  await ensureOwnerIntelligenceSchema(env);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = Array.from(nonceBytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const content = workspaceHtml(nonce);
  return new Response(content, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
