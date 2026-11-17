import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../config/env";
import { json, methodNotAllowed, notFound } from "../http/response";
import { ownerIntelligenceModelsResponse } from "./intelligence-provider";

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
  const title = value.replace(/\\s+/gu, " ").trim();
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
    "SELECT id, conversation_id, owner_id, role, content, status, created_at FROM owner_intelligence_messages WHERE conversation_id = ? AND owner_id = ? ORDER BY created_at ASC, id ASC",
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
  input: { conversationId: string; role: OwnerIntelligenceMessage["role"]; content: string; status?: OwnerIntelligenceMessage["status"] },
): Promise<OwnerIntelligenceMessage | null> {
  await ensureOwnerIntelligenceSchema(env);
  if (typeof input.content !== "string" || input.content.length === 0 || input.content.length > MAX_MESSAGE_LENGTH) {
    throw new Error("Message content must contain between 1 and 50,000 characters.");
  }
  const ownerId = ownerPrincipal(env);
  const conversation = await env.DB!.prepare(
    "SELECT id FROM owner_intelligence_conversations WHERE id = ? AND owner_id = ?",
  ).bind(input.conversationId, ownerId).first<{ id: string }>();
  if (!conversation) return null;

  const message: OwnerIntelligenceMessage = {
    id: crypto.randomUUID(),
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    status: input.status ?? "complete",
    created_at: Date.now(),
  };
  const results = await env.DB!.batch([
    env.DB!.prepare(
      "INSERT INTO owner_intelligence_messages (id, conversation_id, owner_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(message.id, message.conversation_id, ownerId, message.role, message.content, message.status, message.created_at),
    env.DB!.prepare(
      "UPDATE owner_intelligence_conversations SET updated_at = ? WHERE id = ? AND owner_id = ?",
    ).bind(message.created_at, input.conversationId, ownerId),
  ]);
  if (results.some((result) => !result.success)) throw new Error("D1 did not confirm the message save.");
  return message;
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
  if (length > 52_000) return null;
  const raw = await request.text();
  if (raw.length > 52_000) return null;
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

export async function handleOwnerIntelligenceApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/admin/api/intelligence/models") {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    return ownerIntelligenceModelsResponse(env);
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
.main{display:flex;flex:1;min-width:0;flex-direction:column;position:relative}.topbar{height:60px;flex:0 0 60px;border-bottom:1px solid #333;display:flex;align-items:center;justify-content:space-between;padding:0 24px;gap:12px}.top-left{display:flex;align-items:center;gap:11px;min-width:0}.mobile-menu{display:none;border:0;background:transparent;font-size:19px;padding:7px}.page-title{font-size:14px;font-weight:600;white-space:nowrap}.private-tag{font-size:10px;color:#9b9b9b;border:1px solid #404040;border-radius:20px;padding:5px 8px}.top-right{display:flex;align-items:center;gap:9px}.model-picker{display:flex;align-items:center;gap:7px;border:1px solid #444;border-radius:9px;background:#252525;padding:6px 9px;min-width:0}.model-label{font-size:9px;color:#888;letter-spacing:.1em}.model-picker select{max-width:178px;min-width:112px;border:0;outline:none;background:transparent;color:#e8e8e8;font-size:11px;font-weight:600}.model-picker select:disabled{opacity:.65;cursor:default}.avatar{width:29px;height:29px;border-radius:50%;display:grid;place-items:center;background:#3d3d3d;color:#f0f0f0;font-size:11px;font-weight:700}
.content{flex:1;overflow:auto;display:flex;justify-content:center;padding:36px 22px 18px}.stage{width:min(820px,100%);min-height:100%;display:flex;flex-direction:column}.conversation-heading{font-size:12px;color:#999;margin:0 0 22px;min-height:18px}.messages{flex:1;display:flex;flex-direction:column;gap:22px;padding-bottom:30px}.welcome{margin:auto auto 50px;width:min(600px,100%);text-align:center}.welcome-mark{width:56px;height:56px;border:1px solid #565656;border-radius:18px;display:grid;place-items:center;margin:0 auto 22px;font-size:22px;font-weight:700;letter-spacing:-2px;background:#282828}.welcome h1{font-size:27px;letter-spacing:-.04em;font-weight:600;margin:0 0 12px}.welcome p{font-size:13px;color:#a0a0a0;line-height:1.7;margin:0 auto;max-width:480px}.next-step{display:inline-flex;margin-top:22px;border:1px solid #464646;border-radius:20px;padding:7px 11px;font-size:10px;color:#aaa;letter-spacing:.02em}
.message{display:flex;gap:14px;align-items:flex-start;max-width:100%;padding:0 5px}.message-avatar{flex:0 0 30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#383838;font-size:10px;font-weight:700}.message-body{min-width:0;flex:1;font-size:14px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere;color:#e4e4e4}.message-role{font-size:10px;color:#929292;margin:0 0 5px;text-transform:uppercase;letter-spacing:.08em}
.composer-wrap{padding:12px 0 5px}.composer{border:1px solid #484848;background:#2b2b2b;border-radius:17px;padding:12px 13px 9px;box-shadow:0 8px 30px rgba(0,0,0,.12)}.composer textarea{display:block;width:100%;resize:none;min-height:42px;max-height:130px;outline:none;border:0;background:transparent;color:#aaa;font-size:13px;line-height:1.5}.composer textarea::placeholder{color:#858585}.composer-bottom{display:flex;justify-content:space-between;align-items:center;gap:10px;padding-top:8px}.composer-hint{font-size:10px;color:#848484}.send-action{border:0;background:#ececec;color:#171717;border-radius:10px;width:30px;height:30px;font-size:17px;font-weight:700;cursor:pointer}.send-action:disabled{background:#444;color:#8b8b8b;cursor:not-allowed}.send-action:not(:disabled):hover{background:#fff}.disclaimer{text-align:center;color:#777;font-size:10px;padding:10px 5px 0;line-height:1.5}
.loading{color:#999;font-size:12px;padding:12px 8px}.error{color:#f2a4a4;font-size:12px;padding:12px 8px}
@media(max-width:760px){.sidebar{position:fixed;inset:0 auto 0 0;width:min(300px,86vw);transform:translateX(-101%);transition:transform .2s ease;box-shadow:none}.sidebar.open{transform:translateX(0);box-shadow:20px 0 60px rgba(0,0,0,.35)}.mobile-menu{display:inline-grid;place-items:center}.topbar{padding:0 13px}.content{padding:28px 16px 12px}.welcome h1{font-size:24px}.model-picker{padding:6px 7px;gap:4px}.model-label{display:none}.model-picker select{max-width:132px;min-width:90px}.private-tag{display:none}.composer-wrap{padding-top:18px}}
@media(max-width:390px){.model-picker{max-width:146px}.model-picker select{max-width:112px;min-width:0}.page-title{font-size:13px}.avatar{display:none}}
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
    <div class="top-right"><label class="model-picker"><span class="model-label">MODEL</span><select id="modelSelect" aria-label="Select Gemini model" disabled><option value="">Checking models…</option></select></label><div class="avatar" aria-label="Owner">O</div></div>
  </header>
  <section class="content" aria-label="Conversation workspace">
    <div class="stage">
      <div class="conversation-heading" id="conversationHeading"></div>
      <div class="messages" id="messages" aria-live="polite">
        <div class="welcome"><div class="welcome-mark">BɅ</div><h1>Your thinking space.</h1><p>A private workspace for research, reasoning, writing, mathematics, coding and ideas. Your conversations are stored separately from the student learning system.</p><span class="next-step">PRIVATE OWNER WORKSPACE</span></div>
      </div>
      <div class="composer-wrap">
        <div class="composer"><textarea id="messageInput" disabled rows="1" maxlength="50000" placeholder="Write a message…"></textarea><div class="composer-bottom"><span class="composer-hint" id="composerHint">Messages are saved privately. Gemini replies arrive in the next model milestones.</span><button class="send-action" id="sendMessage" type="button" disabled aria-label="Save message">↑</button></div></div>
        <div class="disclaimer">Models appear only after the configured Vertex AI project and location pass a live capability check. AI responses arrive in the next milestone.</div>
      </div>
    </div>
  </section>
</main>
</div>
<script nonce="${nonce}">
(function(){
  "use strict";
  var api="/admin/api/intelligence/conversations";
  var state={conversations:[],activeId:null,messages:[],selectedModelId:null};
  var history=document.getElementById("history");
  var messages=document.getElementById("messages");
  var heading=document.getElementById("conversationHeading");
  var sidebar=document.getElementById("sidebar");
  var messageInput=document.getElementById("messageInput");
  var sendButton=document.getElementById("sendMessage");
  var composerHint=document.getElementById("composerHint");
  var modelSelect=document.getElementById("modelSelect");
  var sending=false;
  function node(tag,className,text){var el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
  function errorText(error){return error&&error.message?error.message:"Something went wrong. Please retry.";}
  async function request(path,options){
    var response=await fetch(path,Object.assign({credentials:"same-origin",cache:"no-store"},options||{}));
    var body={};
    try{body=await response.json();}catch(_error){}
    if(!response.ok||body.ok===false){throw new Error(body.message||body.error||("Request failed ("+response.status+")"));}
    return body;
  }
  async function loadModels(){
    try{
      var response=await fetch("/admin/api/intelligence/models",{credentials:"same-origin",cache:"no-store"});
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
          :"The Vertex AI model catalogue could not be checked. Refresh to retry.";
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
        return;
      }
      available.forEach(function(model){
        var option=node("option","",model.label);
        option.value=model.id;
        modelSelect.appendChild(option);
      });
      var preferred=available.find(function(model){return model.id==="gemini-4-hydrogen";})||
        available.find(function(model){return model.id==="gemini-3.8-flash";})||available[0];
      modelSelect.value=preferred.id;
      state.selectedModelId=preferred.id;
      modelSelect.disabled=false;
      modelSelect.title="Project/location verified · "+available.length+" available model(s) · "+String(result.location||"configured location")+". Selection is ready for the next model milestone.";
      modelSelect.addEventListener("change",function(){
        state.selectedModelId=modelSelect.value||null;
      });
    }catch(_error){
      modelSelect.replaceChildren();
      var failed=node("option","","Model check unavailable");
      failed.value="";
      modelSelect.appendChild(failed);
      modelSelect.disabled=true;
      modelSelect.title="Could not reach the private Owner model catalogue. Refresh to retry.";
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
    items.forEach(function(item){
      var wrap=node("article","message");
      wrap.appendChild(node("div","message-avatar",item.role==="assistant"?"BɅ":item.role==="system"?"·":"O"));
      var body=node("div","message-body");
      body.appendChild(node("div","message-role",item.role));
      body.appendChild(node("div","",item.content));
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
    sendButton.disabled=sending||!state.activeId||!hasText;
    messageInput.disabled=!state.activeId||sending;
    composerHint.textContent=sending?"Saving your message…":"Messages are saved privately. AI replies arrive in the next milestone.";
  }
  async function saveMessage(){
    var content=messageInput.value.trim();
    if(!content||!state.activeId||sending)return;
    sending=true;updateComposer();
    try{
      var result=await request(api+"/"+encodeURIComponent(state.activeId)+"/messages",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({content:content})
      });
      state.messages.push(result.message);
      messageInput.value="";
      renderMessages(state.messages);
      await refreshList(state.activeId);
    }catch(error){showError(error);}
    finally{sending=false;updateComposer();}
  }
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
  sendButton.addEventListener("click",saveMessage);
  messageInput.addEventListener("input",updateComposer);
  messageInput.addEventListener("keydown",function(event){
    if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();saveMessage();}
  });
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
