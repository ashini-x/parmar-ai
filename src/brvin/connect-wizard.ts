import type { Env } from "../config/env";
import { ensureAnalyticsSchema, recordBrvinActivity } from "../analytics/db";
import { json } from "../http/response";

type Provider = "github" | "cloudflare";
type ConnectionRow = { provider: string; status: string; metadata_json: string; secret_ciphertext: string; updated_at: number };
type StateRow = { payload_json: string };

const GITHUB_API = "https://api.github.com";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_AUTH = "https://dash.cloudflare.com/oauth2/auth";
const CLOUDFLARE_TOKEN = "https://dash.cloudflare.com/oauth2/token";
const TEST_REPOSITORY = "ashini-x/askmoina-voice";
const TEST_CONFIG_PATH = "wrangler.brvin-test-client.jsonc";
const TEST_WORKER_NAME = "brvin-test-client";
const BRVIN_SERVICE_NAME = "brvin-service";

function clean(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/-/gu, "+").replace(/_/gu, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function encodeText(value: string): string {
  return base64(new TextEncoder().encode(value));
}

function decodeText(value: string): string {
  return new TextDecoder().decode(fromBase64(value));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function stateHash(value: string): Promise<string> {
  return [...await sha256(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function encryptionSecret(env: Env): string {
  const secret = env.ADMIN_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("The administrator session secret must be configured before provider credentials can be stored.");
  return secret;
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const material = await sha256("BRVIN provider connection vault v1\0" + encryptionSecret(env));
  return crypto.subtle.importKey("raw", ownedBuffer(material), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(env: Env, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedBuffer(iv), additionalData: ownedBuffer(new TextEncoder().encode("brvin-provider-connection:v1")) },
    await encryptionKey(env),
    ownedBuffer(new TextEncoder().encode(JSON.stringify(value))),
  );
  return base64Url(iv) + "." + base64Url(new Uint8Array(cipher));
}

async function decryptSecret<T>(env: Env, value: string): Promise<T> {
  const [ivText, cipherText] = value.split(".");
  if (!ivText || !cipherText) throw new Error("Stored provider credentials are not readable. Reconnect the provider.");
  try {
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ownedBuffer(fromBase64(ivText)), additionalData: ownedBuffer(new TextEncoder().encode("brvin-provider-connection:v1")) },
      await encryptionKey(env),
      ownedBuffer(fromBase64(cipherText)),
    );
    return JSON.parse(new TextDecoder().decode(clear)) as T;
  } catch {
    throw new Error("Stored provider credentials could not be decrypted. The admin session secret may have changed; reconnect the provider.");
  }
}

async function connection(env: Env, provider: Provider): Promise<ConnectionRow | null> {
  if (!env.DB) throw new Error("BRVIN D1 is not configured.");
  await ensureAnalyticsSchema(env);
  return env.DB.prepare(
    "SELECT provider,status,metadata_json,secret_ciphertext,updated_at FROM brvin_provider_connections WHERE provider=?"
  ).bind(provider).first<ConnectionRow>();
}

async function saveConnection(
  env: Env,
  provider: Provider,
  status: string,
  metadata: Record<string, unknown>,
  secret: unknown,
): Promise<void> {
  if (!env.DB) throw new Error("BRVIN D1 is not configured.");
  await ensureAnalyticsSchema(env);
  const now = Date.now();
  const encrypted = await encryptSecret(env, secret);
  await env.DB.prepare(
    "INSERT INTO brvin_provider_connections (provider,status,metadata_json,secret_ciphertext,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET status=excluded.status,metadata_json=excluded.metadata_json," +
    "secret_ciphertext=excluded.secret_ciphertext,updated_at=excluded.updated_at"
  ).bind(provider, status, JSON.stringify(metadata), encrypted, now, now).run();
}

async function createState(env: Env, provider: Provider, payload: Record<string, unknown>): Promise<string> {
  if (!env.DB) throw new Error("BRVIN D1 is not configured.");
  await ensureAnalyticsSchema(env);
  const state = randomToken();
  await env.DB.prepare(
    "INSERT INTO brvin_oauth_states (state_hash,provider,payload_json,expires_at,created_at) VALUES (?,?,?,?,?)"
  ).bind(await stateHash(state), provider, JSON.stringify(payload), Date.now() + 10 * 60_000, Date.now()).run();
  return state;
}

async function consumeState(env: Env, provider: Provider, state: string): Promise<Record<string, unknown> | null> {
  if (!env.DB || state.length < 32 || state.length > 128) return null;
  await ensureAnalyticsSchema(env);
  const row = await env.DB.prepare(
    "DELETE FROM brvin_oauth_states WHERE state_hash=? AND provider=? AND expires_at>? RETURNING payload_json"
  ).bind(await stateHash(state), provider, Date.now()).first<StateRow>();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function audit(env: Env, provider: Provider, eventType: string, message: string, details: Record<string, unknown> = {}): Promise<void> {
  if (!env.DB) return;
  await ensureAnalyticsSchema(env);
  await env.DB.prepare(
    "INSERT INTO brvin_connection_events (provider,event_type,status,message,detail_json,created_at) VALUES (?,?,?,?,?,?)"
  ).bind(provider, eventType, "completed", message, JSON.stringify(details).slice(0, 6000), Date.now()).run();
}

function callbackUrl(request: Request, provider: Provider): string {
  const url = new URL(request.url);
  return url.origin + "/admin/brvin/connect/" + provider + "/callback";
}

function callbackHtml(title: string, message: string, success: boolean): Response {
  const safeTitle = title.replace(/[&<>"']/gu, "");
  const safeMessage = message.replace(/[&<>"']/gu, "");
  const color = success ? "#16835b" : "#b33b3b";
  const html = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>" + safeTitle + " · BRVIN</title><style>body{font-family:system-ui,sans-serif;background:#f5f5f7;color:#17191f;padding:32px}.card{max-width:540px;margin:10vh auto;background:white;border:1px solid #e7e8ec;border-radius:18px;padding:28px}h1{font-size:22px}p{color:#626875;line-height:1.6}.status{color:" + color + ";font-weight:700}a{color:#2764d8}</style>" +
    "<main class=\"card\"><h1>" + safeTitle + "</h1><p class=\"status\">" + (success ? "Connection step completed" : "Connection step did not complete") + "</p><p>" + safeMessage + "</p><p><a href=\"/admin/brvin\">Return to BRVIN administration</a></p></main></html>";
  return new Response(html, { status: success ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

async function githubRequest<T>(path: string, token: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(GITHUB_API + path, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + token,
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) {
    const detail = data && typeof data === "object" && "message" in data ? clean((data as { message?: unknown }).message, 260) : "GitHub request failed.";
    throw new Error("GitHub API (" + response.status + "): " + detail);
  }
  return data as T;
}

type GitHubBundle = {
  appId: number;
  slug: string;
  name: string;
  privateKey: string;
  installationId?: number;
  installationAccount?: string;
  installationType?: string;
  lastRepository?: string;
  lastPullRequestUrl?: string;
};

function derLength(length: number): Uint8Array {
  if (length < 128) return new Uint8Array([length]);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) { bytes.unshift(value & 255); value >>>= 8; }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, content: Uint8Array): Uint8Array {
  const length = derLength(content.length);
  const out = new Uint8Array(1 + length.length + content.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(content, 1 + length.length);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function githubPrivateKeyPkcs8(pem: string): Uint8Array {
  const base64Body = pem.replace(/-----BEGIN [^-]+-----/gu, "").replace(/-----END [^-]+-----/gu, "").replace(/\s/gu, "");
  const keyBytes = fromBase64(base64Body);
  if (pem.includes("BEGIN PRIVATE KEY")) return keyBytes;
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) throw new Error("GitHub returned an unsupported private key format.");
  const algorithm = new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
  const privateOctet = der(0x04, keyBytes);
  return der(0x30, concatBytes(new Uint8Array([0x02,0x01,0x00]), algorithm, privateOctet));
}

async function githubAppJwt(bundle: GitHubBundle): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    ownedBuffer(githubPrivateKeyPkcs8(bundle.privateKey)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ iat: now - 30, exp: now + 8 * 60, iss: bundle.appId })));
  const unsigned = header + "." + payload;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, ownedBuffer(new TextEncoder().encode(unsigned))));
  return unsigned + "." + base64Url(signature);
}

async function getGitHubBundle(env: Env): Promise<{ row: ConnectionRow; bundle: GitHubBundle }> {
  const row = await connection(env, "github");
  if (!row || row.status === "revoked") throw new Error("Connect the BRVIN GitHub App first.");
  const bundle = await decryptSecret<GitHubBundle>(env, row.secret_ciphertext);
  if (!bundle.appId || !bundle.privateKey || !bundle.slug) throw new Error("The stored GitHub App is incomplete. Reconnect GitHub.");
  return { row, bundle };
}

async function githubAppRequest<T>(env: Env, bundle: GitHubBundle, path: string, method = "GET", body?: unknown): Promise<T> {
  return githubRequest<T>(path, await githubAppJwt(bundle), method, body);
}

async function githubInstallationToken(env: Env, bundle: GitHubBundle, repository?: string): Promise<string> {
  if (!bundle.installationId) throw new Error("Install the BRVIN GitHub App on a repository and select that installation first.");
  const body = repository ? { repositories: [repository.split("/").pop() || repository] } : {};
  const response = await githubAppRequest<{ token?: string }>(
    env, bundle, "/app/installations/" + bundle.installationId + "/access_tokens", "POST", body,
  );
  if (!response.token) throw new Error("GitHub did not issue an installation access token.");
  return response.token;
}

async function cloudflareApi<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(CLOUDFLARE_API + path, { headers: { authorization: "Bearer " + accessToken } });
  const text = await response.text();
  let data: { success?: boolean; result?: T; errors?: Array<{ message?: string }> } = {};
  try { data = text ? JSON.parse(text) as typeof data : {}; } catch { data = {}; }
  if (!response.ok || data.success === false) {
    const detail = data.errors?.map(error => clean(error.message, 160)).filter(Boolean).join("; ") || "Cloudflare API request failed.";
    throw new Error("Cloudflare API (" + response.status + "): " + detail);
  }
  return data.result as T;
}

type CloudflareBundle = {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  accountId?: string;
};

async function getCloudflareBundle(env: Env): Promise<{ row: ConnectionRow; bundle: CloudflareBundle }> {
  const row = await connection(env, "cloudflare");
  if (!row || row.status === "revoked") throw new Error("Configure and authorize the Cloudflare OAuth client first.");
  const bundle = await decryptSecret<CloudflareBundle>(env, row.secret_ciphertext);
  if (!bundle.clientId || !bundle.clientSecret) throw new Error("Cloudflare OAuth client credentials are incomplete.");
  return { row, bundle };
}

function accountScripts(scripts: Array<Record<string, unknown>>): Array<{ name: string; modifiedOn: string | null }> {
  return scripts.map(script => ({
    name: clean(script.id || script.script || script.name, 128),
    modifiedOn: typeof script.modified_on === "string" ? script.modified_on : null,
  })).filter(script => script.name).sort((a, b) => a.name.localeCompare(b.name));
}

export async function brvinConnectStatus(env: Env): Promise<Response> {
  try {
    const [github, cloudflare] = await Promise.all([connection(env, "github"), connection(env, "cloudflare")]);
    const githubMeta = github ? JSON.parse(github.metadata_json || "{}") as Record<string, unknown> : {};
    const cfMeta = cloudflare ? JSON.parse(cloudflare.metadata_json || "{}") as Record<string, unknown> : {};
    return json({
      ok: true,
      github: {
        status: github?.status || "not_connected",
        appName: clean(githubMeta.appName, 100),
        appSlug: clean(githubMeta.slug, 100),
        appUrl: clean(githubMeta.htmlUrl, 240),
        installationId: Number(githubMeta.installationId || 0) || null,
        installationAccount: clean(githubMeta.installationAccount, 100) || null,
        selectedRepository: clean(githubMeta.selectedRepository, 200) || null,
        pullRequestUrl: clean(githubMeta.pullRequestUrl, 500) || null,
      },
      cloudflare: {
        status: cloudflare?.status || "not_configured",
        accountId: clean(cfMeta.accountId, 32) || clean(env.BRVIN_HOME_ACCOUNT_ID, 32) || null,
        brvinServiceVisible: cfMeta.brvinServiceVisible === true,
        lastWorkerDiscoveryAt: Number(cfMeta.lastWorkerDiscoveryAt || 0) || null,
      },
      supportedAdapter: { repository: TEST_REPOSITORY, configPath: TEST_CONFIG_PATH, worker: TEST_WORKER_NAME },
    });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 500);
  }
}

export async function startBrvinGitHubManifest(env: Env, request: Request): Promise<Response> {
  try {
    if (!env.DB) return json({ ok: false, error: "BRVIN D1 is not configured." }, 503);
    encryptionSecret(env);
    const state = await createState(env, "github", { purpose: "manifest" });
    const origin = new URL(request.url).origin;
    const redirect = origin + "/admin/brvin/connect/github/callback";
    const manifest = {
      name: "BRVIN Connect",
      url: origin + "/admin/brvin",
      description: "Private repository-scoped connector for onboarding Cloudflare Workers to BRVIN.",
      redirect_url: redirect,
      public: false,
      default_permissions: { metadata: "read", contents: "write", pull_requests: "write" },
      default_events: [],
    };
    return json({ ok: true, action: "https://github.com/settings/apps/new?state=" + encodeURIComponent(state), manifest });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 500);
  }
}

export async function completeBrvinGitHubManifest(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = clean(url.searchParams.get("code"), 128);
  const state = clean(url.searchParams.get("state"), 128);
  if (url.searchParams.has("error")) return callbackHtml("GitHub app registration cancelled", "GitHub did not complete the app registration. Return to BRVIN and try again.", false);
  if (!code || !state) return callbackHtml("GitHub callback is incomplete", "The temporary GitHub code or state is missing. Start the registration again from BRVIN.", false);
  try {
    const statePayload = await consumeState(env, "github", state);
    if (!statePayload || statePayload.purpose !== "manifest") return callbackHtml("GitHub setup expired", "This one-time registration state was invalid, expired or already used. Start again from BRVIN.", false);
    const response = await fetch(GITHUB_API + "/app-manifests/" + encodeURIComponent(code) + "/conversions", {
      method: "POST",
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
    const text = await response.text();
    let payload: unknown = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    const app = payload as { id?: number; slug?: string; name?: string; html_url?: string; pem?: string; permissions?: Record<string, string> };
    if (!response.ok || !app.id || !app.slug || !app.pem) {
      const message = (payload as { message?: string }).message || "GitHub could not complete the manifest registration.";
      return callbackHtml("GitHub app registration failed", clean(message, 240), false);
    }
    const permissions = app.permissions || {};
    if (permissions.metadata !== "read" || permissions.contents !== "write" || permissions.pull_requests !== "write") {
      return callbackHtml("GitHub permissions did not match", "The created app does not have the expected least-privilege repository permissions. Delete it in GitHub and restart the setup.", false);
    }
    const metadata = { appName: clean(app.name, 100), slug: app.slug, htmlUrl: clean(app.html_url, 240), createdAt: Date.now(), installationId: null };
    await saveConnection(env, "github", "app_created", metadata, {
      appId: app.id,
      slug: app.slug,
      name: clean(app.name, 100),
      privateKey: app.pem,
    } satisfies GitHubBundle);
    await audit(env, "github", "github.app_created", "A private least-privilege GitHub App was created through the manifest flow.", { appId: app.id, slug: app.slug });
    return callbackHtml("GitHub App created", "BRVIN's private GitHub App was created and its private key is encrypted in BRVIN D1. Return to BRVIN, then install the app on the one repository you want to connect.", true);
  } catch (error) {
    return callbackHtml("GitHub app registration failed", safeError(error), false);
  }
}

export async function listBrvinGitHubInstallations(env: Env): Promise<Response> {
  try {
    const { bundle } = await getGitHubBundle(env);
    const installations = await githubAppRequest<Array<Record<string, unknown>>>(env, bundle, "/app/installations");
    return json({
      ok: true,
      installations: installations.map(item => ({
        id: Number(item.id),
        account: clean((item.account as Record<string, unknown> | undefined)?.login, 100),
        accountType: clean((item.account as Record<string, unknown> | undefined)?.type, 40),
        targetType: clean(item.target_type, 40),
        htmlUrl: clean((item.account as Record<string, unknown> | undefined)?.html_url, 240),
      })).filter(item => Number.isSafeInteger(item.id) && item.id > 0),
    });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function selectBrvinGitHubInstallation(env: Env, request: Request): Promise<Response> {
  let body: { installationId?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid GitHub installation selection." }, 400); }
  const installationId = Number(body.installationId);
  if (!Number.isSafeInteger(installationId) || installationId < 1) return json({ ok: false, error: "Choose a valid GitHub installation." }, 400);
  try {
    const { row, bundle } = await getGitHubBundle(env);
    const installations = await githubAppRequest<Array<Record<string, unknown>>>(env, bundle, "/app/installations");
    const selected = installations.find(item => Number(item.id) === installationId);
    if (!selected) return json({ ok: false, error: "That installation does not belong to the BRVIN GitHub App." }, 403);
    const account = selected.account as Record<string, unknown> | undefined;
    const next = {
      ...bundle, installationId,
      installationAccount: clean(account?.login, 100),
      installationType: clean(account?.type, 40),
      lastRepository: undefined,
      lastPullRequestUrl: undefined,
    };
    const metadata = JSON.parse(row.metadata_json || "{}") as Record<string, unknown>;
    await saveConnection(env, "github", "installed", {
      ...metadata,
      installationId,
      installationAccount: next.installationAccount,
      installationType: next.installationType,
      selectedRepository: null,
      pullRequestUrl: null,
    }, next);
    await audit(env, "github", "github.installation_selected", "A GitHub App installation was verified and selected.", { installationId, account: next.installationAccount });
    return json({ ok: true, installationId, account: next.installationAccount, accountType: next.installationType });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function listBrvinGitHubRepositories(env: Env): Promise<Response> {
  try {
    const { bundle } = await getGitHubBundle(env);
    const token = await githubInstallationToken(env, bundle);
    const response = await githubRequest<{ repositories?: Array<Record<string, unknown>>; total_count?: number }>("/installation/repositories?per_page=100", token);
    return json({
      ok: true,
      totalCount: Number(response.total_count || 0),
      repositories: (response.repositories || []).map(repo => ({
        fullName: clean(repo.full_name, 200),
        defaultBranch: clean(repo.default_branch, 100),
        private: repo.private === true,
        archived: repo.archived === true,
      })).filter(repo => repo.fullName && repo.defaultBranch && !repo.archived),
    });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function configureBrvinCloudflareOAuth(env: Env, request: Request): Promise<Response> {
  let body: { clientId?: unknown; clientSecret?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid Cloudflare OAuth client details." }, 400); }
  const clientId = clean(body.clientId, 160);
  const clientSecret = clean(body.clientSecret, 500);
  if (!/^[A-Za-z0-9._-]{8,160}$/u.test(clientId) || clientSecret.length < 16) {
    return json({ ok: false, error: "Enter the Cloudflare OAuth client ID and client secret exactly as displayed when the client was created." }, 400);
  }
  try {
    encryptionSecret(env);
    const existing = await connection(env, "cloudflare");
    const previous = existing ? JSON.parse(existing.metadata_json || "{}") as Record<string, unknown> : {};
    await saveConnection(env, "cloudflare", "configured", {
      ...previous,
      clientIdHint: clientId.slice(0, 12) + "…",
      redirectUri: callbackUrl(request, "cloudflare"),
      configuredAt: Date.now(),
      brvinServiceVisible: false,
    }, { clientId, clientSecret } satisfies CloudflareBundle);
    await audit(env, "cloudflare", "cloudflare.oauth_client_configured", "Cloudflare OAuth client credentials were stored encrypted.", { clientIdHint: clientId.slice(0, 12) });
    return json({ ok: true, status: "configured", redirectUri: callbackUrl(request, "cloudflare") });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 500);
  }
}

export async function startBrvinCloudflareOAuth(env: Env, request: Request): Promise<Response> {
  try {
    const { bundle } = await getCloudflareBundle(env);
    const accountId = clean(env.BRVIN_HOME_ACCOUNT_ID, 32);
    if (!/^[a-f0-9]{32}$/iu.test(accountId)) throw new Error("BRVIN_HOME_ACCOUNT_ID is not configured for the Cloudflare account that hosts brvin-service.");
    const state = await createState(env, "cloudflare", { purpose: "authorization", accountId });
    const url = new URL(CLOUDFLARE_AUTH);
    url.searchParams.set("client_id", bundle.clientId);
    url.searchParams.set("redirect_uri", callbackUrl(request, "cloudflare"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "workers-scripts.read workers-scripts.write offline_access");
    url.searchParams.set("state", state);
    return json({ ok: true, authorizationUrl: url.toString() });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 400);
  }
}

async function exchangeCloudflareToken(bundle: CloudflareBundle, form: Record<string, string>, redirectUri: string): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }> {
  const formBody = new URLSearchParams({ ...form, redirect_uri: redirectUri });
  const basic = btoa(bundle.clientId + ":" + bundle.clientSecret);
  const response = await fetch(CLOUDFLARE_TOKEN, {
    method: "POST",
    headers: { authorization: "Basic " + basic, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: formBody.toString(),
  });
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  const data = payload as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error("Cloudflare OAuth token exchange failed: " + clean(data.error_description || data.error || "authorization was not accepted", 240));
  return data as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
}

export async function completeBrvinCloudflareOAuth(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = clean(url.searchParams.get("code"), 2048);
  const state = clean(url.searchParams.get("state"), 128);
  if (url.searchParams.has("error")) return callbackHtml("Cloudflare authorization cancelled", "Cloudflare did not authorize the BRVIN connector. Return to BRVIN and try again.", false);
  if (!code || !state) return callbackHtml("Cloudflare callback is incomplete", "The authorization code or state is missing. Start the connection again from BRVIN.", false);
  try {
    const statePayload = await consumeState(env, "cloudflare", state);
    if (!statePayload || statePayload.purpose !== "authorization") return callbackHtml("Cloudflare authorization expired", "This one-time authorization state was invalid, expired or already used. Start again from BRVIN.", false);
    const { row, bundle } = await getCloudflareBundle(env);
    const token = await exchangeCloudflareToken(bundle, { grant_type: "authorization_code", code }, callbackUrl(request, "cloudflare"));
    const grantedScopes = new Set((token.scope || "").split(/\s+/u).filter(Boolean));
    if (!grantedScopes.has("workers-scripts.read") || !grantedScopes.has("workers-scripts.write") || !token.refresh_token) {
      return callbackHtml(
        "Cloudflare permissions incomplete",
        "BRVIN requires both Workers Scripts Read and Workers Scripts Write, plus a refresh token. Update the OAuth client so these scopes are required, then authorize again.",
        false,
      );
    }
    const accountId = clean(statePayload.accountId, 32);
    if (accountId !== clean(env.BRVIN_HOME_ACCOUNT_ID, 32)) return callbackHtml("Cloudflare account mismatch", "The BRVIN home account configuration changed during authorization. Start the connection again.", false);
    const scripts = await cloudflareApi<Array<Record<string, unknown>>>(token.access_token, "/accounts/" + accountId + "/workers/scripts?per_page=100");
    const names = scripts.map(script => clean(script.id || script.script || script.name, 128)).filter(Boolean);
    if (!names.includes(BRVIN_SERVICE_NAME)) return callbackHtml("Cloudflare account mismatch", "The authorized Cloudflare account does not contain the private brvin-service Worker. No connection was saved. Authorize the account that hosts BRVIN.", false);
    const next: CloudflareBundle = {
      ...bundle,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessTokenExpiresAt: Date.now() + Math.max(60, Number(token.expires_in || 900)) * 1000,
      accountId,
    };
    const metadata = JSON.parse(row.metadata_json || "{}") as Record<string, unknown>;
    await saveConnection(env, "cloudflare", "connected", {
      ...metadata, accountId, brvinServiceVisible: true, lastWorkerDiscoveryAt: Date.now(),
      workerCount: names.length, scope: clean(token.scope, 500), authorizedAt: Date.now(),
    }, next);
    await audit(env, "cloudflare", "cloudflare.account_authorized", "Cloudflare OAuth access was verified against the account hosting the private brvin-service Worker.", { accountId, workerCount: names.length });
    return callbackHtml("Cloudflare account connected", "BRVIN confirmed that this OAuth authorization can read the Cloudflare account containing the private brvin-service Worker. Return to BRVIN to discover Workers and prepare the isolated test-client pull request.", true);
  } catch (error) {
    return callbackHtml("Cloudflare connection failed", safeError(error), false);
  }
}

async function refreshCloudflareAccessToken(env: Env, row: ConnectionRow, bundle: CloudflareBundle, redirectUri: string): Promise<{ accessToken: string; bundle: CloudflareBundle }> {
  if (bundle.accessToken && (bundle.accessTokenExpiresAt || 0) > Date.now() + 60_000) return { accessToken: bundle.accessToken, bundle };
  if (!bundle.refreshToken) throw new Error("The Cloudflare OAuth session has expired. Re-authorize Cloudflare from the Connect Application panel.");
  const result = await exchangeCloudflareToken(bundle, { grant_type: "refresh_token", refresh_token: bundle.refreshToken }, redirectUri);
  const next: CloudflareBundle = {
    ...bundle, accessToken: result.access_token, refreshToken: result.refresh_token || bundle.refreshToken,
    accessTokenExpiresAt: Date.now() + Math.max(60, Number(result.expires_in || 900)) * 1000,
  };
  const metadata = JSON.parse(row.metadata_json || "{}") as Record<string, unknown>;
  await saveConnection(env, "cloudflare", "connected", metadata, next);
  return { accessToken: next.accessToken!, bundle: next };
}

async function authorizedCloudflare(env: Env, request: Request): Promise<{ accessToken: string; bundle: CloudflareBundle; scripts: Array<Record<string, unknown>> }> {
  const accountId = clean(env.BRVIN_HOME_ACCOUNT_ID, 32);
  if (!/^[a-f0-9]{32}$/iu.test(accountId)) throw new Error("BRVIN_HOME_ACCOUNT_ID is not configured. Set it to the Cloudflare account that hosts brvin-service.");
  const { row, bundle } = await getCloudflareBundle(env);
  const refreshed = await refreshCloudflareAccessToken(env, row, bundle, callbackUrl(request, "cloudflare"));
  const scripts = await cloudflareApi<Array<Record<string, unknown>>>(refreshed.accessToken, "/accounts/" + accountId + "/workers/scripts?per_page=100");
  const brvin = scripts.some(script => clean(script.id || script.script || script.name, 128) === BRVIN_SERVICE_NAME);
  if (!brvin) throw new Error("The authorized Cloudflare account does not expose the private brvin-service Worker.");
  if (refreshed.bundle.accountId !== accountId) {
    const metadata = JSON.parse(row.metadata_json || "{}") as Record<string, unknown>;
    await saveConnection(env, "cloudflare", "connected", { ...metadata, accountId, brvinServiceVisible: true }, { ...refreshed.bundle, accountId });
  }
  return { accessToken: refreshed.accessToken, bundle: refreshed.bundle, scripts };
}

export async function discoverBrvinCloudflareWorkers(env: Env, request: Request): Promise<Response> {
  try {
    const { scripts } = await authorizedCloudflare(env, request);
    const row = await connection(env, "cloudflare");
    const metadata = row ? JSON.parse(row.metadata_json || "{}") as Record<string, unknown> : {};
    const { bundle } = await getCloudflareBundle(env);
    await saveConnection(env, "cloudflare", "connected", { ...metadata, lastWorkerDiscoveryAt: Date.now() }, bundle);
    return json({ ok: true, accountId: env.BRVIN_HOME_ACCOUNT_ID, brvinService: BRVIN_SERVICE_NAME, workers: scripts.map(script => ({
      name: clean(script.id || script.script || script.name, 128),
      modifiedOn: typeof script.modified_on === "string" ? script.modified_on : null,
    })).filter(script => script.name).sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function registerBrvinTestConsumer(env: Env, request: Request): Promise<Response> {
  let body: { applicationName?: unknown; applicationDescription?: unknown; environmentKey?: unknown; projectName?: unknown; projectDescription?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid test application details." }, 400); }
  const applicationName = "BRVIN Text Test Client";
  const applicationSlug = "brvin-text-test-client";
  const description = "Independent text-only BRVIN reference client; no voice runtime dependency.";
  const environmentKey = "production";
  const projectName = clean(body.projectName, 100).replace(/\s+/gu, " ");
  const projectDescription = clean(body.projectDescription, 500);
  const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64);
  const projectSlug = slugify(projectName);
  if (!projectName || !projectSlug) return json({ ok: false, error: "Enter a valid dedicated test-project name." }, 400);
  try {
    if (!env.DB) return json({ ok: false, error: "BRVIN D1 is not configured." }, 503);
    await ensureAnalyticsSchema(env);
    const applicationId = crypto.randomUUID().toLowerCase();
    const environmentId = crypto.randomUUID().toLowerCase();
    const projectId = crypto.randomUUID().toLowerCase();
    const grantId = crypto.randomUUID().toLowerCase();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO brvin_applications (id,slug,name,description,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)")
        .bind(applicationId, applicationSlug, applicationName, description, now, now),
      env.DB.prepare("INSERT INTO brvin_application_environments (id,application_id,environment_key,display_name,status,created_at,updated_at) VALUES (?,?,?,?, 'active',?,?)")
        .bind(environmentId, applicationId, environmentKey, environmentKey, now, now),
      env.DB.prepare("INSERT INTO brvin_projects (id,name,slug,description,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)")
        .bind(projectId, projectName, projectSlug, projectDescription, now, now),
      env.DB.prepare("INSERT INTO brvin_application_project_grants (id,application_id,project_id,status,created_at,created_by) VALUES (?,?,?,'active',?,'connect-wizard')")
        .bind(grantId, applicationId, projectId, now),
    ]);
    await recordBrvinActivity(env, {
      projectId, agent: "BRVIN Connect Application wizard", phase: "governance",
      eventType: "application.test_consumer_registered", status: "completed",
      message: "The first controlled text test consumer, environment identity, isolated project and explicit application grant were registered.",
      details: { applicationId, environmentId, projectId, grantId },
    });
    await audit(env, "github", "consumer.registered", "The isolated BRVIN text test consumer was registered with a dedicated project grant.", { applicationId, environmentId, projectId });
    return json({
      ok: true,
      application: { id: applicationId, slug: applicationSlug, name: applicationName },
      environment: { id: environmentId, key: environmentKey },
      project: { id: projectId, slug: projectSlug, name: projectName },
      grantId,
    }, 201);
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 409);
  }
}

async function readGitHubFile(token: string, repository: string, path: string, ref: string): Promise<{ sha: string; text: string }> {
  const response = await githubRequest<{ sha?: string; content?: string; encoding?: string }>(
    "/repos/" + repository + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(ref),
    token,
  );
  if (!response.sha || !response.content || response.encoding !== "base64") throw new Error("The supported BRVIN test-client config file is missing or cannot be read.");
  return { sha: response.sha, text: decodeText(response.content.replace(/\s/gu, "")) };
}

export async function createBrvinTestClientPullRequest(env: Env, request: Request): Promise<Response> {
  let body: { applicationId?: unknown; environmentId?: unknown; repository?: unknown; baseBranch?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ ok: false, error: "Invalid connection request." }, 400); }
  const applicationId = clean(body.applicationId, 36);
  const environmentId = clean(body.environmentId, 36);
  const repository = clean(body.repository, 200);
  const baseBranch = clean(body.baseBranch, 100);
  if (!/^[a-f0-9-]{36}$/iu.test(applicationId) || !/^[a-f0-9-]{36}$/iu.test(environmentId) || repository !== TEST_REPOSITORY || baseBranch !== "main") {
    return json({ ok: false, error: "This M6 adapter currently supports only the BRVIN text test Worker in ashini-x/askmoina-voice on main." }, 400);
  }
  try {
    if (!env.DB) return json({ ok: false, error: "BRVIN D1 is not configured." }, 503);
    await ensureAnalyticsSchema(env);
    const [application, environment] = await Promise.all([
      env.DB.prepare("SELECT id,slug,name,status FROM brvin_applications WHERE id=?").bind(applicationId).first<{ id: string; slug: string; name: string; status: string }>(),
      env.DB.prepare("SELECT id,application_id,environment_key,status FROM brvin_application_environments WHERE id=?").bind(environmentId).first<{ id: string; application_id: string; environment_key: string; status: string }>(),
    ]);
    if (!application || application.status !== "active" || !environment || environment.status !== "active" || environment.application_id !== applicationId) {
      return json({ ok: false, error: "Choose an active application and one of its active environment identities." }, 409);
    }
    if (application.slug !== "brvin-text-test-client" || environment.environment_key !== "production") {
      return json({
        ok: false,
        error: "This adapter is restricted to the dedicated BRVIN Text Test Client production identity. Existing AskMoina Voice and Parmar AI identities cannot be attached.",
      }, 409);
    }
    const grant = await env.DB.prepare(
      "SELECT id,project_id FROM brvin_application_project_grants " +
      "WHERE application_id=? AND status='active' AND project_id<>'fatman' LIMIT 1"
    ).bind(applicationId).first<{ id: string; project_id: string }>();
    if (!grant) return json({ ok: false, error: "Grant this dedicated text-test application an isolated non-Fatman BRVIN project before connecting its Worker." }, 409);
    const cf = await authorizedCloudflare(env, request);
    const { row: ghRow, bundle } = await getGitHubBundle(env);
    const token = await githubInstallationToken(env, bundle, repository);
    const accessible = await githubRequest<{ repositories?: Array<{ full_name?: string }> }>("/installation/repositories?per_page=100", token);
    if (!(accessible.repositories || []).some(repo => repo.full_name === repository)) return json({ ok: false, error: "The selected repository is not accessible to the selected GitHub App installation." }, 403);
    const { text: currentConfig } = await readGitHubFile(token, repository, TEST_CONFIG_PATH, baseBranch);
    let config: Record<string, unknown>;
    try { config = JSON.parse(currentConfig) as Record<string, unknown>; } catch { return json({ ok: false, error: "The test Worker Wrangler config is not valid JSONC-compatible JSON. The known adapter will not rewrite unsupported config." }, 409); }
    if (config.name !== TEST_WORKER_NAME || config.main !== "workers/brvin-test-client/src/index.ts") return json({ ok: false, error: "The target repository no longer matches the reviewed BRVIN text test-client adapter. No files were changed." }, 409);
    const services = Array.isArray(config.services) ? config.services as Array<Record<string, unknown>> : [];
    if (services.some(binding => binding.binding === "BRVIN_SERVICE")) return json({ ok: false, error: "The test Worker already has a BRVIN_SERVICE binding. Review its existing binding instead of creating a duplicate." }, 409);
    config.services = [...services, { binding: "BRVIN_SERVICE", service: BRVIN_SERVICE_NAME, entrypoint: "BrvinRetrievalApi", props: { applicationEnvironmentId: environmentId } }];
    const updated = JSON.stringify(config, null, 2) + "\n";
    const ref = await githubRequest<{ object?: { sha?: string } }>("/repos/" + repository + "/git/ref/heads/" + encodeURIComponent(baseBranch), token);
    const currentCommitSha = ref.object?.sha;
    if (!currentCommitSha) throw new Error("GitHub could not resolve the target branch.");
    const commit = await githubRequest<{ tree?: { sha?: string } }>("/repos/" + repository + "/git/commits/" + currentCommitSha, token);
    const treeSha = commit.tree?.sha;
    if (!treeSha) throw new Error("GitHub could not resolve the target commit tree.");
    const blob = await githubRequest<{ sha?: string }>("/repos/" + repository + "/git/blobs", token, "POST", { content: encodeText(updated), encoding: "base64" });
    if (!blob.sha) throw new Error("GitHub did not create the proposed configuration blob.");
    const tree = await githubRequest<{ sha?: string }>("/repos/" + repository + "/git/trees", token, "POST", { base_tree: treeSha, tree: [{ path: TEST_CONFIG_PATH, mode: "100644", type: "blob", sha: blob.sha }] });
    if (!tree.sha) throw new Error("GitHub did not create the proposed configuration tree.");
    const newCommit = await githubRequest<{ sha?: string }>("/repos/" + repository + "/git/commits", token, "POST", {
      message: "feat(brvin): connect isolated text test Worker to private retrieval",
      tree: tree.sha, parents: [currentCommitSha],
    });
    if (!newCommit.sha) throw new Error("GitHub did not create the review commit.");
    const branchName = "brvin/connect-" + application.slug + "-" + Date.now().toString(36);
    await githubRequest("/repos/" + repository + "/git/refs", token, "POST", { ref: "refs/heads/" + branchName, sha: newCommit.sha });
    const pr = await githubRequest<{ html_url?: string; number?: number; head?: { sha?: string } }>("/repos/" + repository + "/pulls", token, "POST", {
      title: "Connect " + application.name + " to BRVIN private retrieval",
      head: branchName, base: baseBranch,
      body:
        "## BRVIN Connect Application proposal\n\n" +
        "This PR connects only the isolated brvin-test-client Worker to the private same-account brvin-service Service Binding.\n\n" +
        "- Application: " + application.name + " (" + application.slug + ")\n" +
        "- Environment key: " + environment.environment_key + "\n" +
        "- Trusted environment ID: " + environmentId + "\n" +
        "- Project access remains governed by the existing BRVIN application-project grants.\n" +
        "- No project ID, secret or API token is written to source.\n" +
        "- The existing AskMoina Voice Worker/configuration is unchanged.\n\n" +
        "Review the generated binding and standard checks. Merging this PR is an explicit administrator action; the wizard does not merge or deploy.",
    });
    if (!pr.html_url || !pr.number) throw new Error("GitHub did not return a pull request URL.");
    const metadata = JSON.parse(ghRow.metadata_json || "{}") as Record<string, unknown>;
    await saveConnection(env, "github", "pr_created", {
      ...metadata, installationId: bundle.installationId, installationAccount: bundle.installationAccount,
      selectedRepository: repository, pullRequestUrl: pr.html_url, pullRequestNumber: pr.number,
      pullRequestHeadSha: pr.head?.sha || newCommit.sha, pullRequestCreatedAt: Date.now(),
      connectedApplicationId: applicationId, connectedEnvironmentId: environmentId,
      connectedProjectId: grant.project_id,
    }, { ...bundle, lastRepository: repository, lastPullRequestUrl: pr.html_url });
    await audit(env, "github", "github.connection_pr_created", "A reviewable GitHub pull request was created for the isolated BRVIN text test Worker.", {
      repository, pullRequestNumber: pr.number, pullRequestUrl: pr.html_url, applicationId, environmentId,
      cloudflareWorkerCount: cf.scripts.length,
    });
    return json({ ok: true, repository, branch: branchName, pullRequest: { number: pr.number, url: pr.html_url, headSha: pr.head?.sha || newCommit.sha } }, 201);
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function provisionBrvinTestClientAccessToken(env: Env, request: Request): Promise<Response> {
  try {
    if (!env.DB) return json({ ok: false, error: "BRVIN D1 is not configured." }, 503);
    await ensureAnalyticsSchema(env);
    const github = await connection(env, "github");
    if (!github) return json({ ok: false, error: "Create and review the connection pull request first." }, 409);
    const metadata = JSON.parse(github.metadata_json || "{}") as Record<string, unknown>;
    const applicationId = clean(metadata.connectedApplicationId, 36);
    const environmentId = clean(metadata.connectedEnvironmentId, 36);
    if (!/^[a-f0-9-]{36}$/iu.test(applicationId) || !/^[a-f0-9-]{36}$/iu.test(environmentId)) {
      return json({ ok: false, error: "The GitHub connection PR does not contain a registered application/environment identity." }, 409);
    }

    const registered = await env.DB.prepare(
      "SELECT a.id AS application_id,e.id AS environment_id " +
      "FROM brvin_applications a " +
      "JOIN brvin_application_environments e ON e.application_id=a.id " +
      "JOIN brvin_application_project_grants g ON g.application_id=a.id AND g.status='active' " +
      "JOIN brvin_projects p ON p.id=g.project_id AND p.status='active' " +
      "WHERE a.id=? AND e.id=? AND a.slug='brvin-text-test-client' AND e.environment_key='production' " +
      "AND a.status='active' AND e.status='active' LIMIT 1"
    ).bind(applicationId, environmentId).first<{ application_id: string; environment_id: string }>();
    if (!registered) {
      return json({ ok: false, error: "The connected application, environment or its active project grant is no longer active. Re-enable access before creating a tester token." }, 409);
    }

    const { accessToken, scripts } = await authorizedCloudflare(env, request);
    if (!scripts.some(script => clean(script.id || script.script || script.name, 128) === TEST_WORKER_NAME)) {
      return json({ ok: false, error: "The isolated test Worker has not been deployed yet. Merge the connection PR and wait for the dedicated test-worker deployment workflow." }, 409);
    }
    const accountId = clean(env.BRVIN_HOME_ACCOUNT_ID, 32);
    const settings = await cloudflareApi<{ bindings?: Array<Record<string, unknown>> }>(
      accessToken,
      "/accounts/" + accountId + "/workers/scripts/" + TEST_WORKER_NAME + "/settings",
    );
    const binding = (settings.bindings || []).find(item => item.name === "BRVIN_SERVICE" && item.type === "service");
    const props = binding?.props && typeof binding.props === "object" ? binding.props as Record<string, unknown> : {};
    if (clean(binding?.service, 128) !== BRVIN_SERVICE_NAME || clean(binding?.entrypoint, 128) !== "BrvinRetrievalApi" || clean(props.applicationEnvironmentId, 36) !== environmentId) {
      return json({ ok: false, error: "The deployed test Worker is missing the exact approved BRVIN Service Binding/entrypoint/environment identity. No tester token was created." }, 409);
    }
    const deploymentData = await cloudflareApi<{
      deployments?: Array<{ id?: string; versions?: Array<{ version_id?: string; percentage?: number }> }>;
    }>(accessToken, "/accounts/" + accountId + "/workers/scripts/" + TEST_WORKER_NAME + "/deployments");
    const latestDeployment = deploymentData.deployments?.[0];
    const versions = latestDeployment?.versions || [];
    const trafficPercentage = versions.reduce((total, version) => total + Number(version.percentage || 0), 0);
    if (!latestDeployment?.id || versions.length === 0 || Math.abs(trafficPercentage - 100) > 0.001) {
      return json({ ok: false, error: "The text Worker does not yet have a fully active production deployment. No tester token was created." }, 409);
    }

    // The bearer token only opens the test interface. BRVIN project authorization
    // is still enforced independently by the private application/environment binding.
    const testerToken = randomToken();
    const response = await fetch(
      CLOUDFLARE_API + "/accounts/" + accountId + "/workers/scripts/" + TEST_WORKER_NAME + "/secrets",
      {
        method: "PUT",
        headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
        body: JSON.stringify({ name: "BRVIN_TEST_ACCESS_TOKEN", type: "secret_text", text: testerToken }),
      },
    );
    const responseText = await response.text();
    let payload: { success?: boolean; errors?: Array<{ message?: string }> } = {};
    try { payload = responseText ? JSON.parse(responseText) as typeof payload : {}; } catch { payload = {}; }
    if (!response.ok || payload.success === false) {
      const detail = payload.errors?.map(item => clean(item.message, 160)).filter(Boolean).join("; ") || "Cloudflare did not confirm the Worker secret update.";
      throw new Error("Cloudflare Worker secret update failed (" + response.status + "): " + detail);
    }
    await audit(env, "cloudflare", "test_client.access_token_provisioned", "A one-time BRVIN test-interface access token was installed as a Cloudflare Worker secret after the live service/environment binding was verified.", {
      applicationId, environmentId, worker: TEST_WORKER_NAME, tokenFingerprint: (await stateHash(testerToken)).slice(0, 16),
    });
    return json({
      ok: true,
      testerToken,
      oneTime: true,
      worker: TEST_WORKER_NAME,
      message: "Copy this token now and keep it private. BRVIN does not retain a recoverable copy; generate a new one to rotate it.",
    }, 201);
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 502);
  }
}

export async function verifyBrvinTestClientDeployment(env: Env, request: Request): Promise<Response> {
  try {
    if (!env.DB) return json({ ok: false, connected: false, state: "identity_unavailable", error: "BRVIN D1 is not configured." }, 503);
    await ensureAnalyticsSchema(env);
    const connectionRow = await connection(env, "github");
    if (!connectionRow || connectionRow.status !== "pr_created") {
      return json({ ok: false, connected: false, state: "connection_pr_missing", error: "Create the dedicated text-test connection PR before verifying deployment." }, 409);
    }
    const metadata = JSON.parse(connectionRow.metadata_json || "{}") as Record<string, unknown>;
    const expectedApplicationId = clean(metadata.connectedApplicationId, 36);
    const expectedEnvironmentId = clean(metadata.connectedEnvironmentId, 36);
    if (!/^[a-f0-9-]{36}$/iu.test(expectedApplicationId) || !/^[a-f0-9-]{36}$/iu.test(expectedEnvironmentId)) {
      return json({ ok: false, connected: false, state: "identity_missing", error: "The saved connection PR does not contain a valid dedicated application/environment identity." }, 409);
    }
    const registered = await env.DB.prepare(
      "SELECT a.id AS application_id,e.id AS environment_id " +
      "FROM brvin_applications a " +
      "JOIN brvin_application_environments e ON e.application_id=a.id " +
      "JOIN brvin_application_project_grants g ON g.application_id=a.id AND g.status='active' " +
      "JOIN brvin_projects p ON p.id=g.project_id AND p.status='active' " +
      "WHERE a.id=? AND e.id=? AND a.slug='brvin-text-test-client' AND e.environment_key='production' " +
      "AND a.status='active' AND e.status='active' LIMIT 1"
    ).bind(expectedApplicationId, expectedEnvironmentId).first<{ application_id: string; environment_id: string }>();
    if (!registered) {
      return json({ ok: false, connected: false, state: "identity_inactive", error: "The dedicated text-test application, production environment or its active project grant is no longer active." }, 409);
    }

    const { accessToken, scripts } = await authorizedCloudflare(env, request);
    if (!scripts.some(script => clean(script.id || script.script || script.name, 128) === TEST_WORKER_NAME)) {
      return json({ ok: false, connected: false, state: "not_deployed", error: "The independent text Worker has not been deployed yet." }, 409);
    }
    const accountId = clean(env.BRVIN_HOME_ACCOUNT_ID, 32);
    const settings = await cloudflareApi<{ bindings?: Array<Record<string, unknown>> }>(
      accessToken,
      "/accounts/" + accountId + "/workers/scripts/" + TEST_WORKER_NAME + "/settings",
    );
    const binding = (settings.bindings || []).find(item => item.name === "BRVIN_SERVICE" && item.type === "service");
    const service = clean(binding?.service, 128);
    const entrypoint = clean(binding?.entrypoint, 128);
    const props = binding?.props && typeof binding.props === "object" ? binding.props as Record<string, unknown> : {};
    const configuredEnvironmentId = clean(props.applicationEnvironmentId, 36);
    const bindingMatches = service === BRVIN_SERVICE_NAME && entrypoint === "BrvinRetrievalApi" &&
      configuredEnvironmentId === expectedEnvironmentId;
    if (!bindingMatches) {
      return json({
        ok: true, connected: false, state: "binding_mismatch", worker: TEST_WORKER_NAME,
        service, entrypoint, applicationEnvironmentId: configuredEnvironmentId || null, accountId,
      }, 409);
    }

    const deploymentData = await cloudflareApi<{
      deployments?: Array<{ id?: string; versions?: Array<{ version_id?: string; percentage?: number }> }>;
    }>(accessToken, "/accounts/" + accountId + "/workers/scripts/" + TEST_WORKER_NAME + "/deployments");
    const latestDeployment = deploymentData.deployments?.[0];
    const versions = latestDeployment?.versions || [];
    const trafficPercentage = versions.reduce((total, version) => total + Number(version.percentage || 0), 0);
    if (!latestDeployment?.id || versions.length === 0 || Math.abs(trafficPercentage - 100) > 0.001) {
      return json({
        ok: false, connected: false, state: "deployment_not_active", error: "The Worker binding is configured, but no complete 100% production deployment is active yet.",
        worker: TEST_WORKER_NAME, service, entrypoint, applicationEnvironmentId: configuredEnvironmentId, accountId,
      }, 409);
    }

    return json({
      ok: true, connected: true, state: "verified", worker: TEST_WORKER_NAME, service, entrypoint,
      applicationId: expectedApplicationId, applicationEnvironmentId: configuredEnvironmentId,
      deploymentId: latestDeployment.id, trafficPercentage, accountId,
    });
  } catch (error) {
    return json({ ok: false, connected: false, error: safeError(error) }, 502);
  }
}
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 280);
}
