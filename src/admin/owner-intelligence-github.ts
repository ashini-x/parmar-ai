import type { Env } from "../config/env";
import { ensureOwnerIntelligenceSchema } from "./intelligence";
import { json, methodNotAllowed, notFound } from "../http/response";

const API = "https://api.github.com";
const PERMISSIONS = { metadata: "read", contents: "write" };
const FILE_LIMIT = 50000;
const TOTAL_LIMIT = 160000;
const ready = new WeakSet<object>();

type AppRow = {
  owner_id: string; app_id: number; slug: string; name: string; private_key_ciphertext: string;
  installation_id: number | null; installation_account: string | null; repository_selection: string | null;
};
type PreviewRow = {
  id: string; owner_id: string; conversation_id: string; topic_id: string; topic_title: string; topic_slug: string;
  repository_owner: string; repository_name: string; repository_id: number; branch: string; memory_root: string;
  base_commit_sha: string; files_json: string; status: string; commit_sha: string | null; expires_at: number;
};
type FileDraft = { name: string; content: string };
type Bundle = { appId: number; slug: string; name: string; privateKey: string; installationId: number };
class GitHubError extends Error { constructor(readonly status: number) { super("GitHub API error"); } }
function hasLeastPermissions(value: Record<string, string> | undefined): boolean {
  return Boolean(value && value.metadata === "read" && value.contents === "write" &&
    Object.keys(value).every((key) => key === "metadata" || key === "contents"));
}

