import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";

const ensure = vi.hoisted(() => vi.fn(async () => undefined));
const activity = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/analytics/db", () => ({
  ensureAnalyticsSchema: ensure,
  recordBrvinActivity: activity,
}));

import {
  brvinConnectStatus,
  BRVIN_CLOUDFLARE_REQUIRED_SCOPES,
  BRVIN_CLOUDFLARE_WORKER_ADMIN_SCOPE,
  BRVIN_GITHUB_REQUIRED_PERMISSIONS,
  completeBrvinGitHubManifest,
  completeBrvinCloudflareOAuth,
  configureBrvinCloudflareOAuth,
  decommissionLegacyBrvinConnect,
  startBrvinGitHubManifest,
  startBrvinCloudflareOAuth,
} from "../src/brvin/connect-wizard";

type Row = Record<string, unknown>;

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: MemoryD1, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> { return this.db.first(this.sql, this.values) as T | null; }
  async run(): Promise<{ success: boolean }> { return this.db.run(this.sql, this.values); }
}

class MemoryD1 {
  connections = new Map<string, Row>();
  states = new Map<string, Row>();
  applications: Row[] = [];
  environments: Row[] = [];
  projects: Row[] = [];
  grants: Row[] = [];
  events: Row[] = [];
  statements: string[] = [];

  prepare(sql: string) { return new Statement(this, sql); }

  async batch(statements: Statement[]) {
    const output = [];
    for (const statement of statements) output.push(await statement.run());
    return output;
  }

  async first(sql: string, values: unknown[]): Promise<Row | null> {
    this.statements.push(sql);
    if (sql.includes("FROM brvin_provider_connections WHERE provider=?")) {
      return this.connections.get(String(values[0])) ?? null;
    }
    if (sql.includes("DELETE FROM brvin_oauth_states")) {
      const hash = String(values[0]);
      const row = this.states.get(hash);
      if (!row || row.provider !== values[1] || Number(row.expires_at) <= Number(values[2])) return null;
      this.states.delete(hash);
      return { payload_json: row.payload_json };
    }
    if (sql.includes("SELECT id,slug,name,status FROM brvin_applications")) {
      return this.applications.find(row => row.id === values[0]) ?? null;
    }
    if (sql.includes("SELECT id,application_id,environment_key,status FROM brvin_application_environments")) {
      return this.environments.find(row => row.id === values[0]) ?? null;
    }
    if (sql.includes("brvin_application_project_grants")) {
      const boundStrings = values.map(value => String(value));
      const applicationId = boundStrings.find(value => this.grants.some(row => row.application_id === value));
      const projectId = sql.includes("g.project_id=?")
        ? boundStrings.find(value => this.grants.some(row => row.project_id === value))
        : undefined;
      if (!applicationId) return null;
      return this.grants.find(row =>
        row.application_id === applicationId &&
        row.status === "active" &&
        (projectId === undefined || row.project_id === projectId)
      ) ?? null;
    }
    return null;
  }

  async run(sql: string, values: unknown[]): Promise<{ success: boolean }> {
    this.statements.push(sql);
    if (sql.includes("INSERT INTO brvin_provider_connections")) {
      this.connections.set(String(values[0]), {
        provider: values[0], status: values[1], metadata_json: values[2],
        secret_ciphertext: values[3], created_at: values[4], updated_at: values[5],
      });
    } else if (sql.includes("UPDATE brvin_provider_connections")) {
      const provider = String(values[3]);
      const row = this.connections.get(provider);
      if (row) this.connections.set(provider, {
        ...row, status: values[0], metadata_json: values[1], secret_ciphertext: "", updated_at: values[2],
      });
    } else if (sql.includes("INSERT INTO brvin_oauth_states")) {
      this.states.set(String(values[0]), {
        state_hash: values[0], provider: values[1], payload_json: values[2],
        expires_at: values[3], created_at: values[4],
      });
    } else if (sql.includes("INSERT INTO brvin_connection_events")) {
      this.events.push({ provider: values[0], event_type: values[1], status: values[2], message: values[3], detail_json: values[4] });
    } else if (sql.includes("INSERT INTO brvin_applications")) {
      this.applications.push({ id: values[0], slug: values[1], name: values[2], description: values[3], status: "active" });
    } else if (sql.includes("INSERT INTO brvin_application_environments")) {
      this.environments.push({ id: values[0], application_id: values[1], environment_key: values[2], display_name: values[3], status: "active" });
    } else if (sql.includes("INSERT INTO brvin_projects")) {
      this.projects.push({ id: values[0], name: values[1], slug: values[2], description: values[3], status: "active" });
    } else if (sql.includes("INSERT INTO brvin_application_project_grants")) {
      this.grants.push({ id: values[0], application_id: values[1], project_id: values[2], status: "active" });
    }
    return { success: true };
  }
}

