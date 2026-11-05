import type { Env } from "../config/env";
import { ensureAnalyticsSchema } from "../analytics/db";
import { json } from "../http/response";

type Provider = "github" | "cloudflare";
type ConnectionRow = { provider: string; status: string; metadata_json: string; secret_ciphertext: string; updated_at: number };
type StateRow = { payload_json: string };

const GITHUB_API = "https://api.github.com";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_AUTH = "https://dash.cloudflare.com/oauth2/auth";
const CLOUDFLARE_TOKEN = "https://dash.cloudflare.com/oauth2/token";
const BRVIN_SERVICE_NAME = "brvin-service";

export const BRVIN_GITHUB_REQUIRED_PERMISSIONS = {
  metadata: "read",
  administration: "write",
  actions: "write",
  checks: "write",
  contents: "write",
  deployments: "write",
  environments: "write",
  issues: "write",
  pull_requests: "write",
  repository_creation: "write",
  secrets: "write",
  variables: "write",
  workflows: "write",
} as const;

export const BRVIN_CLOUDFLARE_REQUIRED_SCOPES = [
  // Self-managed OAuth clients can request catalogue-backed permission scopes.
  "account-api-tokens.write",
  "agw.read", "agw.run", "agw.write",
  "ai-model.read", "ai-model.write",
  "ai-search.index", "ai-search.read", "ai-search.run", "ai-search.write",
  "ai.read", "ai.write",
  "aiaudit.read", "aiaudit.write",
  "aig.read", "aig.run", "aig.write",
  "agent-memory.write",
  "browser-rendering.read", "browser-rendering.write",
  "cf-agents.read", "cf-agents.write",
  "cfspeed.read", "cfspeed.write",
  "cloud-connector.read", "cloud-connector.write",
  "cloudchamber.read", "cloudchamber.write",
  "constellation.read", "constellation.write",
  "containers.read", "containers.write",
  "d1.read", "d1.write",
  "firewall-for-ai.read", "firewall-for-ai.write",
  "flagship.evaluate", "flagship.read", "flagship.write",
  "hyperdrive-planetscale.setup",
  "k2.consume", "k2.produce", "k2.read", "k2.write",
  "mcp-portals.read", "mcp-portals.write",
  "messaging.edit", "messaging.read",
  "offline_access",
  "page.read", "page.shield", "page.write",
  "pipelines.read", "pipelines.send", "pipelines.write",
  "pubsub.read", "pubsub.write",
  "query-cache.read", "query-cache.write",
  "queues.read", "queues.write",
  "r2-catalog-sql.read", "r2-catalog.read", "r2-catalog.write",
  "rag.read", "rag.run", "rag.write",
  "realtime.admin", "realtime.read", "realtime.write",
  "secrets-store.read", "secrets-store.write",
  "vectorize.read", "vectorize.write",
  "websearch.read", "websearch.run", "websearch.write",
  "workers-ci.read", "workers-ci.write",
  "workers-kv-storage.read", "workers-kv-storage.write",
  "workers-observability-telemetry.write", "workers-observability.read", "workers-observability.write",
  "workers-r2-bucket-item.read", "workers-r2-bucket-item.write",
  "workers-r2.read", "workers-r2.write",
  "workers-routes.read", "workers-routes.write",
  "workers-scripts.content_read", "workers-scripts.edit",
  "workers-scripts.metadata_read",
  "workers-tail.read",
] as const;

// Checked separately: the configured OAuth scope set supplied by the administrator
// includes Workers Editor but does not include the product-level Admin role.
export const BRVIN_CLOUDFLARE_WORKER_ADMIN_SCOPE = "workers-scripts.admin" as const;

function grantedPermission(current: Record<string, unknown>, name: string, required: "read" | "write"): boolean {
  const value = clean(current[name], 20);
  return value === "write" || (required === "read" && value === "read");
}

function missingPermissions(current: Record<string, unknown>, required: Record<string, "read" | "write">): string[] {
  return Object.entries(required).filter(([name, level]) => !grantedPermission(current, name, level)).map(([name]) => name);
}

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
      "user-agent": "BRVIN-Connect",
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

