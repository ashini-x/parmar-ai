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
  createBrvinTestClientPullRequest,
  completeBrvinGitHubManifest,
  completeBrvinCloudflareOAuth,
  configureBrvinCloudflareOAuth,
  registerBrvinTestConsumer,
  provisionBrvinTestClientAccessToken,
  startBrvinGitHubManifest,
  startBrvinCloudflareOAuth,
  verifyBrvinTestClientDeployment,
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

  it("requires both Cloudflare Workers Scripts scopes and a refresh token before accepting OAuth", async () => {
    const db = new MemoryD1();
    await configureBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/configure", {
      clientId: "BRVIN.Cloudflare.OAuth123",
      clientSecret: "cloudflare-client-secret-value-123456",
    }));
    const start = await startBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/start", {}));
    const startBody = await start.json() as { authorizationUrl: string };
    const authorization = new URL(startBody.authorizationUrl);
    expect(authorization.searchParams.get("scope")).toContain("workers-scripts.read");
    expect(authorization.searchParams.get("scope")).toContain("workers-scripts.write");
    const state = authorization.searchParams.get("state")!;

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: "read-only-token",
      scope: "workers-scripts.read",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const callback = await completeBrvinCloudflareOAuth(env(db), request(
      "https://parmar.example/admin/brvin/connect/cloudflare/callback?code=one-time-code&state="+encodeURIComponent(state),
    ));
    expect(callback.status).toBe(400);
    expect(await callback.text()).toContain("Cloudflare permissions incomplete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.connections.get("cloudflare")?.status).toBe("configured");
  });

  it("accepts Cloudflare OAuth only after both scopes, a refresh token and the private BRVIN Worker are confirmed", async () => {
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
        scope: "workers-scripts.read workers-scripts.write offline_access",
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

  it("refuses deployment verification until a dedicated connection PR has recorded its identity", async () => {
    const db = new MemoryD1();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await verifyBrvinTestClientDeployment(env(db), request("https://parmar.example/admin/api/brvin/connect/verify"));
    const body = await response.json() as { connected: boolean; state: string };
    expect(response.status).toBe(409);
    expect(body.connected).toBe(false);
    expect(body.state).toBe("connection_pr_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the application, environment, project and explicit grant as one batch", async () => {
    const db = new MemoryD1();
    const response = await registerBrvinTestConsumer(env(db), request("https://parmar.example/admin/api/brvin/connect/consumer", {
      applicationName: "AskMoina Voice",
      applicationDescription: "Attempted voice identity override",
      environmentKey: "preview",
      projectName: "BRVIN Text Test Knowledge",
      projectDescription: "No Fatman sharing by default",
    }));
    const body = await response.json() as { application: { id: string; slug: string; name: string }; environment: { id: string; key: string }; project: { id: string; slug: string } };
    expect(response.status).toBe(201);
    expect(body.application.slug).toBe("brvin-text-test-client");
    expect(body.application.name).toBe("BRVIN Text Test Client");
    expect(db.environments[0]).toMatchObject({ environment_key: "production" });
    expect(body.project.slug).toBe("brvin-text-test-knowledge");
    expect(db.applications).toHaveLength(1);
    expect(db.environments).toHaveLength(1);
    expect(db.projects).toHaveLength(1);
    expect(db.grants).toHaveLength(1);
    expect(db.grants[0]).toMatchObject({ application_id: body.application.id, project_id: body.project.id, status: "active" });
    expect(activity).toHaveBeenCalled();
  });

  it("refuses to attach the independent text Worker to an existing AskMoina Voice identity", async () => {
    const db = new MemoryD1();
    db.applications.push({
      id: "11111111-2222-4333-8444-555555555555",
      slug: "askmoina-voice",
      name: "AskMoina Voice",
      status: "active",
    });
    db.environments.push({
      id: "22222222-3333-4444-8555-666666666666",
      application_id: "11111111-2222-4333-8444-555555555555",
      environment_key: "production",
      status: "active",
    });
    db.grants.push({
      id: "33333333-4444-4555-8666-777777777777",
      application_id: "11111111-2222-4333-8444-555555555555",
      project_id: "fatman",
      status: "active",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await createBrvinTestClientPullRequest(env(db), request("https://parmar.example/admin/api/brvin/connect/pull-request", {
      applicationId: "11111111-2222-4333-8444-555555555555",
      environmentId: "22222222-3333-4444-8555-666666666666",
      repository: "ashini-x/askmoina-voice",
      baseBranch: "main",
    }));
    const body = await response.json() as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("dedicated BRVIN Text Test Client");
    expect(body.error).toContain("AskMoina Voice and Parmar AI");
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("does not provision a tester token before a connected application and deployment exist", async () => {
    const db = new MemoryD1();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await provisionBrvinTestClientAccessToken(env(db), request("https://parmar.example/admin/api/brvin/connect/test-access-token", {}));
    const body = await response.json() as { error: string };
    expect(response.status).toBe(409);
    expect(body.error).toContain("connection pull request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("provisions a tester token only after a live text-Worker RPC returns the dedicated project", async () => {
    const db = new MemoryD1();
    const applicationId = "11111111-2222-4333-8444-555555555555";
    const environmentId = "22222222-3333-4444-8555-666666666666";
    const projectId = "33333333-4444-4555-8666-777777777777";
    db.applications.push({ id: applicationId, slug: "brvin-text-test-client", name: "BRVIN Text Test Client", status: "active" });
    db.environments.push({ id: environmentId, application_id: applicationId, environment_key: "production", status: "active" });
    db.projects.push({ id: projectId, name: "BRVIN Text Test Knowledge", slug: "brvin-text-test-knowledge", status: "active" });
    db.grants.push({ id: "44444444-5555-4666-8777-888888888888", application_id: applicationId, project_id: projectId, status: "active" });
    db.connections.set("github", {
      provider: "github",
      status: "pr_created",
      metadata_json: JSON.stringify({ connectedApplicationId: applicationId, connectedEnvironmentId: environmentId, connectedProjectId: projectId }),
      secret_ciphertext: "unused-by-token-provision",
      updated_at: Date.now(),
    });
    await configureBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/configure", {
      clientId: "BRVIN.Cloudflare.OAuth123",
      clientSecret: "cloudflare-client-secret-value-123456",
    }));
    const oauthStart = await startBrvinCloudflareOAuth(env(db), request("https://parmar.example/admin/api/brvin/connect/cloudflare/start", {}));
    const oauthStartBody = await oauthStart.json() as { authorizationUrl: string };
    const state = new URL(oauthStartBody.authorizationUrl).searchParams.get("state")!;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/oauth2/token")) {
        return new Response(JSON.stringify({
          access_token: "full-scope-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "workers-scripts.read workers-scripts.write offline_access",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/workers/scripts?per_page=100")) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ id: "brvin-service" }, { id: "brvin-test-client" }],
          errors: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/workers/scripts/brvin-test-client/settings")) {
        return new Response(JSON.stringify({
          success: true,
          result: { bindings: [{ name: "BRVIN_SERVICE", type: "service", service: "brvin-service", entrypoint: "BrvinRetrievalApi" }] },
          errors: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/workers/scripts/brvin-test-client/deployments")) {
        return new Response(JSON.stringify({
          success: true,
          result: { deployments: [{ id: "deployment-1", versions: [{ version_id: "version-1", percentage: 100 }] }] },
          errors: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/workers/scripts/brvin-test-client/secrets") && init?.method === "PUT") {
        return new Response(JSON.stringify({ success: true, result: {}, errors: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/workers/subdomain")) {
        return new Response(JSON.stringify({ success: true, result: { subdomain: "thenewtongs" }, errors: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/workers/scripts/brvin-test-client/subdomain")) {
        return new Response(JSON.stringify({ success: true, result: { enabled: true }, errors: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/projects")) {
        return new Response(JSON.stringify({ ok: true, projects: [{ projectId, slug: "brvin-text-test-knowledge", name: "BRVIN Text Test Knowledge", ready: false, authorizedSourceCount: 0 }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error("Unexpected fetch in test: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const callback = await completeBrvinCloudflareOAuth(env(db), request(
      "https://parmar.example/admin/brvin/connect/cloudflare/callback?code=one-time-code&state="+encodeURIComponent(state),
    ));
    expect(callback.status).toBe(200);

    const response = await provisionBrvinTestClientAccessToken(env(db), request("https://parmar.example/admin/api/brvin/connect/test-access-token", {}));
    const body = await response.json() as { ok: boolean; testerToken?: string; runtimeIdentityVerified?: boolean; verifiedProjectId?: string };
    expect(db.statements.some(sql => sql.includes("g.project_id=?") && sql.includes("brvin-text-test-client") || sql.includes("g.project_id=?"))).toBe(true);
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.runtimeIdentityVerified).toBe(true);
    expect(body.verifiedProjectId).toBe(projectId);
    expect(body.testerToken).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://brvin-test-client.thenewtongs.workers.dev/api/projects",
      expect.objectContaining({ redirect: "error" }),
    );
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