function env(db: MemoryD1): Env {
  return { DB: db, ADMIN_SESSION_SECRET: "a".repeat(64), BRVIN_HOME_ACCOUNT_ID: "b34a6c0b7221454c5db977fe61ddf759" } as unknown as Env;
}
function request(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: new URL(url).origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("BRVIN Connect Application wizard", () => {
  beforeEach(() => {
    ensure.mockClear();
    activity.mockClear();
    vi.unstubAllGlobals();
  });

  it("creates a time-limited GitHub manifest state and requests least-privilege permissions", async () => {
    const db = new MemoryD1();
    const response = await startBrvinGitHubManifest(env(db), request("https://parmar.example/admin/api/brvin/connect/github/manifest", {}));
    const body = await response.json() as { ok: boolean; action: string; manifest: { public: boolean; default_permissions: Record<string, string> } };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toContain("https://github.com/settings/apps/new?state=");
    expect(body.manifest.public).toBe(false);
    expect(body.manifest.default_permissions).toEqual(BRVIN_GITHUB_REQUIRED_PERMISSIONS);
    expect(body.manifest.default_permissions.administration).toBe("write");
    expect(body.manifest.default_permissions.repository_creation).toBe("write");
    expect(body.manifest.default_permissions.actions).toBe("write");
    expect(body.manifest.default_permissions.secrets).toBe("write");
    expect(body.manifest.default_permissions.workflows).toBe("write");
    expect(db.states.size).toBe(1);
    const state = new URL(body.action).searchParams.get("state")!;
    expect([...db.states.keys()][0]).not.toBe(state);
    expect([...db.states.values()][0].provider).toBe("github");
  });

  it("exchanges a valid one-time GitHub manifest callback and encrypts the returned private key", async () => {
    const db = new MemoryD1();
    const start = await startBrvinGitHubManifest(env(db), request("https://parmar.example/admin/api/brvin/connect/github/manifest", {}));
    const startBody = await start.json() as { action: string };
    const state = new URL(startBody.action).searchParams.get("state")!;
    const privateKey = "-----BEGIN RSA PRIVATE KEY-----\nprivate-test-key\n-----END RSA PRIVATE KEY-----";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("user-agent")).toBe("BRVIN-Connect");
      return new Response(JSON.stringify({
        id: 123,
        slug: "brvin-connect",
        name: "BRVIN Connect",
        html_url: "https://github.com/apps/brvin-connect",
        pem: privateKey,
        permissions: { ...BRVIN_GITHUB_REQUIRED_PERMISSIONS },
      }), { status: 201, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const callback = await completeBrvinGitHubManifest(env(db), request("https://parmar.example/admin/brvin/connect/github/callback?code=one-time-code&state="+encodeURIComponent(state)));
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("GitHub App created");
    const stored = db.connections.get("github")!;
    expect(stored.status).toBe("app_created");
    expect(String(stored.secret_ciphertext)).not.toContain(privateKey);
    expect(String(stored.metadata_json)).toContain("brvin-connect");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const repeat = await completeBrvinGitHubManifest(env(db), request("https://parmar.example/admin/brvin/connect/github/callback?code=one-time-code&state="+encodeURIComponent(state)));
    expect(repeat.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces GitHub manifest conversion status, validation details and request ID without storing credentials", async () => {
    const db = new MemoryD1();
    const start = await startBrvinGitHubManifest(env(db), request("https://parmar.example/admin/api/brvin/connect/github/manifest", {}));
    const startBody = await start.json() as { action: string };
    const state = new URL(startBody.action).searchParams.get("state")!;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      message: "Validation Failed",
      errors: [{ resource: "Integration", field: "name", code: "already_exists", message: "name has already been taken" }],
    }), { status: 422, headers: { "content-type": "application/json", "x-github-request-id": "GHREQ-TEST-123", "x-ratelimit-remaining": "42" } }));
    vi.stubGlobal("fetch", fetchMock);
    const callback = await completeBrvinGitHubManifest(env(db), request("https://parmar.example/admin/brvin/connect/github/callback?code=temporary-code&state="+encodeURIComponent(state)));
    const html = await callback.text();
    expect(callback.status).toBe(400);
    expect(html).toContain("GitHub returned HTTP 422");
    expect(html).toContain("Validation Failed");
    expect(html).toContain("name has already been taken");
    expect(html).toContain("GHREQ-TEST-123");
    expect(html).toContain("Do not repeatedly retry");
    expect(db.connections.has("github")).toBe(false);
    expect(db.events).toHaveLength(1);
    expect(db.events[0].status).toBe("failed");
    expect(JSON.stringify(db.events[0])).not.toContain("temporary-code");
  });

  it("rejects a callback with missing or invalid state without calling GitHub", async () => {
    const db = new MemoryD1();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await completeBrvinGitHubManifest(env(db), request("https://parmar.example/admin/brvin/connect/github/callback?code=opaque-code&state=invalid"));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores Cloudflare OAuth client secrets encrypted and returns the exact redirect URI", async () => {
    const db = new MemoryD1();
    const clientSecret = "cloudflare-client-secret-value-123456";
    const response = await configureBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/configure", {
      clientId: "BRVIN.Cloudflare.OAuth123",
      clientSecret,
    }));
    const body = await response.json() as { ok: boolean; redirectUri: string };
    expect(response.status).toBe(200);
    expect(body.redirectUri).toBe("https://parmar.example/admin/brvin/connect/cloudflare/callback");
    const row = db.connections.get("cloudflare")!;
    expect(row.status).toBe("configured");
    expect(String(row.secret_ciphertext)).not.toContain(clientSecret);
    expect(String(row.secret_ciphertext)).not.toContain("BRVIN.Cloudflare.OAuth123");
    expect(String(row.metadata_json)).not.toContain(clientSecret);
  });

  it("shows the actual Cloudflare OAuth rejection instead of reporting every error as cancellation", async () => {
    const db = new MemoryD1();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const callback = await completeBrvinCloudflareOAuth(env(db), request(
      "https://parmar.example/admin/brvin/connect/cloudflare/callback?error=invalid_scope&error_description=" +
      encodeURIComponent("The requested scope is not authorized for this OAuth client."),
    ));
    const html = await callback.text();
    expect(callback.status).toBe(400);
    expect(html).toContain("Cloudflare rejected BRVIN authorization");
    expect(html).toContain("invalid_scope");
    expect(html).toContain("The requested scope is not authorized for this OAuth client.");
    expect(html).not.toContain("authorization cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.connections.has("cloudflare")).toBe(false);
  });

  it("requires the approved Cloudflare administrator scopes and a refresh token before accepting OAuth", async () => {
    const db = new MemoryD1();
    await configureBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/configure", {
      clientId: "BRVIN.Cloudflare.OAuth123",
      clientSecret: "cloudflare-client-secret-value-123456",
    }));
    const start = await startBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/start", {}));
    const startBody = await start.json() as { authorizationUrl: string };
    const authorization = new URL(startBody.authorizationUrl);
    const requestedScopes = authorization.searchParams.get("scope")!.split(/\s+/u);
    for (const requiredScope of BRVIN_CLOUDFLARE_REQUIRED_SCOPES) expect(requestedScopes).toContain(requiredScope);
    expect(requestedScopes).toContain("account-api-tokens.write");
    expect(requestedScopes).not.toContain("account_api_tokens:create");
    expect(BRVIN_CLOUDFLARE_REQUIRED_SCOPES).not.toContain("account_api_tokens:create");
    expect(requestedScopes).not.toContain("ai-search.metadata_read");
    expect(requestedScopes).not.toContain(BRVIN_CLOUDFLARE_WORKER_ADMIN_SCOPE);
    expect(requestedScopes).not.toContain("workers-scripts.read");
    expect(requestedScopes).not.toContain("workers-scripts.write");
    expect(requestedScopes).toContain("workers-scripts.edit");
    expect(requestedScopes).toContain("offline_access");
    const state = authorization.searchParams.get("state")!;

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: "read-only-token",
      scope: "workers-scripts.content_read",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const callback = await completeBrvinCloudflareOAuth(env(db), request(
      "https://parmar.example/admin/brvin/connect/cloudflare/callback?code=one-time-code&state="+encodeURIComponent(state),
    ));
    expect(callback.status).toBe(400);
    expect(await callback.text()).toContain("Cloudflare administrator permissions incomplete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.connections.get("cloudflare")?.status).toBe("configured");
  });

  it("accepts Cloudflare OAuth only after administrator scopes, a refresh token and the private BRVIN Worker are confirmed", async () => {
    const db = new MemoryD1();
    await configureBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/configure", {
      clientId: "BRVIN.Cloudflare.OAuth123",
      clientSecret: "cloudflare-client-secret-value-123456",
    }));
    const start = await startBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/start", {}));
    const startBody = await start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get("state")!;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "full-scope-token",
        refresh_token: "refresh-token",
        expires_in: 900,
        scope: BRVIN_CLOUDFLARE_REQUIRED_SCOPES.join(" "),
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [{ id: "brvin-service" }],
        errors: [],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const callback = await completeBrvinCloudflareOAuth(env(db), request(
      "https://parmar.example/admin/brvin/connect/cloudflare/callback?code=one-time-code&state="+encodeURIComponent(state),
    ));
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("Cloudflare account connected");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.connections.get("cloudflare")?.status).toBe("connected");
    expect(String(db.connections.get("cloudflare")?.metadata_json)).toContain("b34a6c0b7221454c5db977fe61ddf759");
  });

  it("reports missing administrator scopes without revealing provider credentials", async () => {
    const db = new MemoryD1();
    await configureBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/configure", {
      clientId: "BRVIN.Cloudflare.OAuth123",
      clientSecret: "cloudflare-client-secret-value-123456",
    }));
    const response = await brvinConnectStatus(env(db));
    const body = await response.json() as {
      github: { requiredPermissions: Record<string, string> };
      cloudflare: { requiredScopes: string[]; missingScopes: string[]; workerAdminScopeId: string; workerAdminScopeGranted: boolean };
    };
    expect(response.status).toBe(200);
    expect(body.github.requiredPermissions.administration).toBe("write");
    expect(body.github.requiredPermissions.repository_creation).toBe("write");
    expect(body.cloudflare.requiredScopes).not.toContain("workers-scripts.admin");
    expect(body.cloudflare.requiredScopes).toContain("account-api-tokens.write");
    expect(body.cloudflare.workerAdminScopeId).toBe(BRVIN_CLOUDFLARE_WORKER_ADMIN_SCOPE);
    expect(body.cloudflare.workerAdminScopeGranted).toBe(false);
    expect(JSON.stringify(body)).not.toContain("cloudflare-client-secret-value-123456");
  });

  it("does not expose credential ciphertext or tokens in the connection status response", async () => {
    const db = new MemoryD1();
    db.connections.set("github", { provider: "github", status: "app_created", metadata_json: JSON.stringify({ slug: "brvin-connect", appName: "BRVIN Connect" }), secret_ciphertext: "encrypted-private-key", updated_at: Date.now() });
    const response = await brvinConnectStatus(env(db));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("encrypted-private-key");
    expect(JSON.stringify(body)).not.toContain("privateKey");
    expect(JSON.stringify(body)).toContain("brvin-connect");
  });
});