export async function brvinConnectStatus(env: Env): Promise<Response> {
  try {
    const [github, cloudflare] = await Promise.all([connection(env, "github"), connection(env, "cloudflare")]);
    const githubMeta = github ? JSON.parse(github.metadata_json || "{}") as Record<string, unknown> : {};
    const cfMeta = cloudflare ? JSON.parse(cloudflare.metadata_json || "{}") as Record<string, unknown> : {};
    const grantedScopes = clean(cfMeta.scope, 5000).split(/\s+/u).filter(Boolean);
    const missingCloudflareScopes = BRVIN_CLOUDFLARE_REQUIRED_SCOPES.filter(scope => !grantedScopes.includes(scope));
    const workerAdminScopeGranted = grantedScopes.includes(BRVIN_CLOUDFLARE_WORKER_ADMIN_SCOPE);
    const slug = clean(githubMeta.slug, 100);
    const installationId = Number(githubMeta.installationId || 0) || null;
    return json({
      ok: true,
      github: {
        status: github?.status || "not_connected",
        appName: clean(githubMeta.appName, 100),
        appSlug: slug,
        appUrl: clean(githubMeta.htmlUrl, 240),
        appSettingsUrl: slug ? "https://github.com/settings/apps/" + encodeURIComponent(slug) + "/permissions" : null,
        installationId,
        installationUrl: installationId ? "https://github.com/settings/installations/" + installationId : null,
        installationAccount: clean(githubMeta.installationAccount, 100) || null,
        repositorySelection: clean(githubMeta.repositorySelection, 20) || null,
        requiredPermissions: BRVIN_GITHUB_REQUIRED_PERMISSIONS,
      },
      cloudflare: {
        status: cloudflare?.status || "not_configured",
        oauthClientConfigured: Boolean(clean(cfMeta.clientIdHint, 40)),
        clientIdHint: clean(cfMeta.clientIdHint, 40) || null,
        callbackUrl: clean(cfMeta.redirectUri, 500) || null,
        accountId: clean(cfMeta.accountId, 32) || clean(env.BRVIN_HOME_ACCOUNT_ID, 32) || null,
        brvinServiceVisible: cfMeta.brvinServiceVisible === true,
        lastWorkerDiscoveryAt: Number(cfMeta.lastWorkerDiscoveryAt || 0) || null,
        grantedScopes,
        requiredScopes: BRVIN_CLOUDFLARE_REQUIRED_SCOPES,
        missingScopes: missingCloudflareScopes,
        workerAdminScopeId: BRVIN_CLOUDFLARE_WORKER_ADMIN_SCOPE,
        workerAdminScopeGranted,
        workerEditorScopeGranted: grantedScopes.includes("workers-scripts.edit"),
        accountTokenWriteScopeGranted: grantedScopes.includes("account-api-tokens.write"),
      },
    });
  } catch (error) {
    return json({ ok: false, error: safeError(error) }, 500);
  }
}

