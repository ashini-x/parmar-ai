import type { Env } from "../config/env";
import { ensureOwnerIntelligenceSchema } from "./intelligence";
import { json, methodNotAllowed, notFound } from "../http/response";
import { ensureOwnerIntelligenceSchema } from "./intelligence";

const API = "https://api.github.com";
const CALLBACK = "/admin/api/intelligence/github/callback";
const SETUP = "/admin/api/intelligence/github/setup";
const APP_TABLE = "owner_intelligence_github_app";
const INSTALL_TABLE = "owner_intelligence_github_installations";
const STATE_TABLE = "owner_intelligence_github_oauth_states";

type Bundle = { appId: number; slug: string; name: string; clientId: string; clientSecret: string; privateKey: string; redirectUri: string };
type AppRow = { owner_id: string; app_id: number; app_slug: string; app_name: string; redirect_uri: string; secret_ciphertext: string; status: string };
type InstallationRow = { installation_id: number; account_login: string; account_type: string; repository_selection: string; authorized_user: string };
type GitHubInstallation = {
  id?: number;
  app_id?: number;
  account?: { login?: string; type?: string };
  repository_selection?: string;
  permissions?: Record<string, string>;
};
type GitHubResponse<T> = { data: T; headers: Headers };

function principal(env: Env): string {
  const value = env.OWNER_DASHBOARD_USER?.trim().toLowerCase();
  if (!value) throw new Error("The Owner account is not configured.");
  return value;
}
function clean(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}
function fromB64(value: string): Uint8Array {
  const binary = atob(value.replace(/-/gu, "+").replace(/_/gu, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function owned(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
function randomState(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}
async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function sha256(value: string): Promise<string> {
  return [...await sha256Bytes(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function vaultKey(env: Env, owner: string): Promise<CryptoKey> {
  const secret = env.ADMIN_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("The Owner session secret must be configured before GitHub credentials can be stored.");
  const material = new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode("Owner Intelligence GitHub App vault v1\0" + secret + "\0" + owner)));
  return crypto.subtle.importKey("raw", owned(material), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptBundle(env: Env, owner: string, bundle: Bundle): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({
    name: "AES-GCM", iv: owned(iv),
    additionalData: owned(new TextEncoder().encode("owner-intelligence-github-app:v1:" + owner)),
  }, await vaultKey(env, owner), owned(new TextEncoder().encode(JSON.stringify(bundle))));
  return b64url(iv) + "." + b64url(new Uint8Array(cipher));
}
async function decryptBundle(env: Env, owner: string, ciphertext: string): Promise<Bundle> {
  const parts = ciphertext.split(".");
  if (parts.length !== 2) throw new Error("The stored Owner GitHub App credentials are unreadable. Reconnect the App.");
  try {
    const clear = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: owned(fromB64(parts[0])),
      additionalData: owned(new TextEncoder().encode("owner-intelligence-github-app:v1:" + owner)),
    }, await vaultKey(env, owner), owned(fromB64(parts[1])));
    const value = JSON.parse(new TextDecoder().decode(clear)) as Bundle;
    if (!value.appId || !value.clientId || !value.clientSecret || !value.privateKey || !value.redirectUri) throw new Error("Incomplete App credentials.");
    return value;
  } catch {
    throw new Error("The stored Owner GitHub App credentials could not be decrypted. Check whether the Owner session secret was rotated.");
  }
}
function pkcs1ToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/gu, "").replace(/-----END [^-]+-----/gu, "").replace(/\s/gu, "");
  const key = fromB64(body);
  if (pem.includes("BEGIN PRIVATE KEY")) return key;
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) throw new Error("GitHub returned an unsupported App private-key format.");
  const length = (n: number): Uint8Array => {
    if (n < 128) return new Uint8Array([n]);
    const bytes: number[] = []; let value = n;
    while (value > 0) { bytes.unshift(value & 255); value >>>= 8; }
    return new Uint8Array([0x80 | bytes.length, ...bytes]);
  };
  const der = (tag: number, value: Uint8Array): Uint8Array => {
    const size = length(value.length); const result = new Uint8Array(1 + size.length + value.length);
    result[0] = tag; result.set(size, 1); result.set(value, 1 + size.length); return result;
  };
  const join = (...parts: Uint8Array[]): Uint8Array => {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
  };
  const algorithm = new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
  return der(0x30, join(new Uint8Array([0x02,0x01,0x00]), algorithm, der(0x04, key)));
}
async function appJwt(bundle: Bundle): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", owned(pkcs1ToPkcs8(bundle.privateKey)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ iat: now - 30, exp: now + 8 * 60, iss: bundle.appId })));
  const unsigned = header + "." + payload;
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, owned(new TextEncoder().encode(unsigned))));
  return unsigned + "." + b64url(sig);
}
async function github<T>(path: string, token: string, method = "GET", body?: unknown): Promise<GitHubResponse<T>> {
  const response = await fetch(API + path, {
    method,
    headers: {
      accept: "application/vnd.github+json", "user-agent": "BRɅIN-Owner-Memory",
      authorization: "Bearer " + token, "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text(); let data: unknown = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    const requestId = clean(response.headers.get("x-github-request-id"), 80);
    throw new Error("GitHub returned HTTP " + response.status + (requestId ? " (request " + requestId + ")" : "") + ".");
  }
  return { data: data as T, headers: response.headers };
}
async function ensureSchema(env: Env): Promise<void> {
  if (!env.DB) throw new Error("The Owner Intelligence database is not configured.");
  await ensureOwnerIntelligenceSchema(env);
  await ensureOwnerIntelligenceSchema(env);
  const results = await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS " + APP_TABLE + " (owner_id TEXT PRIMARY KEY, app_id INTEGER NOT NULL, app_slug TEXT NOT NULL, app_name TEXT NOT NULL, redirect_uri TEXT NOT NULL, secret_ciphertext TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'created', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS " + INSTALL_TABLE + " (owner_id TEXT NOT NULL, installation_id INTEGER NOT NULL, app_id INTEGER NOT NULL, account_login TEXT NOT NULL, account_type TEXT NOT NULL DEFAULT '', repository_selection TEXT NOT NULL DEFAULT 'selected', status TEXT NOT NULL DEFAULT 'active', authorized_user TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(owner_id, installation_id))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_owner_github_installations_owner ON " + INSTALL_TABLE + "(owner_id, status, account_login)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS " + STATE_TABLE + " (state_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, purpose TEXT NOT NULL CHECK (purpose IN ('manifest','installation','user_authorization')), payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"),
  ]);
  if (results.some((result) => !result.success)) throw new Error("D1 did not confirm the Owner GitHub schema.");
  const columns = await env.DB.prepare("PRAGMA table_info(owner_intelligence_topics)").all<{ name: string }>();
  const known = new Set((columns.results ?? []).map((item) => item.name));
  const additions = [
    ["github_installation_id", "ALTER TABLE owner_intelligence_topics ADD COLUMN github_installation_id INTEGER"],
    ["repository_id", "ALTER TABLE owner_intelligence_topics ADD COLUMN repository_id INTEGER"],
  ] as const;
  for (const [column, statement] of additions) {
    if (known.has(column)) continue;
    try {
      const result = await env.DB.prepare(statement).run();
      if (!result.success) throw new Error("D1 rejected an Owner topic repository migration.");
    } catch (error) {
      const refreshed = await env.DB.prepare("PRAGMA table_info(owner_intelligence_topics)").all<{ name: string }>();
      if (!(refreshed.results ?? []).some((item) => item.name === column)) throw error;
    }
  }
}
async function appRow(env: Env, owner: string): Promise<AppRow | null> {
  await ensureSchema(env);
  return env.DB!.prepare("SELECT owner_id, app_id, app_slug, app_name, redirect_uri, secret_ciphertext, status FROM " + APP_TABLE + " WHERE owner_id=?")
    .bind(owner).first<AppRow>();
}
async function getBundle(env: Env, owner: string): Promise<{ row: AppRow; bundle: Bundle }> {
  const row = await appRow(env, owner);
  if (!row || row.status === "revoked") throw new Error("Create the private Owner Memory GitHub App first.");
  return { row, bundle: await decryptBundle(env, owner, row.secret_ciphertext) };
}
async function persistBundle(env: Env, owner: string, bundle: Bundle): Promise<void> {
  const encrypted = await encryptBundle(env, owner, bundle); const now = Date.now();
  const result = await env.DB!.prepare("INSERT INTO " + APP_TABLE + " (owner_id, app_id, app_slug, app_name, redirect_uri, secret_ciphertext, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?) ON CONFLICT(owner_id) DO UPDATE SET app_id=excluded.app_id, app_slug=excluded.app_slug, app_name=excluded.app_name, redirect_uri=excluded.redirect_uri, secret_ciphertext=excluded.secret_ciphertext, status='created', updated_at=excluded.updated_at")
    .bind(owner, bundle.appId, bundle.slug, bundle.name, bundle.redirectUri, encrypted, now, now).run();
  if (!result.success) throw new Error("D1 did not confirm the Owner GitHub App registration.");
}
async function createState(env: Env, owner: string, purpose: "manifest" | "installation" | "user_authorization", payload: Record<string, unknown>): Promise<string> {
  const state = randomState(); const now = Date.now();
  const ttlMs = purpose === "manifest" ? 50 * 60_000 : purpose === "installation" ? 30 * 60_000 : 10 * 60_000;
  const result = await env.DB!.prepare("INSERT INTO " + STATE_TABLE + " (state_hash, owner_id, purpose, payload_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(state), owner, purpose, JSON.stringify(payload), now, now + ttlMs).run();
  if (!result.success) throw new Error("D1 did not confirm the one-time GitHub state.");
  return state;
}
async function consumeState(env: Env, state: string, purpose: "manifest" | "installation" | "user_authorization"): Promise<{ owner_id: string; payload: Record<string, unknown> } | null> {
  if (!env.DB || state.length < 32 || state.length > 128) return null;
  const row = await env.DB.prepare("DELETE FROM " + STATE_TABLE + " WHERE state_hash=? AND purpose=? AND expires_at>? RETURNING owner_id, payload_json")
    .bind(await sha256(state), purpose, Date.now()).first<{ owner_id: string; payload_json: string }>();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? { owner_id: row.owner_id, payload: payload as Record<string, unknown> } : null;
  } catch { return null; }
}
function callbackResult(result: "app-created" | "installed" | "error"): Response {
  // Render a same-origin landing document before navigating into the Owner
  // workspace. The workspace cookie uses SameSite=Strict; this avoids relying
  // on it being sent on the first cross-site OAuth redirect request.
  const target = "/admin/intelligence?github=" + result;
  const html = "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='referrer' content='no-referrer'>" +
    "<meta http-equiv='refresh' content='0;url=" + target + "'><title>Returning to BRɅIN</title>" +
    "<body><p>GitHub connection step completed. <a href='" + target + "'>Continue to BRɅIN Intelligence</a>.</p></body></html>";
  return new Response(html, { status: 200, headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
  } });
}
async function startManifest(env: Env, request: Request, owner: string): Promise<Response> {
  if (new URL(request.url).protocol !== "https:") return json({ ok: false, error: "A secure HTTPS callback origin is required." }, 400);
  const current = await appRow(env, owner);
  if (current) return json({ ok: false, error: "github_app_already_configured", message: "An Owner Memory GitHub App already exists. Continue with its installation or disconnect it before replacing it." }, 409);
  const redirectUri = new URL(CALLBACK, new URL(request.url).origin).toString();
  const state = await createState(env, owner, "manifest", { redirectUri });
  const manifest = {
    name: "BRɅIN Owner Memory",
    url: new URL("/admin/intelligence", new URL(request.url).origin).toString(),
    description: "Private, Owner-controlled project memory for BRɅIN Intelligence.",
    redirect_url: redirectUri,
    setup_url: new URL(SETUP, new URL(request.url).origin).toString(),
    callback_urls: [redirectUri],
    setup_on_update: false,
    public: false,
    default_permissions: { metadata: "read", contents: "write" },
    default_events: [],
  };
  return json({ ok: true, configured: false, permissions: manifest.default_permissions,
    actionUrl: "https://github.com/settings/apps/new?state=" + encodeURIComponent(state), manifest });
}
async function convertManifest(code: string): Promise<{ id?: number; slug?: string; name?: string; pem?: string; client_id?: string; client_secret?: string; permissions?: Record<string, string> }> {
  const response = await fetch(API + "/app-manifests/" + encodeURIComponent(code) + "/conversions", {
    method: "POST", headers: { accept: "application/vnd.github+json", "user-agent": "BRɅIN-Owner-Memory", "x-github-api-version": "2022-11-28" },
  });
  const raw = await response.text(); let data: unknown = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error("GitHub App manifest conversion failed (HTTP " + response.status + ").");
  return data as { id?: number; slug?: string; name?: string; pem?: string; client_id?: string; client_secret?: string; permissions?: Record<string, string> };
}
async function manifestCallback(env: Env, request: Request, url: URL): Promise<Response> {
  const code = clean(url.searchParams.get("code"), 1024); const state = clean(url.searchParams.get("state"), 128);
  if (!code || !state || url.searchParams.has("error")) return callbackResult("error");
  const consumed = await consumeState(env, state, "manifest");
  if (!consumed) return callbackResult("error");
  const redirectUri = clean(consumed.payload.redirectUri, 500);
  if (!redirectUri || new URL(redirectUri).origin !== url.origin || new URL(redirectUri).pathname !== CALLBACK) return callbackResult("error");
  const app = await convertManifest(code); const permissions = app.permissions || {};
  if (!app.id || !app.slug || !app.pem || !app.client_id || !app.client_secret ||
      permissions.metadata !== "read" || permissions.contents !== "write") return callbackResult("error");
  const bundle: Bundle = {
    appId: Number(app.id), slug: clean(app.slug, 100), name: clean(app.name || "BRɅIN Owner Memory", 100),
    clientId: clean(app.client_id, 160), clientSecret: app.client_secret, privateKey: app.pem, redirectUri,
  };
  if (!Number.isSafeInteger(bundle.appId) || bundle.appId < 1 || !bundle.slug || !bundle.clientId) return callbackResult("error");
  await persistBundle(env, consumed.owner_id, bundle);
  return callbackResult("app-created");
}
async function installationJwt(env: Env, owner: string): Promise<{ row: AppRow; bundle: Bundle; token: string }> {
  const pair = await getBundle(env, owner);
  return { ...pair, token: await appJwt(pair.bundle) };
}
async function installApp(env: Env, request: Request, owner: string): Promise<Response> {
  const { row, bundle } = await getBundle(env, owner);
  const state = await createState(env, owner, "installation", { appId: bundle.appId, redirectUri: bundle.redirectUri });
  return json({ ok: true, installationUrl: "https://github.com/apps/" + encodeURIComponent(row.app_slug) + "/installations/new?state=" + encodeURIComponent(state) });
}
async function installationCallback(env: Env, url: URL): Promise<Response> {
  const state = clean(url.searchParams.get("state"), 128);
  const installationId = Number(url.searchParams.get("installation_id"));
  const setupAction = clean(url.searchParams.get("setup_action"), 20);
  if (!state || !Number.isSafeInteger(installationId) || installationId < 1 ||
      !["install", "update"].includes(setupAction)) return callbackResult("error");
  const consumed = await consumeState(env, state, "installation");
  if (!consumed) return callbackResult("error");
  const owner = consumed.owner_id;
  const redirectUri = clean(consumed.payload.redirectUri, 500);
  if (!redirectUri) return callbackResult("error");
  const setupUri = new URL(SETUP, new URL(redirectUri).origin).toString();
  if (setupUri !== url.origin + SETUP) return callbackResult("error");
  const { bundle } = await getBundle(env, owner);
  if (bundle.redirectUri !== redirectUri) return callbackResult("error");
  if (Number(consumed.payload.appId) !== bundle.appId) return callbackResult("error");

  // GitHub explicitly warns that installation_id on a setup URL can be spoofed.
  // Do not trust it until a GitHub user token confirms that this user can see
  // this exact installation and that it belongs to this App.
  const verifier = randomState() + randomState();
  const challenge = b64url(await sha256Bytes(verifier));
  const authState = await createState(env, owner, "user_authorization", {
    appId: bundle.appId,
    installationId,
    redirectUri: bundle.redirectUri,
    codeVerifier: verifier,
  });
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", bundle.clientId);
  authorize.searchParams.set("redirect_uri", bundle.redirectUri);
  authorize.searchParams.set("state", authState);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return new Response(null, {
    status: 303,
    headers: { location: authorize.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
async function exchangeUserCode(bundle: Bundle, code: string, verifier: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "BRɅIN-Owner-Memory" },
    body: new URLSearchParams({
      client_id: bundle.clientId,
      client_secret: bundle.clientSecret,
      code,
      redirect_uri: bundle.redirectUri,
      code_verifier: verifier,
    }).toString(),
  });
  const raw = await response.text();
  let result: { access_token?: string } = {};
  try { result = raw ? JSON.parse(raw) as typeof result : {}; } catch { result = {}; }
  if (!response.ok || !result.access_token) throw new Error("GitHub account authorization could not be verified.");
  return result.access_token;
}
async function userAuthorizationCallback(env: Env, url: URL): Promise<Response> {
  const code = clean(url.searchParams.get("code"), 1024);
  const state = clean(url.searchParams.get("state"), 128);
  if (!code || !state || url.searchParams.has("error")) return callbackResult("error");
  const consumed = await consumeState(env, state, "user_authorization");
  if (!consumed) return callbackResult("error");
  const owner = consumed.owner_id;
  const redirectUri = clean(consumed.payload.redirectUri, 500);
  if (!redirectUri || new URL(redirectUri).origin !== url.origin || new URL(redirectUri).pathname !== CALLBACK) {
    return callbackResult("error");
  }
  const { bundle } = await getBundle(env, owner);
  const installationId = Number(consumed.payload.installationId);
  if (Number(consumed.payload.appId) !== bundle.appId || !Number.isSafeInteger(installationId) || installationId < 1) {
    return callbackResult("error");
  }
  const verifier = clean(consumed.payload.codeVerifier, 200);
  if (verifier.length < 43) return callbackResult("error");
  const userToken = await exchangeUserCode(bundle, code, verifier);
  const user = (await github<{ id?: number; login?: string }>("/user", userToken)).data;
  if (!Number.isSafeInteger(Number(user.id)) || !clean(user.login, 100)) return callbackResult("error");

  const installations: GitHubInstallation[] = [];
  let page = 1;
  while (page <= 5) {
    const result = await github<{ installations?: GitHubInstallation[] }>(
      "/user/installations?per_page=100&page=" + page, userToken,
    );
    installations.push(...(result.data.installations || []));
    if (!/rel="next"/u.test(result.headers.get("link") || "")) break;
    page += 1;
  }
  const selected = installations.find((item) =>
    Number(item.id) === installationId && Number(item.app_id) === bundle.appId,
  );
  if (!selected || !clean(selected.account?.login, 100) || selected.repository_selection !== "selected" ||
      selected.permissions?.metadata !== "read" || selected.permissions?.contents !== "write") {
    return callbackResult("error");
  }

  const now = Date.now();
  const saved = await env.DB!.prepare(
    "INSERT INTO " + INSTALL_TABLE +
    " (owner_id, installation_id, app_id, account_login, account_type, repository_selection, status, authorized_user, created_at, updated_at)" +
    " VALUES (?, ?, ?, ?, ?, 'selected', 'active', ?, ?, ?)" +
    " ON CONFLICT(owner_id, installation_id) DO UPDATE SET app_id=excluded.app_id, account_login=excluded.account_login," +
    " account_type=excluded.account_type, repository_selection='selected', status='active'," +
    " authorized_user=excluded.authorized_user, updated_at=excluded.updated_at",
  ).bind(owner, installationId, bundle.appId, clean(selected.account?.login, 100),
    clean(selected.account?.type, 40), clean(user.login, 100), now, now).run();
  if (!saved.success) throw new Error("D1 did not confirm the verified GitHub installation.");
  await env.DB!.prepare("UPDATE " + APP_TABLE + " SET status='authorized', updated_at=? WHERE owner_id=? AND app_id=?")
    .bind(now, owner, bundle.appId).run();
  // The temporary user access token is deliberately not persisted.
  return callbackResult("installed");
}
export async function handleOwnerGithubCallback(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    await ensureSchema(env);
    const state = clean(url.searchParams.get("state"), 128);
    if (!state) return callbackResult("error");
    const row = await env.DB!.prepare("SELECT purpose FROM " + STATE_TABLE + " WHERE state_hash=? AND expires_at>?")
      .bind(await sha256(state), Date.now()).first<{ purpose: string }>();
    if (!row) return callbackResult("error");
    if (url.pathname === CALLBACK) {
      if (row.purpose === "manifest") return await manifestCallback(env, request, url);
      if (row.purpose === "user_authorization") return await userAuthorizationCallback(env, url);
      return callbackResult("error");
    }
    if (url.pathname === SETUP && row.purpose === "installation") return await installationCallback(env, url);
    return notFound();
  } catch {
    return callbackResult("error");
  }
}
async function installationToken(env: Env, owner: string, installationId: number, repositoryId?: number): Promise<string> {
  const { row, bundle, token } = await installationJwt(env, owner);
  const known = await env.DB!.prepare("SELECT installation_id FROM " + INSTALL_TABLE + " WHERE owner_id=? AND installation_id=? AND app_id=? AND status='active'")
    .bind(owner, installationId, row.app_id).first<{ installation_id: number }>();
  if (!known) throw new Error("That GitHub installation has not been verified for this Owner.");
  const body: Record<string, unknown> = { permissions: { contents: "write" } };
  if (repositoryId !== undefined) body.repository_ids = [repositoryId];
  body.permissions = { contents: "read" };
  const result = await github<{ token?: string }>("/app/installations/" + installationId + "/access_tokens", token, "POST", body);
  if (!result.data.token) throw new Error("GitHub did not issue a short-lived repository token.");
  void bundle;
  return result.data.token;
}
async function listInstallations(env: Env, owner: string): Promise<InstallationRow[]> {
  await ensureSchema(env);
  const row = await appRow(env, owner);
  if (!row) return [];
  const result = await env.DB!.prepare("SELECT installation_id, account_login, account_type, repository_selection, authorized_user FROM " + INSTALL_TABLE + " WHERE owner_id=? AND app_id=? AND status='active' ORDER BY account_login ASC")
    .bind(owner, row.app_id).all<InstallationRow>();
  return (result.results ?? []).map((item) => ({ ...item, installation_id: Number(item.installation_id) }));
}
async function listRepositories(env: Env, owner: string, installationId: number): Promise<Response> {
  const token = await installationToken(env, owner, installationId);
  const repositories: Array<{ id: number; full_name: string; private: boolean; archived: boolean; default_branch: string }> = [];
  let page = 1;
  while (page <= 5) {
    const result = await github<{ repositories?: typeof repositories }>("/installation/repositories?per_page=100&page=" + page, token);
    repositories.push(...(result.data.repositories || []));
    if (!/rel="next"/u.test(result.headers.get("link") || "")) break;
    page += 1;
  }
  return json({ ok: true, repositories: repositories.filter((repo) =>
    Number.isSafeInteger(Number(repo.id)) && Number(repo.id) > 0 && repo.full_name && repo.default_branch && repo.archived !== true,
  ).map((repo) => ({ id: Number(repo.id), fullName: clean(repo.full_name, 200), private: repo.private === true, defaultBranch: clean(repo.default_branch, 100) })) });
}
async function attachRepository(env: Env, owner: string, topicId: string, input: {
  installationId: number; repositoryId: number; repositoryFullName: string; branch: string; memoryRoot: string;
}): Promise<Response> {
  const topic = await env.DB!.prepare("SELECT id FROM owner_intelligence_topics WHERE id=? AND owner_id=? AND lifecycle_status='active'")
    .bind(topicId, owner).first<{ id: string }>();
  if (!topic) return notFound();
  const fullName = input.repositoryFullName.toLowerCase();
  if (!/^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/u.test(fullName) ||
      !/^[A-Za-z0-9._/-]{1,120}$/u.test(input.branch) || input.branch.startsWith("/") ||
      input.branch.split("/").some((part) => !part || part === "." || part === "..") ||
      !/^[A-Za-z0-9._/-]{1,180}$/u.test(input.memoryRoot) ||
      input.memoryRoot.startsWith("/") || input.memoryRoot.split("/").some((part) => !part || part === "." || part === "..")) {
    return json({ ok: false, error: "invalid_repository_selection" }, 400);
  }
  const token = await installationToken(env, owner, input.installationId, input.repositoryId);
  const parts = fullName.split("/");
  const repo = (await github<{ id?: number; full_name?: string; archived?: boolean }>(
    "/repos/" + encodeURIComponent(parts[0]) + "/" + encodeURIComponent(parts[1]), token,
  )).data;
  if (Number(repo.id) !== input.repositoryId || clean(repo.full_name, 200).toLowerCase() !== fullName || repo.archived === true) {
    return json({ ok: false, error: "repository_not_verified" }, 400);
  }
  const branchPath = "/repos/" + encodeURIComponent(parts[0]) + "/" + encodeURIComponent(parts[1]) + "/branches/" +
    encodeURIComponent(input.branch);
  const branch = (await github<{ name?: string }>(branchPath, token)).data;
  if (clean(branch.name, 120) !== input.branch) return json({ ok: false, error: "branch_not_verified" }, 400);
  const update = await env.DB!.prepare("UPDATE owner_intelligence_topics SET github_installation_id=?, repository_id=?, repository_owner=?, repository_name=?, repository_branch=?, memory_root=?, updated_at=? WHERE id=? AND owner_id=?")
    .bind(input.installationId, input.repositoryId, parts[0], parts[1], input.branch, input.memoryRoot, Date.now(), topicId, owner).run();
  if (!update.success) throw new Error("D1 did not confirm the topic repository selection.");
  return json({ ok: true, topicId, repository: fullName, branch: input.branch, memoryRoot: input.memoryRoot,
    note: "Repository attached. Project Memory loading is a separate M4.4 step." });
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
export async function handleOwnerGithubApi(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    const owner = principal(env); await ensureSchema(env);
    const root = "/admin/api/intelligence/github";
    if (url.pathname === root + "/status") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      const row = await appRow(env, owner);
      if (!row) return json({ ok: true, configured: false, authorized: false, app: null, installations: [] });
      const installations = await listInstallations(env, owner);
      return json({ ok: true, configured: true, authorized: installations.length > 0,
        app: { appId: Number(row.app_id), slug: row.app_slug, name: row.app_name, status: row.status },
        installations: installations.map((item) => ({ id: item.installation_id, account: item.account_login, accountType: item.account_type, repositorySelection: item.repository_selection, authorizedUser: item.authorized_user })) });
    }
    if (url.pathname === root + "/app/manifest") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      if (!sameOrigin(request)) return json({ ok: false, error: "same_origin_required" }, 403);
      return await startManifest(env, request, owner);
    }
    if (url.pathname === root + "/install") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      if (!sameOrigin(request)) return json({ ok: false, error: "same_origin_required" }, 403);
      return await installApp(env, request, owner);
    }
    const repositories = url.pathname.match(/^\/admin\/api\/intelligence\/github\/installations\/([0-9]+)\/repositories$/u);
    if (repositories) {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      const id = Number(repositories[1]);
      if (!Number.isSafeInteger(id) || id < 1) return notFound();
      return await listRepositories(env, owner, id);
    }
    const attach = url.pathname.match(/^\/admin\/api\/intelligence\/github\/topics\/([0-9a-f-]{36})\/repository$/iu);
    if (attach) {
      if (request.method !== "PATCH") return methodNotAllowed(["PATCH"]);
      if (!sameOrigin(request)) return json({ ok: false, error: "same_origin_required" }, 403);
      let body: Record<string, unknown>;
      try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: "invalid_request" }, 400); }
      const allowed = ["installationId", "repositoryId", "repositoryFullName", "branch", "memoryRoot"];
      if (!body || Object.keys(body).some((key) => !allowed.includes(key)) ||
          !Number.isSafeInteger(body.installationId) || Number(body.installationId) < 1 ||
          !Number.isSafeInteger(body.repositoryId) || Number(body.repositoryId) < 1 ||
          typeof body.repositoryFullName !== "string" || typeof body.branch !== "string" || typeof body.memoryRoot !== "string") {
        return json({ ok: false, error: "invalid_request" }, 400);
      }
      return await attachRepository(env, owner, attach[1], {
        installationId: Number(body.installationId), repositoryId: Number(body.repositoryId),
        repositoryFullName: body.repositoryFullName, branch: body.branch, memoryRoot: body.memoryRoot,
      });
    }
    return notFound();
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub setup failed.";
    return json({ ok: false, error: "github_setup_failed", message: message.replace(/[\r\n]+/gu, " ").slice(0, 240) }, 502);
  }
}