describe("Legacy BRVIN Connect retirement", () => {
  beforeEach(() => {
    ensure.mockClear();
    activity.mockClear();
    vi.unstubAllGlobals();
  });

  it("requires the exact typed confirmation and makes no provider calls otherwise", async () => {
    const db = new MemoryD1();
    db.connections.set("github", {
      provider: "github", status: "connected", metadata_json: "{}",
      secret_ciphertext: "preserved", updated_at: Date.now(),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await decommissionLegacyBrvinConnect(
      env(db),
      request("https://parmar.example/admin/api/brvin/connect/revoke", { confirmation: "DELETE APP" }),
    );
    expect(response.status).toBe(400);
    const errorBody = await response.json() as { error?: string };
    expect(errorBody.error).toContain("UNINSTALL BRVIN CONNECT");
    expect(db.connections.get("github")?.status).toBe("connected");
    expect(db.connections.get("github")?.secret_ciphertext).toBe("preserved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uninstalls only the recorded ashini-x GitHub installation, revokes Cloudflare tokens, and erases both stored bundles", async () => {
    const db = new MemoryD1();
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
    let binary = "";
    for (const byte of der) binary += String.fromCharCode(byte);
    const privateKey = "-----BEGIN PRIVATE KEY-----\n" + btoa(binary) + "\n-----END PRIVATE KEY-----";

    const githubStart = await startBrvinGitHubManifest(
      env(db),
      request("https://parmar.example/admin/api/brvin/connect/github/manifest", {}),
    );
    const githubStartBody = await githubStart.json() as { action: string };
    const githubState = new URL(githubStartBody.action).searchParams.get("state")!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: 123, slug: "brvin-connect", name: "BRVIN Connect",
      html_url: "https://github.com/apps/brvin-connect", pem: privateKey,
      permissions: { ...BRVIN_GITHUB_REQUIRED_PERMISSIONS },
    }), { status: 201, headers: { "content-type": "application/json" } })));
    const githubCallback = await completeBrvinGitHubManifest(
      env(db),
      request("https://parmar.example/admin/brvin/connect/github/callback?code=manifest-code&state=" + encodeURIComponent(githubState)),
    );
    expect(githubCallback.status).toBe(200);
    const githubRow = db.connections.get("github")!;
    const metadata = JSON.parse(String(githubRow.metadata_json));
    db.connections.set("github", {
      ...githubRow,
      status: "connected",
      metadata_json: JSON.stringify({ ...metadata, installationId: 178850001, installationAccount: "ashini-x" }),
    });

    const cfConfigured = await configureBrvinCloudflareOAuth(
      env(db),
      request("https://parmar.example/admin/api/brvin/connect/cloudflare/configure", {
        clientId: "BRVIN.Cloudflare.OAuth123",
        clientSecret: "legacy-cloudflare-client-secret-123456",
      }),
    );
    expect(cfConfigured.status).toBe(200);
    const cfStarted = await startBrvinCloudflareOAuth(
      env(db),
      request("https://parmar.example/admin/api/brvin/connect/cloudflare/start", {}),
    );
    const cfStartBody = await cfStarted.json() as { authorizationUrl: string };
    const cfState = new URL(cfStartBody.authorizationUrl).searchParams.get("state")!;
    const connectFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "legacy-access-token",
        refresh_token: "legacy-refresh-token",
        expires_in: 900,
        scope: BRVIN_CLOUDFLARE_REQUIRED_SCOPES.join(" "),
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true, result: [{ id: "brvin-service" }], errors: [],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", connectFetch);
    const cfCallback = await completeBrvinCloudflareOAuth(
      env(db),
      request("https://parmar.example/admin/brvin/connect/cloudflare/callback?code=oauth-code&state=" + encodeURIComponent(cfState)),
    );
    expect(cfCallback.status).toBe(200);
    expect(db.connections.get("cloudflare")?.status).toBe("connected");

    const retireFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/app/installations?per_page=100")) {
        return new Response(JSON.stringify([{ id: 178850001, account: { login: "ashini-x" } }]), { status: 200 });
      }
      if (url.endsWith("/app/installations/178850001") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url === "https://dash.cloudflare.com/oauth2/revoke" && init?.method === "POST") {
        return new Response("", { status: 200 });
      }
      return new Response(JSON.stringify({ message: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", retireFetch);

    const response = await decommissionLegacyBrvinConnect(
      env(db),
      request("https://parmar.example/admin/api/brvin/connect/revoke", { confirmation: "UNINSTALL BRVIN CONNECT" }),
    );
    const body = await response.json() as {
      ok: boolean; partial: boolean;
      github: { status: string; installationRemoved: boolean; appDeletionRequired: boolean };
      cloudflare: { status: string; tokensRevoked: boolean; oauthClientDeletionRequired: boolean };
    };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.partial).toBe(false);
    expect(body.github).toMatchObject({ status: "revoked", installationRemoved: true, appDeletionRequired: true });
    expect(body.cloudflare).toMatchObject({ status: "revoked", tokensRevoked: true, oauthClientDeletionRequired: true });
    expect(retireFetch).toHaveBeenCalledTimes(4);
    const githubDelete = retireFetch.mock.calls.find(call => String(call[0]).endsWith("/app/installations/178850001"));
    expect(githubDelete?.[1]?.method).toBe("DELETE");
    const revokeCalls = retireFetch.mock.calls.filter(call => String(call[0]) === "https://dash.cloudflare.com/oauth2/revoke");
    expect(revokeCalls).toHaveLength(2);
    expect(String(revokeCalls[0][1]?.body)).toContain("token=legacy-refresh-token");
    expect(String(revokeCalls[1][1]?.body)).toContain("token=legacy-access-token");
    for (const provider of ["github", "cloudflare"]) {
      expect(db.connections.get(provider)?.status).toBe("revoked");
      expect(db.connections.get(provider)?.secret_ciphertext).toBe("");
      expect(db.connections.get(provider)?.metadata_json).not.toContain("legacy-access-token");
      expect(db.connections.get(provider)?.metadata_json).not.toContain("legacy-refresh-token");
    }
  });

  it("refuses an ambiguous GitHub installation and preserves the encrypted key for manual review", async () => {
    const db = new MemoryD1();
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
    let binary = "";
    for (const byte of der) binary += String.fromCharCode(byte);
    const privateKey = "-----BEGIN PRIVATE KEY-----\n" + btoa(binary) + "\n-----END PRIVATE KEY-----";
    const start = await startBrvinGitHubManifest(env(db), request("https://parmar.example/admin/api/brvin/connect/github/manifest", {}));
    const startBody = await start.json() as { action: string };
    const state = new URL(startBody.action).searchParams.get("state")!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: 123, slug: "brvin-connect", name: "BRVIN Connect", pem: privateKey,
      permissions: { ...BRVIN_GITHUB_REQUIRED_PERMISSIONS },
    }), { status: 201, headers: { "content-type": "application/json" } })));
    await completeBrvinGitHubManifest(env(db), request("https://parmar.example/admin/brvin/connect/github/callback?code=manifest-code&state=" + encodeURIComponent(state)));
    const row = db.connections.get("github")!;
    const metadata = JSON.parse(String(row.metadata_json));
    db.connections.set("github", { ...row, status: "connected", metadata_json: JSON.stringify({ ...metadata, installationId: 178850001, installationAccount: "ashini-x" }) });

    const retireFetch = vi.fn(async () => new Response(JSON.stringify([
      { id: 178850001, account: { login: "ashini-x" } },
      { id: 178850002, account: { login: "ashini-x" } },
    ]), { status: 200 }));
    vi.stubGlobal("fetch", retireFetch);
    const response = await decommissionLegacyBrvinConnect(
      env(db),
      request("https://parmar.example/admin/api/brvin/connect/revoke", { confirmation: "UNINSTALL BRVIN CONNECT" }),
    );
    const body = await response.json() as { partial: boolean; github: { status: string; error: string } };
    expect(response.status).toBe(200);
    expect(body.partial).toBe(true);
    expect(body.github.status).toBe("failed");
    expect(body.github.error).toContain("More than one BRVIN GitHub installation matches");
    expect(db.connections.get("github")?.status).toBe("connected");
    expect(db.connections.get("github")?.secret_ciphertext).not.toBe("");
    expect(retireFetch).toHaveBeenCalledTimes(1);
  });
});