export async function inspectBrvinProviderCapabilities(env: Env): Promise<Response> {
  const result: Record<string, unknown> = {
    ok: true,
    github: { connected: false, appPermissions: {}, missingAppPermissions: Object.keys(BRVIN_GITHUB_REQUIRED_PERMISSIONS), installation: null, error: null },
    cloudflare: { connected: false, missingScopes: BRVIN_CLOUDFLARE_REQUIRED_SCOPES, error: null },
  };
  try {
    const connectionRow = await connection(env, "github");
    if (connectionRow && connectionRow.status !== "revoked") {
      const { bundle } = await getGitHubBundle(env);
      const [app, installations] = await Promise.all([
        githubAppRequest<{ slug?: string; permissions?: Record<string, string> }>(env, bundle, "/app"),
        githubAppRequest<Array<{ id?: number; account?: { login?: string }; permissions?: Record<string, string>; repository_selection?: string; html_url?: string }>>(env, bundle, "/app/installations?per_page=100"),
      ]);
      const metadata = JSON.parse(connectionRow.metadata_json || "{}") as Record<string, unknown>;
      const installationId = Number(metadata.installationId || 0);
      const selected = installations.find(item => Number(item.id) === installationId) || null;
      const appPermissions = app.permissions || {};
      const installationPermissions = selected?.permissions || {};
      const required = BRVIN_GITHUB_REQUIRED_PERMISSIONS as unknown as Record<string, "read" | "write">;
      const missingAppPermissions = missingPermissions(appPermissions, required);
      const missingInstallationPermissions = missingPermissions(installationPermissions, required);
      result.github = {
        connected: true,
        appSlug: clean(app.slug || metadata.slug, 100),
        appPermissions,
        missingAppPermissions,
        installation: selected ? {
          id: selected.id,
          account: clean(selected.account?.login, 100),
          repositorySelection: clean(selected.repository_selection, 20),
          url: clean(selected.html_url, 500),
          permissions: installationPermissions,
          missingPermissions: missingInstallationPermissions,
          allRepositories: selected.repository_selection === "all",
        } : null,
        missingInstallationPermissions: selected ? missingInstallationPermissions : Object.keys(required),
        needsOwnerApproval: missingAppPermissions.length > 0 || !selected || missingInstallationPermissions.length > 0 || selected.repository_selection !== "all",
        settingsUrl: app.slug ? "https://github.com/settings/apps/" + encodeURIComponent(app.slug) + "/permissions" : null,
      };
    } else {
      result.github = { connected: false, missingAppPermissions: Object.keys(BRVIN_GITHUB_REQUIRED_PERMISSIONS), error: "The BRVIN GitHub App is not connected." };
    }
  } catch (error) {
    result.github = { connected: false, error: safeError(error) };
  }
  try {
    const cloudflare = await connection(env, "cloudflare");
    const metadata = cloudflare ? JSON.parse(cloudflare.metadata_json || "{}") as Record<string, unknown> : {};
    const granted = new Set(clean(metadata.scope, 5000).split(/\s+/u).filter(Boolean));
    const missingScopes = BRVIN_CLOUDFLARE_REQUIRED_SCOPES.filter(scope => !granted.has(scope));
    const workerAdminScopeGranted = granted.has(BRVIN_CLOUDFLARE_WORKER_ADMIN_SCOPE);
    const workerEditorScopeGranted = granted.has("workers-scripts.edit");
    const accountTokenWriteScopeGranted = granted.has("account-api-tokens.write");
    const connectionReady = cloudflare?.status === "connected" && missingScopes.length === 0 && metadata.brvinServiceVisible === true;
    const readinessBlockers = [] as string[];
    if (!connectionReady) readinessBlockers.push("Complete Cloudflare OAuth consent and confirm private brvin-service visibility.");
    if (!workerAdminScopeGranted) readinessBlockers.push("Workers Admin (workers-scripts.admin) is not granted. Workers Editor can update existing Workers but cannot create or delete Workers.");
    if (!accountTokenWriteScopeGranted) readinessBlockers.push("Account API Tokens Write (account-api-tokens.write) is not granted.");
    readinessBlockers.push("Real account-token creation, project-scoped token verification, and direct secret delivery have not yet passed live acceptance.");
    result.cloudflare = {
      connected: cloudflare?.status === "connected",
      accountId: clean(metadata.accountId, 32) || clean(env.BRVIN_HOME_ACCOUNT_ID, 32) || null,
      brvinServiceVisible: metadata.brvinServiceVisible === true,
      grantedScopes: [...granted],
      missingScopes,
      workerAdminScopeId: BRVIN_CLOUDFLARE_WORKER_ADMIN_SCOPE,
      workerAdminScopeGranted,
      workerEditorScopeGranted,
      canCreateOrDeleteWorkers: workerAdminScopeGranted,
      canDeployExistingWorkers: workerAdminScopeGranted || workerEditorScopeGranted,
      accountTokenWriteScopeGranted,
      accountTokenCreationVerified: false,
      connectionReady,
      projectFactoryReady: false,
      readinessBlockers,
      ready: false,
      oauthClientScopesHelp: "The configured scope set includes Workers Editor but not Workers Admin. If Cloudflare offers workers-scripts.admin for this self-managed OAuth client, add it to the existing client and re-authorize. Without Workers Admin, BRVIN cannot create or delete new Workers. Never add account_api_tokens:create; that scope is reserved for Cloudflare CLI OAuth.",
    };
  } catch (error) {
    result.cloudflare = { connected: false, missingScopes: BRVIN_CLOUDFLARE_REQUIRED_SCOPES, error: safeError(error) };
  }
  return json(result);
}