function owner(env: Env): string {
  const value = env.OWNER_DASHBOARD_USER?.trim().toLowerCase();
  if (!value) throw new Error("Owner principal is not configured.");
  return value;
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin && request.headers.get("Sec-Fetch-Site") !== "cross-site"; }
  catch { return false; }
}
function clean(value: unknown, max = 200): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
function repoName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(value);
}
function branchName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 180 &&
    /^[A-Za-z0-9._/-]+$/u.test(value) && !value.startsWith("/") && !value.endsWith("/") &&
    !value.includes("..") && !value.includes("//") && !value.endsWith(".lock") && !value.includes("@{");
}
async function readBody(request: Request, max = 180000): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("Content-Length") || 0) > max) return null;
  const text = await request.text();
  if (text.length > max) return null;
  try {
    const data: unknown = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch { return null; }
}
async function ensureSchema(env: Env): Promise<void> {
  await ensureOwnerIntelligenceSchema(env);
  const db = env.DB;
  if (!db) throw new Error("Owner D1 is unavailable.");
  if (ready.has(db)) return;
  const results = await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS owner_intelligence_github_app (owner_id TEXT PRIMARY KEY,app_id INTEGER NOT NULL,slug TEXT NOT NULL,name TEXT NOT NULL,private_key_ciphertext TEXT NOT NULL,installation_id INTEGER,installation_account TEXT,repository_selection TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS owner_intelligence_github_states (state_hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL,purpose TEXT NOT NULL,payload_json TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_owner_intelligence_github_states_expiry ON owner_intelligence_github_states(owner_id,expires_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS owner_intelligence_github_previews (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,conversation_id TEXT NOT NULL,topic_id TEXT NOT NULL,topic_title TEXT NOT NULL,topic_slug TEXT NOT NULL,repository_owner TEXT NOT NULL,repository_name TEXT NOT NULL,repository_id INTEGER NOT NULL,branch TEXT NOT NULL,memory_root TEXT NOT NULL,base_commit_sha TEXT NOT NULL,files_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ready',commit_sha TEXT,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_owner_intelligence_github_previews_owner ON owner_intelligence_github_previews(owner_id,created_at DESC)")
  ]);
  if (results.some((result) => !result.success)) throw new Error("Owner GitHub schema could not be initialized.");
  ready.add(db);
}
function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}
function fromB64(value: string): Uint8Array {
  const binary = atob(value.replace(/-/gu, "+").replace(/_/gu, "/"));
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
  return output;
}
function buffer(bytes: Uint8Array): ArrayBuffer { const output = new Uint8Array(bytes.length); output.set(bytes); return output.buffer; }
async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function stateHash(value: string): Promise<string> {
  return Array.from(await digest(value)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function secret(env: Env): string {
  const value = env.ADMIN_SESSION_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("Owner session secret is not configured for secure GitHub credential storage.");
  return value;
}
async function aesKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", buffer(await digest("Owner Gemini Intelligence GitHub App v1\0" + secret(env))), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptKey(env: Env, privateKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buffer(iv), additionalData: buffer(new TextEncoder().encode("owner-intelligence-github:v1")) },
    await aesKey(env), buffer(new TextEncoder().encode(privateKey))
  );
  return b64url(iv) + "." + b64url(new Uint8Array(cipher));
}
async function decryptKey(env: Env, value: string): Promise<string> {
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("Owner GitHub key is unavailable.");
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buffer(fromB64(parts[0])), additionalData: buffer(new TextEncoder().encode("owner-intelligence-github:v1")) },
    await aesKey(env), buffer(fromB64(parts[1]))
  );
  return new TextDecoder().decode(clear);
}
async function createState(env: Env, purpose: "manifest" | "installation"): Promise<string> {
  await ensureSchema(env);
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB!.prepare("INSERT INTO owner_intelligence_github_states (state_hash,owner_id,purpose,payload_json,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .bind(await stateHash(token), owner(env), purpose, "{}", now + 30 * 60_000, now).run();
  return token;
}
async function consumeState(env: Env, purpose: string, token: string): Promise<string | null> {
  if (token.length < 32 || token.length > 128) return null;
  const row = await env.DB!.prepare("DELETE FROM owner_intelligence_github_states WHERE state_hash=? AND purpose=? AND expires_at>? RETURNING owner_id")
    .bind(await stateHash(token), purpose, Date.now()).first<{ owner_id: string }>();
  return row && row.owner_id === owner(env) ? row.owner_id : null;
}
async function getApp(env: Env): Promise<AppRow | null> {
  await ensureSchema(env);
  return env.DB!.prepare("SELECT * FROM owner_intelligence_github_app WHERE owner_id=?").bind(owner(env)).first<AppRow>();
}
async function api<T>(path: string, token?: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(API + path, {
    method,
    cache: "no-store",
    headers: {
      accept: "application/vnd.github+json", "user-agent": "Owner-Gemini-Intelligence",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(data === undefined ? {} : { "content-type": "application/json" })
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  const text = await response.text();
  let result: unknown = {};
  try { result = text ? JSON.parse(text) : {}; } catch { result = {}; }
  if (!response.ok) throw new GitHubError(response.status);
  return result as T;
}
function derLength(length: number): Uint8Array {
  if (length < 128) return new Uint8Array([length]);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) { bytes.unshift(value & 255); value >>>= 8; }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}
function der(tag: number, content: Uint8Array): Uint8Array {
  const length = derLength(content.length);
  const output = new Uint8Array(1 + length.length + content.length);
  output[0] = tag; output.set(length, 1); output.set(content, 1 + length.length);
  return output;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function pkcs8(pem: string): Uint8Array {
  const raw = fromB64(pem.replace(/-----BEGIN [^-]+-----/gu, "").replace(/-----END [^-]+-----/gu, "").replace(/\s/gu, ""));
  if (pem.includes("BEGIN PRIVATE KEY")) return raw;
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) throw new Error("Unsupported GitHub private-key format.");
  const algorithm = new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
  return der(0x30, concat(new Uint8Array([0x02,0x01,0x00]), algorithm, der(0x04, raw)));
}
async function appJwt(value: Bundle): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", buffer(pkcs8(value.privateKey)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ iat: now - 30, exp: now + 8 * 60, iss: value.appId })));
  const unsigned = header + "." + payload;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, buffer(new TextEncoder().encode(unsigned))));
  return unsigned + "." + b64url(signature);
}
async function getBundle(env: Env): Promise<Bundle> {
  const row = await getApp(env);
  if (!row) throw new Error("Create the dedicated Owner GitHub App first.");
  if (!row.installation_id) throw new Error("Install the Owner GitHub App on selected repositories first.");
  const value: Bundle = {
    appId: row.app_id, slug: row.slug, name: row.name,
    privateKey: await decryptKey(env, row.private_key_ciphertext), installationId: row.installation_id
  };
  const [app, installation] = await Promise.all([
    appApi<{ id?: number; permissions?: Record<string, string> }>(value, "/app"),
    appApi<{ id?: number; app_id?: number; permissions?: Record<string, string>; repository_selection?: string }>(
      value, "/app/installations/" + row.installation_id
    )
  ]);
  if (Number(app.id) !== row.app_id || !hasLeastPermissions(app.permissions) ||
      Number(installation.id) !== row.installation_id || Number(installation.app_id) !== row.app_id ||
      !hasLeastPermissions(installation.permissions) || installation.repository_selection !== "selected") {
    throw new Error("The dedicated Owner GitHub App or its installation no longer matches the required selected-repository, Metadata: read and Contents: write boundary. Review the App settings and reconnect.");
  }
  return value;
}
async function appApi<T>(value: Bundle, path: string, method = "GET", data?: unknown): Promise<T> {
  return api<T>(path, await appJwt(value), method, data);
}
async function installationToken(value: Bundle, repositoryId?: number): Promise<string> {
  const result = await appApi<{ token?: string }>(
    value, "/app/installations/" + value.installationId + "/access_tokens", "POST",
    repositoryId ? { repository_ids: [repositoryId] } : {}
  );
  if (!result.token) throw new Error("GitHub did not issue an installation token.");
  return result.token;
}
type Repo = { id: number; fullName: string; owner: string; name: string; defaultBranch: string; private: boolean };
async function getRepositories(value: Bundle): Promise<Repo[]> {
  const token = await installationToken(value);
  const result = await api<{ repositories?: Array<Record<string, unknown>> }>("/installation/repositories?per_page=100", token);
  return (result.repositories || []).map((item) => {
    const account = item.owner && typeof item.owner === "object" ? item.owner as Record<string, unknown> : {};
    return { id: Number(item.id), fullName: clean(item.full_name), owner: clean(account.login), name: clean(item.name), defaultBranch: clean(item.default_branch), private: item.private === true };
  }).filter((item) => Number.isSafeInteger(item.id) && item.id > 0 && item.fullName && item.defaultBranch && item.fullName.includes("/"));
}
function gitPath(path: string): string { return path.split("/").map(encodeURIComponent).join("/"); }
function gitBranch(branch: string): string { return branch.split("/").map(encodeURIComponent).join("/"); }
async function branchHead(token: string, repo: string, branch: string): Promise<string> {
  const result = await api<{ object?: { sha?: string } }>("/repos/" + repo + "/git/ref/heads/" + gitBranch(branch), token);
  const sha = clean(result.object?.sha, 64);
  if (!/^[a-f0-9]{40}$/iu.test(sha)) throw new GitHubError(502);
  return sha;
}
function decodeContent(value: string): string {
  const raw = atob(value.replace(/\s/gu, ""));
  const bytes = new Uint8Array(raw.length);
  for (let i=0;i<raw.length;i+=1) bytes[i]=raw.charCodeAt(i);
  return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
async function readFile(token:string,repo:string,path:string,branch:string):Promise<string|null>{
  try{
    const result=await api<{type?:string;encoding?:string;content?:string}>("/repos/"+repo+"/contents/"+gitPath(path)+"?ref="+encodeURIComponent(branch),token);
    if(result.type!=="file"||result.encoding!=="base64"||typeof result.content!=="string")throw new Error("Memory path is not a Markdown file.");
    return decodeContent(result.content);
  }catch(error){if(error instanceof GitHubError&&error.status===404)return null;throw error;}
}
function projectSlug(title:string,id:string):string{
  const base=title.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/gu,"").replace(/[^a-z0-9]+/gu,"-").replace(/^-+|-+$/gu,"").slice(0,36)||"project";
  return base+"-"+id.slice(0,8);
}
async function loadConversation(env:Env,id:string){
  const conversation=await env.DB!.prepare("SELECT id,title,topic_id FROM owner_intelligence_conversations WHERE id=? AND owner_id=? AND lifecycle_status='active'")
    .bind(id,owner(env)).first<{id:string;title:string;topic_id:string|null}>();
  if(!conversation)return null;
  const messages=await env.DB!.prepare("SELECT id,role,content,status,created_at FROM owner_intelligence_messages WHERE conversation_id=? AND owner_id=? ORDER BY created_at ASC,id ASC")
    .bind(id,owner(env)).all<{id:string;role:string;content:string;status:string;created_at:number}>();
  return {...conversation,messages:messages.results||[]};
}
async function loadTopic(env:Env,id:string){
  return env.DB!.prepare("SELECT id,title,slug,repository_owner,repository_name,repository_branch,memory_root FROM owner_intelligence_topics WHERE id=? AND owner_id=? AND lifecycle_status='active'")
    .bind(id,owner(env)).first<{id:string;title:string;slug:string;repository_owner:string|null;repository_name:string|null;repository_branch:string|null;memory_root:string|null}>();
}
function progressContent(existing:string,conversationId:string,messages:Array<{id:string;role:string;status:string}>):string{
  const marker="<!-- owner-intelligence-conversation-"+conversationId+":start -->";
  const old=existing.includes(marker)?existing.slice(0,existing.indexOf(marker)).trim():existing.trim();
  const userMessage=[...messages].reverse().find((m)=>m.role==="user");
  const assistantMessage=[...messages].reverse().find((m)=>m.role==="assistant"&&(m.status==="complete"||m.status==="partial"));
  const section=["## Latest conversation checkpoint","",
    "Conversation: "+conversationId,
    userMessage?"- Latest Owner message: "+userMessage.id:"- No Owner message available.",
    assistantMessage?"- Latest assistant message: "+assistantMessage.id+" ("+assistantMessage.status+")":"- No completed assistant message available.",
    "","Review this checkpoint. It links to D1 transcript records and is not a complete conversation summary."
  ].join("\n");
  return [old||"# Progress",marker,section,"<!-- owner-intelligence-conversation-"+conversationId+":end -->"].join("\n\n")+"\n";
}
async function createFiles(token:string,repo:string,branch:string,root:string,title:string,conversationId:string,messages:Array<{id:string;role:string;content:string;status:string}>):Promise<FileDraft[]>{
  const names=["index.md","project-memory.md","progress.md","decisions.md"],previous=new Map<string,string|null>();
  for(const name of names)previous.set(name,await readFile(token,repo,root+"/"+name,branch));
  const index=previous.get("index.md")||[
    "# Project memory index","","## Active memory","",
    "- project-memory.md — stable goals, architecture and constraints",
    "- progress.md — current progress and next actions",
    "- decisions.md — accepted and locked decisions","",
    "Session notes are historical references and are not loaded by default."
  ].join("\n")+"\n";
  const project=previous.get("project-memory.md")||[
    "# "+title,"","## Stable project memory","",
    "Owner: curate long-lived goals, architecture, terminology and constraints here.",
    "","This first-save template is not an AI-generated summary. Review and edit before confirming."
  ].join("\n")+"\n";
  const decisions=previous.get("decisions.md")||[
    "# Accepted decisions","","Only record decisions explicitly accepted by the Owner. This first-save draft does not infer decisions."
  ].join("\n")+"\n";
  const progress=progressContent(previous.get("progress.md")||"# Progress\n",conversationId,messages);
  const recent=messages.filter((m)=>m.role==="user"||(m.role==="assistant"&&(m.status==="complete"||m.status==="partial"))).slice(-10);
  const sessionName="sessions/"+new Date().toISOString().slice(0,10)+"-"+conversationId.slice(0,8)+".md";
  const sessionParts=["# Session note","","- Project: "+title,"- Conversation: "+conversationId,"- Source: Owner Intelligence D1 transcript","- Bounded transcript excerpts; not an AI-generated summary.",""];
  for(const message of recent){
    const excerpt=message.content.length>2400?message.content.slice(0,2400)+"\n\n[Excerpt shortened for review.]":message.content;
    sessionParts.push("## "+message.role+" - "+message.id,"",excerpt,"");
  }
  const files=[
    {name:"index.md",content:index},{name:"project-memory.md",content:project},
    {name:"progress.md",content:progress},{name:"decisions.md",content:decisions},
    {name:sessionName,content:sessionParts.join("\n").slice(0,20000)}
  ];
  if(files.some((file)=>file.content.length>FILE_LIMIT)||files.reduce((sum,file)=>sum+file.content.length,0)>TOTAL_LIMIT)throw new Error("Project memory is too large for one preview. Edit or archive existing files first.");
  return files;
}
async function startApp(env:Env,request:Request):Promise<Response>{
  const existing=await getApp(env);
  if(existing)return json({ok:false,error:"github_app_exists",message:"The dedicated Owner App is already registered. Continue with its installation.",appInstallUrl:"https://github.com/apps/"+encodeURIComponent(existing.slug)+"/installations/new"},409);
  const origin=new URL(request.url).origin,manifestState=await createState(env,"manifest"),setupState=await createState(env,"installation");
  const manifest={
    name:"Owner Gemini Intelligence",url:origin+"/admin/intelligence",
    description:"Private, selected-repository Markdown memory for Owner Gemini Intelligence.",
    redirect_url:origin+"/admin/intelligence/github/callback",
    setup_url:origin+"/admin/intelligence/github/setup?state="+encodeURIComponent(setupState),
    public:false,default_permissions:PERMISSIONS,default_events:[]
  };
  return json({ok:true,action:"https://github.com/settings/apps/new?state="+encodeURIComponent(manifestState),manifest});
}
function html(value:string):string{return value.replace(/[&<>"']/gu,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]||c));}
function callbackPage(title:string,message:string,success:boolean,href?:string,label?:string):Response{
  const link=href?"<p><a href=\""+html(href)+"\">"+html(label||"Continue")+"</a></p>":"";
  const content="<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>"+html(title)+"</title><style>body{font-family:system-ui;background:#171717;color:#eee;padding:24px}.card{max-width:560px;margin:10vh auto;background:#222;border:1px solid #444;border-radius:18px;padding:26px}p{line-height:1.6;color:#bbb}a{color:#b9c8ff}.status{color:"+(success?"#a8edc5":"#f1aaaa")+";font-weight:700}</style><main class=\"card\"><h1>"+html(title)+"</h1><p class=\"status\">"+(success?"Step completed":"Step not completed")+"</p><p>"+html(message)+"</p>"+link+"<p><a href=\"/admin/intelligence\">Return to Owner Intelligence</a></p></main></html>";
  return new Response(content,{status:success?200:400,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
}
export async function ownerIntelligenceGitHubCallback(env:Env,request:Request):Promise<Response>{
  await ensureSchema(env);
  const url=new URL(request.url);
  if(url.searchParams.has("error"))return callbackPage("GitHub App registration cancelled","GitHub did not complete registration. Return to Owner Intelligence and retry.",false);
  const code=clean(url.searchParams.get("code"),128),token=clean(url.searchParams.get("state"),128);
  if(!code||!token)return callbackPage("GitHub callback incomplete","The temporary code or state was missing. Start registration again.",false);
  try{
    const ownerId=await consumeState(env,"manifest",token);
    if(!ownerId)return callbackPage("GitHub registration state expired","The one-time state was invalid, expired or already used. Start a fresh registration.",false);
    const response=await fetch(API+"/app-manifests/"+encodeURIComponent(code)+"/conversions",{method:"POST",headers:{accept:"application/vnd.github+json","user-agent":"Owner-Gemini-Intelligence","x-github-api-version":"2022-11-28"}});
    const text=await response.text();let data:unknown={};try{data=text?JSON.parse(text):{};}catch{data={};}
    if(!response.ok)throw new GitHubError(response.status);
    const app=data as {id?:number;slug?:string;name?:string;pem?:string;permissions?:Record<string,string>},permissions=app.permissions||{};
    if(!Number.isSafeInteger(app.id)||!app.slug||!app.pem||!hasLeastPermissions(permissions)){
      return callbackPage("GitHub App permissions did not match","The returned App must have exactly Metadata: read and Contents: write. No private key was stored.",false);
    }
    const now=Date.now();
    const saved = await env.DB!.prepare("INSERT INTO owner_intelligence_github_app (owner_id,app_id,slug,name,private_key_ciphertext,installation_id,installation_account,repository_selection,created_at,updated_at) VALUES (?,?,?,?,?,NULL,NULL,NULL,?,?) ON CONFLICT(owner_id) DO NOTHING")
      .bind(ownerId,app.id,clean(app.slug,100),clean(app.name||"Owner Gemini Intelligence",120),await encryptKey(env,app.pem),now,now).run();
    if (Number(saved.meta?.changes || 0) !== 1) {
      return callbackPage("An Owner GitHub App is already registered", "A different browser session completed App registration first. Return to Owner Intelligence and use the existing App installation link. This new App key was not stored.", false);
    }
    const installUrl="https://github.com/apps/"+encodeURIComponent(app.slug)+"/installations/new";
    return callbackPage("Owner GitHub App created","A dedicated private App was created with Metadata: read and Contents: write only. Its private key is encrypted in Owner-only D1. Install it on selected repositories only; do not choose all repositories.",true,installUrl,"Install on selected repositories");
  }catch(error){
    return callbackPage("GitHub App registration failed",error instanceof GitHubError?"GitHub returned HTTP "+error.status+". Check App settings and start a fresh registration.":"Secure App registration could not be completed. Return to Owner Intelligence and retry.",false);
  }
}
export async function ownerIntelligenceGitHubSetup(env:Env,request:Request):Promise<Response>{
  await ensureSchema(env);
  const url=new URL(request.url),token=clean(url.searchParams.get("state"),128),installationId=Number(url.searchParams.get("installation_id"));
  if(!token||!Number.isSafeInteger(installationId)||installationId<1)return callbackPage("GitHub installation callback incomplete","The installation ID or one-time state was missing.",false);
  try{
    const ownerId=await consumeState(env,"installation",token);
    if(!ownerId)return callbackPage("GitHub installation state expired","The one-time installation state expired or was already used. Reopen the App installation page from Owner Intelligence.",false);
    const row=await env.DB!.prepare("SELECT * FROM owner_intelligence_github_app WHERE owner_id=?").bind(ownerId).first<AppRow>();
    if(!row)return callbackPage("Owner GitHub App not registered","Create the dedicated Owner App before installing it.",false);
    const value:Bundle={appId:row.app_id,slug:row.slug,name:row.name,privateKey:await decryptKey(env,row.private_key_ciphertext),installationId};
    const installed=await appApi<{id?:number;app_id?:number;account?:{login?:string};permissions?:Record<string,string>;repository_selection?:string}>(value,"/app/installations/"+installationId);
    const granted=installed.permissions||{};
    if(Number(installed.id)!==installationId||Number(installed.app_id)!==row.app_id||!hasLeastPermissions(granted)||installed.repository_selection!=="selected"){
      return callbackPage("GitHub installation rejected","Installation must belong to the dedicated App, grant Metadata: read and Contents: write, and use selected repositories only. No installation was saved.",false);
    }
    const account=clean(installed.account?.login,100);
    if(!account)return callbackPage("GitHub installation account unavailable","GitHub did not return an installation account. No installation was saved.",false);
    await env.DB!.prepare("UPDATE owner_intelligence_github_app SET installation_id=?,installation_account=?,repository_selection='selected',updated_at=? WHERE owner_id=? AND app_id=?")
      .bind(installationId,account,Date.now(),ownerId,row.app_id).run();
    return callbackPage("Owner GitHub App installed","The installation was verified and is restricted to selected repositories. Return to Owner Intelligence to choose a destination and review a memory save.",true);
  }catch(error){
    return callbackPage("GitHub installation verification failed",error instanceof GitHubError?"GitHub returned HTTP "+error.status+". Check the App installation and retry.":"The installation could not be verified. No installation was saved.",false);
  }
}
async function status(env:Env):Promise<Response>{
  const row=await getApp(env);
  if(!row)return json({ok:true,github:{status:"not_connected",installed:false}});
  return json({ok:true,github:{
    status:row.installation_id?"installed":"app_created",installed:Boolean(row.installation_id),appName:row.name,appSlug:row.slug,
    installationAccount:row.installation_account,repositorySelection:row.repository_selection,
    appInstallUrl:"https://github.com/apps/"+encodeURIComponent(row.slug)+"/installations/new",
    settingsUrl:"https://github.com/settings/apps/"+encodeURIComponent(row.slug)
  }});
}
async function repositoryList(env:Env):Promise<Response>{
  try{
    const value=await getBundle(env),items=await getRepositories(value);
    return json({ok:true,repositories:items.map((item)=>({id:item.id,fullName:item.fullName,defaultBranch:item.defaultBranch,private:item.private}))});
  }catch(error){
    return json({ok:false,error:"github_repository_list_failed",message:error instanceof GitHubError?"GitHub returned HTTP "+error.status+".":"The dedicated Owner GitHub App is not installed or could not be used."},502);
  }
}
async function makePreview(env:Env,request:Request):Promise<Response>{
  const data=await readBody(request,10000);
  if(!data||Object.keys(data).some((key)=>!["conversationId","topicId","topicTitle","repository","branch"].includes(key))||!uuid(data.conversationId)||!repoName(data.repository)||
    (data.topicId!==undefined&&data.topicId!==null&&!uuid(data.topicId))||(data.topicTitle!==undefined&&typeof data.topicTitle!=="string")||(data.branch!==undefined&&!branchName(data.branch)))return json({ok:false,error:"invalid_request"},400);
  const conversation=await loadConversation(env,data.conversationId);
  if(!conversation)return notFound();
  const topicId=typeof data.topicId==="string"?data.topicId:conversation.topic_id;
  const topic=topicId?await loadTopic(env,topicId):null;
  if(topicId&&!topic)return notFound();
  if(conversation.topic_id&&topicId!==conversation.topic_id)return json({ok:false,error:"conversation_topic_mismatch",message:"This conversation already belongs to another topic."},409);
  if(!topic&&(typeof data.topicTitle!=="string"||!data.topicTitle.trim()||data.topicTitle.trim().length>80))return json({ok:false,error:"project_title_required",message:"Enter a project name to promote this Scratchpad after its first verified save."},400);
  const title=topic?.title||(data.topicTitle as string).trim(),newTopicId=topic?.id||crypto.randomUUID();
  const topicSlugValue=topic?.slug||projectSlug(title,newTopicId),root=topic?.memory_root||"projects/"+topicSlugValue+"/memory";
  if(!/^[A-Za-z0-9._/-]{1,140}$/u.test(root)||root.includes("..")||root.startsWith("/")||root.endsWith("/"))return json({ok:false,error:"invalid_memory_root"},400);
  const value=await getBundle(env),available=await getRepositories(value);
  const repository=available.find((item)=>item.fullName.toLowerCase()===(data.repository as string).toLowerCase());
  if(!repository)return json({ok:false,error:"repository_not_installed",message:"Choose a repository included in the selected-repository GitHub App installation."},403);
  const branch=typeof data.branch==="string"?data.branch:repository.defaultBranch;
  if(!branchName(branch))return json({ok:false,error:"invalid_branch"},400);
  if(topic?.repository_owner&&topic.repository_name&&(topic.repository_owner+"/"+topic.repository_name).toLowerCase()!==repository.fullName.toLowerCase())return json({ok:false,error:"project_repository_mismatch",message:"This project is already associated with another repository."},409);
  if(topic?.repository_branch&&topic.repository_branch!==branch)return json({ok:false,error:"project_branch_mismatch",message:"This project is already associated with another branch."},409);
  const token=await installationToken(value,repository.id),base=await branchHead(token,repository.fullName,branch);
  const files=await createFiles(token,repository.fullName,branch,root,title,conversation.id,conversation.messages);
  const id=crypto.randomUUID(),now=Date.now(),expires=now+30*60_000;
  await env.DB!.prepare("INSERT INTO owner_intelligence_github_previews (id,owner_id,conversation_id,topic_id,topic_title,topic_slug,repository_owner,repository_name,repository_id,branch,memory_root,base_commit_sha,files_json,status,commit_sha,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'ready',NULL,?,?,?)")
    .bind(id,owner(env),conversation.id,newTopicId,title,topicSlugValue,repository.owner,repository.name,repository.id,branch,root,base,JSON.stringify(files),expires,now,now).run();
  return json({ok:true,preview:{id,topicId:newTopicId,topicTitle:title,repository:repository.fullName,branch,baseCommitSha:base,memoryRoot:root,expiresAt:expires,files,
    note:"This editable draft uses D1 transcript excerpts and existing repository Markdown. It does not call Gemini or load Project Memory into this chat. Review every file before confirming."}},201);
}
function projectSlug(title:string,id:string):string{
  const base=title.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/gu,"").replace(/[^a-z0-9]+/gu,"-").replace(/^-+|-+$/gu,"").slice(0,36)||"project";
  return base+"-"+id.slice(0,8);
}
async function getPreview(env:Env,id:string):Promise<PreviewRow|null>{
  return env.DB!.prepare("SELECT * FROM owner_intelligence_github_previews WHERE id=? AND owner_id=?").bind(id,owner(env)).first<PreviewRow>();
}
function validateFiles(row:PreviewRow,value:unknown):FileDraft[]|null{
  if(!Array.isArray(value)||value.length!==5)return null;
  const originals=JSON.parse(row.files_json) as FileDraft[],names=new Set(originals.map((file)=>file.name)),result:FileDraft[]=[];let total=0;
  for(const item of value){
    if(!item||typeof item!=="object"||Array.isArray(item))return null;
    const file=item as Record<string,unknown>,name=file.name;
    const session=typeof name==="string"&&/^sessions\/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{8}\.md$/u.test(name);
    if(typeof name!=="string"||(!names.has(name)&&!session)||(session&&!name.endsWith(row.conversation_id.slice(0,8)+".md"))||
      typeof file.content!=="string"||file.content.length>FILE_LIMIT||result.some((entry)=>entry.name===name))return null;
    total+=file.content.length;result.push({name,content:file.content});
  }
  return total<=TOTAL_LIMIT&&result.length===names.size&&[...names].every((name)=>result.some((file)=>file.name===name))?result:null;
}
async function getTree(token:string,repo:string,sha:string):Promise<string>{
  const result=await api<{tree?:{sha?:string}}>("/repos/"+repo+"/git/commits/"+sha,token),tree=clean(result.tree?.sha,64);
  if(!/^[a-f0-9]{40}$/iu.test(tree))throw new GitHubError(502);return tree;
}
async function verifyCommit(token:string,repo:string,sha:string,root:string,files:FileDraft[]):Promise<boolean>{
  const commit=await api<{sha?:string}>("/repos/"+repo+"/git/commits/"+sha,token);
  if(clean(commit.sha,64)!==sha)return false;
  for(const file of files){
    const saved=await api<{type?:string;encoding?:string;content?:string}>("/repos/"+repo+"/contents/"+gitPath(root+"/"+file.name)+"?ref="+encodeURIComponent(sha),token);
    if(saved.type!=="file"||saved.encoding!=="base64"||typeof saved.content!=="string"||decodeContent(saved.content)!==file.content)return false;
  }
  return true;
}
async function finishSave(env:Env,row:PreviewRow,files:FileDraft[]):Promise<Response>{
  const now=Date.now(),db=env.DB!;
  const results=await db.batch([
    db.prepare("INSERT INTO owner_intelligence_topics (id,owner_id,title,slug,lifecycle_status,repository_owner,repository_name,repository_branch,memory_root,manifest_revision,current_commit_sha,created_at,updated_at) VALUES (?,?,?,?, 'active',?,?,?,?, 'owner-memory-v1',?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,repository_owner=excluded.repository_owner,repository_name=excluded.repository_name,repository_branch=excluded.repository_branch,memory_root=excluded.memory_root,manifest_revision=excluded.manifest_revision,current_commit_sha=excluded.current_commit_sha,updated_at=excluded.updated_at WHERE owner_intelligence_topics.owner_id=excluded.owner_id")
      .bind(row.topic_id,row.owner_id,row.topic_title,row.topic_slug,row.repository_owner,row.repository_name,row.branch,row.memory_root,row.commit_sha,now,now),
    db.prepare("UPDATE owner_intelligence_conversations SET topic_id=?,session_kind='topic',updated_at=? WHERE id=? AND owner_id=? AND lifecycle_status='active'")
      .bind(row.topic_id,now,row.conversation_id,row.owner_id),
    db.prepare("UPDATE owner_intelligence_github_previews SET status='synced',files_json=?,updated_at=? WHERE id=? AND owner_id=? AND status='verifying'")
      .bind(JSON.stringify(files),now,row.id,row.owner_id)
  ]);
  if(results.some((result)=>!result.success)||Number(results[1]?.meta?.changes||0)!==1||Number(results[2]?.meta?.changes||0)!==1){
    return json({ok:false,error:"github_database_sync_pending",message:"GitHub commit and read-back succeeded, but D1 could not record the sync. Do not repeat the save; retry verification.",commitSha:row.commit_sha},503);
  }
  return json({ok:true,status:"synced",commitSha:row.commit_sha,repository:row.repository_owner+"/"+row.repository_name,branch:row.branch,topicId:row.topic_id,files:files.map((file)=>row.memory_root+"/"+file.name)});
}
async function confirmSave(env:Env,request:Request):Promise<Response>{
  const data=await readBody(request,180000);
  if(!data||Object.keys(data).some((key)=>!["previewId","confirmed","files"].includes(key))||!uuid(data.previewId)||data.confirmed!==true)return json({ok:false,error:"explicit_confirmation_required"},400);
  const row=await getPreview(env,data.previewId);if(!row)return notFound();
  if(row.status==="synced"&&row.commit_sha)return json({ok:true,status:"synced",commitSha:row.commit_sha,idempotent:true});
  if(row.expires_at<=Date.now()&&row.status==="ready"){
    await env.DB!.prepare("UPDATE owner_intelligence_github_previews SET status='expired',updated_at=? WHERE id=? AND owner_id=?").bind(Date.now(),row.id,owner(env)).run();
    return json({ok:false,error:"preview_expired",message:"Create a new preview against the latest branch head."},409);
  }
  const files=validateFiles(row,data.files);if(!files)return json({ok:false,error:"invalid_preview_files",message:"Edited files must match the reviewed file set and size limits."},400);
  if(!await loadConversation(env,row.conversation_id))return notFound();
  const value=await getBundle(env),repo=row.repository_owner+"/"+row.repository_name,token=await installationToken(value,row.repository_id);
  if(row.status==="verifying"&&row.commit_sha){
    if(!await verifyCommit(token,repo,row.commit_sha,row.memory_root,files))return json({ok:false,error:"github_verification_pending",message:"Read-back verification is incomplete. Synced has not been set."},503);
    return finishSave(env,row,files);
  }
  if(row.status!=="ready")return json({ok:false,error:"preview_not_ready",message:"Create a fresh preview before attempting another commit."},409);
  try{
    const current=await branchHead(token,repo,row.branch);
    if(current!==row.base_commit_sha){
      await env.DB!.prepare("UPDATE owner_intelligence_github_previews SET status='conflict',updated_at=? WHERE id=? AND owner_id=? AND status='ready'").bind(Date.now(),row.id,owner(env)).run();
      return json({ok:false,error:"github_branch_conflict",message:"The target branch changed after preview. No files were written; create a new preview.",expectedBase:row.base_commit_sha,currentHead:current},409);
    }
    const baseTree=await getTree(token,repo,row.base_commit_sha);
    const tree=await api<{sha?:string}>("/repos/"+repo+"/git/trees",token,"POST",{base_tree:baseTree,tree:files.map((file)=>({path:row.memory_root+"/"+file.name,mode:"100644",type:"blob",content:file.content}))});
    if(!tree.sha)throw new GitHubError(502);
    const commit=await api<{sha?:string}>("/repos/"+repo+"/git/commits",token,"POST",{message:"Owner Intelligence: save memory for "+row.topic_title,tree:tree.sha,parents:[row.base_commit_sha]});
    const sha=clean(commit.sha,64);if(!/^[a-f0-9]{40}$/iu.test(sha))throw new GitHubError(502);
    if(await branchHead(token,repo,row.branch)!==row.base_commit_sha){
      await env.DB!.prepare("UPDATE owner_intelligence_github_previews SET status='conflict',updated_at=? WHERE id=? AND owner_id=? AND status='ready'").bind(Date.now(),row.id,owner(env)).run();
      return json({ok:false,error:"github_branch_conflict",message:"The branch advanced while the commit was being prepared. No branch update was made; create a fresh preview."},409);
    }
    try{
      await api("/repos/"+repo+"/git/refs/heads/"+gitBranch(row.branch),token,"PATCH",{sha,force:false});
    }catch(error){
      if(error instanceof GitHubError&&(error.status===409||error.status===422)){
        await env.DB!.prepare("UPDATE owner_intelligence_github_previews SET status='conflict',updated_at=? WHERE id=? AND owner_id=? AND status='ready'").bind(Date.now(),row.id,owner(env)).run();
        return json({ok:false,error:"github_branch_conflict",message:"GitHub rejected a non-fast-forward update. External edits were not overwritten."},409);
      }
      throw error;
    }
    await env.DB!.prepare("UPDATE owner_intelligence_github_previews SET status='verifying',commit_sha=?,files_json=?,updated_at=? WHERE id=? AND owner_id=? AND status='ready'")
      .bind(sha,JSON.stringify(files),Date.now(),row.id,owner(env)).run();
    const verifying={...row,status:"verifying",commit_sha:sha};
    if(!await verifyCommit(token,repo,sha,row.memory_root,files))return json({ok:false,error:"github_verification_pending",message:"GitHub accepted the branch update, but read-back verification did not finish. Synced has not been set; retry verification.",commitSha:sha},503);
    return finishSave(env,verifying,files);
  }catch(error){
    return json({ok:false,error:error instanceof GitHubError?"github_api_error":"github_save_failed",message:error instanceof GitHubError?"GitHub returned HTTP "+error.status+". No Synced status was recorded.":"Save failed. The D1 transcript remains available and no Synced status was recorded."},502);
  }
}
export async function handleOwnerIntelligenceGitHubApi(request:Request,env:Env,url:URL):Promise<Response>{
  if(request.method==="GET"&&url.pathname==="/admin/api/intelligence/github/status")return status(env);
  if(request.method==="GET"&&url.pathname==="/admin/api/intelligence/github/repositories")return repositoryList(env);
  if(!url.pathname.startsWith("/admin/api/intelligence/github/"))return notFound();
  if(request.method!=="POST")return methodNotAllowed(["GET","POST"]);
  if(!sameOrigin(request))return json({ok:false,error:"same_origin_required"},403);
  await ensureSchema(env);
  if(url.pathname==="/admin/api/intelligence/github/start")return startApp(env,request);
  if(url.pathname==="/admin/api/intelligence/github/preview")return makePreview(env,request);
  if(url.pathname==="/admin/api/intelligence/github/confirm")return confirmSave(env,request);
  return notFound();
}
