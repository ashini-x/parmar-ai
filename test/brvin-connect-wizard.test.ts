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
  completeBrvinGitHubManifest,
  configureBrvinCloudflareOAuth,
  registerBrvinTestConsumer,
  startBrvinGitHubManifest,
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
    if (sql.includes("FROM brvin_application_project_grants")) {
      return this.grants.find(row => row.application_id === values[0] && row.status === "active") ?? null;
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
    expect(body.manifest.default_permissions).toEqual({ metadata: "read", contents: "write", pull_requests: "write" });
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 123,
      slug: "brvin-connect",
      name: "BRVIN Connect",
      html_url: "https://github.com/apps/brvin-connect",
      pem: privateKey,
      permissions: { metadata: "read", contents: "write", pull_requests: "write" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
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

  it("creates the application, environment, project and explicit grant as one batch", async () => {
    const db = new MemoryD1();
    const response = await registerBrvinTestConsumer(env(db), request("https://parmar.example/admin/api/brvin/connect/consumer", {
      applicationName: "BRVIN Text Test Client",
      applicationDescription: "Isolated consumer",
      environmentKey: "production",
      projectName: "BRVIN Text Test Knowledge",
      projectDescription: "No Fatman sharing by default",
    }));
    const body = await response.json() as { application: { id: string; slug: string }; environment: { id: string }; project: { id: string; slug: string } };
    expect(response.status).toBe(201);
    expect(body.application.slug).toBe("brvin-text-test-client");
    expect(body.project.slug).toBe("brvin-text-test-knowledge");
    expect(db.applications).toHaveLength(1);
    expect(db.environments).toHaveLength(1);
    expect(db.projects).toHaveLength(1);
    expect(db.grants).toHaveLength(1);
    expect(db.grants[0]).toMatchObject({ application_id: body.application.id, project_id: body.project.id, status: "active" });
    expect(activity).toHaveBeenCalled();
  });

  it("fails closed for repositories outside the reviewed first adapter", async () => {
    const db = new MemoryD1();
    const response = await createBrvinTestClientPullRequest(env(db), request("https://parmar.example/admin/api/brvin/connect/pull-request", {
      applicationId: "11111111-2222-4333-8444-555555555555",
      environmentId: "22222222-3333-4444-8555-666666666666",
      repository: "someone/other-worker",
      baseBranch: "main",
    }));
    const body = await response.json() as { error: string };
    expect(response.status).toBe(400);
    expect(body.error).toContain("only the BRVIN text test Worker");
    expect(db.statements).toHaveLength(0);
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