export async function startBrvinGitHubManifest(env: Env, request: Request): Promise<Response> {
  try {
    if (!env.DB) return json({ ok: false, error: "BRVIN D1 is not configured." }, 503);
    encryptionSecret(env);
    const existing = await connection(env, "github");
    if (existing && existing.status !== "revoked") {
      const metadata = JSON.parse(existing.metadata_json || "{}") as Record<string, unknown>;
      const slug = clean(metadata.slug, 100);
      return json({
        ok: false,
        error: "A BRVIN GitHub App is already registered. Update its permissions in GitHub and approve the installation instead of creating a duplicate app.",
        settingsUrl: slug ? "https://github.com/settings/apps/" + encodeURIComponent(slug) + "/permissions" : null,
      }, 409);
    }
    const state = await createState(env, "github", { purpose: "manifest" });
    const origin = new URL(request.url).origin;
    const redirect = origin + "/admin/brvin/connect/github/callback";
    const manifest = {
      name: "BRVIN Connect",
      url: origin + "/admin/brvin",
      description: "Private repository-scoped connector for onboarding Cloudflare Workers to BRVIN.",
      redirect_url: redirect,
      public: false,
      default_permissions: BRVIN_GITHUB_REQUIRED_PERMISSIONS,
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
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "BRVIN-Connect",
        "x-github-api-version": "2022-11-28",
      },
    });
    const responseText = await response.text();
    let payload: unknown = {};
    try { payload = responseText ? JSON.parse(responseText) : {}; } catch { payload = {}; }
    const apiPayload = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const requestId = clean(response.headers.get("x-github-request-id"), 100);
    const rateLimitRemaining = clean(response.headers.get("x-ratelimit-remaining"), 20);
    const githubErrors = Array.isArray(apiPayload.errors)
      ? apiPayload.errors.map((item: unknown) => {
          if (typeof item === "string") return clean(item, 180);
          if (!item || typeof item !== "object") return "";
          const detail = item as Record<string, unknown>;
          return [
            clean(detail.field, 60),
            clean(detail.code, 60),
            clean(detail.message, 180),
          ].filter(Boolean).join(": ");
        }).filter(Boolean).slice(0, 3)
      : [];
    if (!response.ok) {
      const githubMessage = clean(apiPayload.message, 200) || "GitHub did not return a validation message.";
      const statusGuidance = response.status === 422
        ? "GitHub uses HTTP 422 for manifest validation failures or conversion rate limiting. Do not repeatedly retry; wait briefly, then start a fresh registration from BRVIN."
        : response.status === 404
          ? "GitHub could not find the temporary manifest code. Start a fresh registration from BRVIN and complete the GitHub flow promptly."
          : "Check the GitHub response details below before retrying.";
      const diagnostic = [
        "GitHub returned HTTP " + response.status + ".",
        githubMessage,
        ...githubErrors,
        statusGuidance,
        requestId ? "GitHub request ID: " + requestId + "." : "",
        rateLimitRemaining ? "GitHub API rate-limit remaining: " + rateLimitRemaining + "." : "",
      ].filter(Boolean).join(" ").slice(0, 900);
      if (env.DB) {
        await env.DB.prepare(
          "INSERT INTO brvin_connection_events (provider,event_type,status,message,detail_json,created_at) VALUES (?,?,?,?,?,?)"
        ).bind(
          "github",
          "github.manifest_conversion_failed",
          "failed",
          "GitHub manifest conversion returned HTTP " + response.status + ".",
          JSON.stringify({ status: response.status, message: githubMessage, errors: githubErrors, requestId, rateLimitRemaining }).slice(0, 3000),
          Date.now(),
        ).run();
      }
      return callbackHtml("GitHub app registration failed", diagnostic, false);
    }
    const app = payload as { id?: number; slug?: string; name?: string; html_url?: string; pem?: string; permissions?: Record<string, string> };
    if (!app.id || !app.slug || !app.pem) {
      const diagnostic = "GitHub returned HTTP " + response.status + " but the response did not include the required App ID, slug and private key. Request ID: " + (requestId || "not provided") + ".";
      if (env.DB) {
        await env.DB.prepare(
          "INSERT INTO brvin_connection_events (provider,event_type,status,message,detail_json,created_at) VALUES (?,?,?,?,?,?)"
        ).bind("github", "github.manifest_conversion_invalid_response", "failed", "GitHub returned an incomplete manifest-conversion response.", JSON.stringify({ status: response.status, requestId }), Date.now()).run();
      }
      return callbackHtml("GitHub returned an incomplete App response", diagnostic, false);
    }
    const permissions = app.permissions || {};
    const missing = missingPermissions(permissions, BRVIN_GITHUB_REQUIRED_PERMISSIONS as unknown as Record<string, "read" | "write">);
    if (missing.length > 0) {
      return callbackHtml("GitHub administrator permissions did not match", "The created app is missing required BRVIN Project Factory permissions: " + missing.join(", ") + ". Update the app permissions and approve the installation before continuing.", false);
    }
    const metadata = { appName: clean(app.name, 100), slug: app.slug, htmlUrl: clean(app.html_url, 240), createdAt: Date.now(), installationId: null };
    await saveConnection(env, "github", "app_created", metadata, {
      appId: app.id,
      slug: app.slug,
      name: clean(app.name, 100),
      privateKey: app.pem,
    } satisfies GitHubBundle);
    await audit(env, "github", "github.app_created", "A private least-privilege GitHub App was created through the manifest flow.", { appId: app.id, slug: app.slug });
    return callbackHtml("GitHub App created", "BRVIN's private GitHub App was created and its private key is encrypted in BRVIN D1. Install it on your personal account with access to all repositories, then approve the full requested permissions.", true);
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
    url.searchParams.set("scope", BRVIN_CLOUDFLARE_REQUIRED_SCOPES.join(" "));
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
  if (url.searchParams.has("error")) {
    const oauthError = clean(url.searchParams.get("error"), 120) || "unknown_error";
    const errorDescription = clean(url.searchParams.get("error_description"), 240);
    const diagnostic = "Cloudflare returned OAuth error: " + oauthError +
      (errorDescription ? ". Details: " + errorDescription : ". No error description was provided.");
    return callbackHtml("Cloudflare rejected BRVIN authorization", diagnostic, false);
  }
  if (!code || !state) return callbackHtml("Cloudflare callback is incomplete", "The authorization code or state is missing. Start the connection again from BRVIN.", false);
  try {
    const statePayload = await consumeState(env, "cloudflare", state);
    if (!statePayload || statePayload.purpose !== "authorization") return callbackHtml("Cloudflare authorization expired", "This one-time authorization state was invalid, expired or already used. Start again from BRVIN.", false);
    const { row, bundle } = await getCloudflareBundle(env);
    const token = await exchangeCloudflareToken(bundle, { grant_type: "authorization_code", code }, callbackUrl(request, "cloudflare"));
    const grantedScopes = new Set((token.scope || "").split(/\s+/u).filter(Boolean));
    const missingScopes = BRVIN_CLOUDFLARE_REQUIRED_SCOPES.filter(scope => !grantedScopes.has(scope));
    if (missingScopes.length > 0 || !token.refresh_token) {
      return callbackHtml(
        "Cloudflare administrator permissions incomplete",
        "BRVIN requires the approved Developer Platform and AI resource scopes plus Account API Tokens Write. Update the private BRVIN Connect OAuth client to include all Project Factory scopes, then authorize again. Missing scope IDs: " + missingScopes.slice(0, 30).join(", ") + (missingScopes.length > 30 ? " … and " + (missingScopes.length - 30) + " more." : "") + ".",
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
      workerCount: names.length, scope: clean(token.scope, 6000), authorizedAt: Date.now(),
    }, next);
    await audit(env, "cloudflare", "cloudflare.account_authorized", "Cloudflare OAuth access was verified against the account hosting the private brvin-service Worker.", { accountId, workerCount: names.length });
    return callbackHtml("Cloudflare account connected", "BRVIN confirmed the authorised account, the requested configured OAuth scopes and private brvin-service presence. Return to BRVIN to run the capability check. Workers Admin and live account-token creation remain separate Project Factory acceptance gates.", true);
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

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/gu, " ").slice(0, 280);
}
