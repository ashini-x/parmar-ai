import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env";

const ensure = vi.hoisted(() => vi.fn(async () => undefined));
const activity = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/analytics/db", () => ({
  ensureAnalyticsSchema: ensure,
  recordBrvinActivity: activity,
}));

import {
  createBrvinApplication,
  createBrvinApplicationEnvironment,
  createBrvinProject,
  updateBrvinApplication,
  grantBrvinApplicationProject,
  revokeBrvinApplicationProject,
  setBrvinApplicationStatus,
  setBrvinEnvironmentStatus,
  updateBrvinProject,
} from "../src/brvin/admin";

type Row = Record<string, unknown>;

class MemoryD1Statement {
  private values: unknown[] = [];
  constructor(private readonly db: MemoryD1, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> { return this.db.first(this.sql, this.values) as T | null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: await this.db.all(this.sql, this.values) as T[] }; }
  async run(): Promise<{ success: boolean }> { return this.db.run(this.sql, this.values); }
}

class MemoryD1 {
  applications: Row[] = [];
  environments: Row[] = [];
  projects: Row[] = [];
  grants: Row[] = [];
  legacyClients: Row[] = [];
  statements: string[] = [];

  prepare(sql: string) { return new MemoryD1Statement(this, sql); }

  async batch(statements: MemoryD1Statement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  async first(sql: string, values: unknown[]): Promise<Row | null> {
    this.statements.push(sql);
    if (sql.includes("FROM brvin_applications WHERE id=? AND status='active'")) {
      return this.applications.find(row => row.id === values[0] && row.status === "active") ?? null;
    }
    if (sql.includes("FROM brvin_applications WHERE id=?")) {
      return this.applications.find(row => row.id === values[0]) ?? null;
    }
    if (sql.includes("FROM brvin_projects WHERE id=? AND status='active'")) {
      return this.projects.find(row => row.id === values[0] && row.status === "active") ?? null;
    }
    if (sql.includes("FROM brvin_projects WHERE id=?")) {
      return this.projects.find(row => row.id === values[0]) ?? null;
    }
    if (sql.includes("FROM brvin_application_project_grants WHERE application_id=? AND project_id=? AND status='active'")) {
      return this.grants.find(row => row.application_id === values[0] && row.project_id === values[1] && row.status === "active") ?? null;
    }
    if (sql.includes("FROM brvin_application_environments e JOIN brvin_applications a")) {
      const environment = this.environments.find(row => row.id === values[0]);
      if (!environment) return null;
      const application = this.applications.find(row => row.id === environment.application_id);
      return application ? { ...environment, application_status: application.status } : null;
    }
    return null;
  }

  async all(sql: string, _values: unknown[]): Promise<Row[]> {
    this.statements.push(sql);
    return [];
  }

  async run(sql: string, values: unknown[]): Promise<{ success: boolean }> {
    this.statements.push(sql);
    if (sql.includes("INSERT INTO brvin_applications")) {
      const [id, slug, name, description, ownerLabel, createdAt, updatedAt] = values;
      this.applications.push({ id, slug, name, description, owner_label: ownerLabel, status: "active", created_at: createdAt, updated_at: updatedAt });
    } else if (sql.includes("INSERT INTO brvin_application_environments")) {
      const [id, applicationId, environmentKey, displayName, createdAt, updatedAt] = values;
      this.environments.push({
        id, application_id: applicationId, environment_key: environmentKey, display_name: displayName,
        status: "active", created_at: createdAt, updated_at: updatedAt, revoked_at: null, revoked_by: null,
      });
    } else if (sql.includes("INSERT INTO brvin_projects")) {
      const [id, name, slug, description, ownerLabel, createdAt, updatedAt] = values;
      this.projects.push({ id, name, slug, description, owner_label: ownerLabel, status: "active", created_at: createdAt, updated_at: updatedAt });
    } else if (sql.includes("INSERT INTO brvin_application_project_grants")) {
      const [id, applicationId, projectId, createdAt] = values;
      this.grants.push({
        id, application_id: applicationId, project_id: projectId, status: "active",
        created_at: createdAt, created_by: "admin-dashboard", revoked_at: null, revoked_by: null,
      });
    } else if (sql.includes("INSERT INTO brvin_service_clients")) {
      this.legacyClients.push({ client_id: values[0], project_id: values[1] });
    } else if (sql.includes("UPDATE brvin_applications SET status")) {
      const [status, updatedAt, id] = values;
      const row = this.applications.find(item => item.id === id);
      if (row) Object.assign(row, { status, updated_at: updatedAt });
    } else if (sql.includes("UPDATE brvin_application_environments SET status")) {
      const [status, updatedAt, revokeStatus, revokedAt, revokeByStatus, id] = values;
      const row = this.environments.find(item => item.id === id);
      if (row) {
        Object.assign(row, { status, updated_at: updatedAt });
        if (revokeStatus === "revoked") Object.assign(row, { revoked_at: revokedAt, revoked_by: "admin-dashboard" });
      }
    } else if (sql.includes("UPDATE brvin_application_project_grants SET status='revoked'")) {
      const [revokedAt, id] = values;
      const row = this.grants.find(item => item.id === id);
      if (row) Object.assign(row, { status: "revoked", revoked_at: revokedAt, revoked_by: "admin-dashboard" });
    } else if (sql.includes("UPDATE brvin_projects SET name")) {
      const [name, description, ownerLabel, status, updatedAt, id] = values;
      const row = this.projects.find(item => item.id === id);
      if (row) Object.assign(row, { name, description, owner_label: ownerLabel, status, updated_at: updatedAt });
    } else if (sql.includes("UPDATE brvin_applications SET name")) {
      const [name, description, ownerLabel, updatedAt, id] = values;
      const row = this.applications.find(item => item.id === id);
      if (row) Object.assign(row, { name, description, owner_label: ownerLabel, updated_at: updatedAt });
    }
    return { success: true };
  }
}

function request(body: unknown): Request {
  return new Request("https://parmar.example/admin/api/brvin/test", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://parmar.example" },
    body: JSON.stringify(body),
  });
}

function environment(db: MemoryD1) {
  return { DB: db } as unknown as Env;
}

describe("BRVIN application and project administration", () => {
  beforeEach(() => {
    ensure.mockClear();
    activity.mockClear();
  });

  it("creates an application with a generated UUID and normalized slug", async () => {
    const db = new MemoryD1();
    const response = await createBrvinApplication(environment(db), request({
      name: "Moina Text Lab",
      description: "Independent BRVIN test consumer",
      ownerLabel: "Teacher A",
    }));
    const body = await response.json() as { ok: boolean; application: { id: string; slug: string; status: string; ownerLabel: string } };
    expect(response.status).toBe(201);
    expect(body.application.id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(body.application.slug).toBe("moina-text-lab");
    expect(body.application.status).toBe("active");
    expect(body.application.ownerLabel).toBe("Teacher A");
    expect(db.applications[0].owner_label).toBe("Teacher A");
    expect(activity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "application.created" }));
  });

  it("creates only an active environment under an active application", async () => {
    const db = new MemoryD1();
    const appId = "11111111-2222-4333-8444-555555555555";
    db.applications.push({ id: appId, status: "active" });
    const response = await createBrvinApplicationEnvironment(environment(db), request({
      applicationId: appId,
      environmentKey: "Preview QA",
      displayName: "Preview QA",
    }));
    const body = await response.json() as { environment: { id: string; environmentKey: string; status: string } };
    expect(response.status).toBe(201);
    expect(body.environment.id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(body.environment.environmentKey).toBe("preview-qa");
    expect(body.environment.status).toBe("active");
  });

  it("creates a new app-associated project with a grant, not a legacy client mapping", async () => {
    const db = new MemoryD1();
    const appId = "11111111-2222-4333-8444-555555555555";
    db.applications.push({ id: appId, status: "active" });
    const response = await createBrvinProject(environment(db), request({
      applicationId: appId,
      name: "BRVIN Text Test",
      description: "Test project",
      ownerLabel: "Teacher B · Mathematics",
    }));
    const body = await response.json() as { project: { id: string; slug: string; applicationId: string; ownerLabel: string } };
    expect(response.status).toBe(201);
    expect(body.project.slug).toBe("brvin-text-test");
    expect(body.project.applicationId).toBe(appId);
    expect(body.project.ownerLabel).toBe("Teacher B · Mathematics");
    expect(db.projects[0].owner_label).toBe("Teacher B · Mathematics");
    expect(db.projects).toHaveLength(1);
    expect(db.grants).toHaveLength(1);
    expect(db.grants[0]).toMatchObject({ application_id: appId, project_id: body.project.id, status: "active" });
    expect(db.legacyClients).toHaveLength(0);
  });

  it("creates an app-neutral teacher knowledge project without a legacy service-client identity", async () => {
    const db = new MemoryD1();
    const response = await createBrvinProject(environment(db), request({
      name: "Teacher C Mathematics",
      description: "Shortcuts and methods",
      ownerLabel: "Teacher C",
      legacyClient: false,
    }));
    const body = await response.json() as { project: { ownerLabel: string; slug: string } };
    expect(response.status).toBe(201);
    expect(body.project.ownerLabel).toBe("Teacher C");
    expect(body.project.slug).toBe("teacher-c-mathematics");
    expect(db.projects[0].owner_label).toBe("Teacher C");
    expect(db.legacyClients).toHaveLength(0);
    expect(db.grants).toHaveLength(0);
  });

  it("preserves legacy service-client creation when no application is supplied", async () => {
    const db = new MemoryD1();
    const response = await createBrvinProject(environment(db), request({
      name: "Legacy Project",
      description: "Compatibility path",
    }));
    expect(response.status).toBe(201);
    expect(db.legacyClients).toHaveLength(1);
    expect(db.grants).toHaveLength(0);
  });

  it("does not grant a project to an inactive application", async () => {
    const db = new MemoryD1();
    const appId = "11111111-2222-4333-8444-555555555555";
    db.applications.push({ id: appId, status: "suspended" });
    const response = await grantBrvinApplicationProject(environment(db), request({
      applicationId: appId,
      projectId: "fatman",
    }));
    expect(response.status).toBe(409);
    expect(db.grants).toHaveLength(0);
  });

  it("retains a revoked grant as audit history and denies it as active", async () => {
    const db = new MemoryD1();
    const appId = "11111111-2222-4333-8444-555555555555";
    const projectId = "22222222-3333-4444-8555-666666666666";
    const grantId = "33333333-4444-4555-8666-777777777777";
    db.grants.push({ id: grantId, application_id: appId, project_id: projectId, status: "active" });
    const response = await revokeBrvinApplicationProject(environment(db), request({ applicationId: appId, projectId }));
    expect(response.status).toBe(200);
    expect(db.grants).toHaveLength(1);
    expect(db.grants[0]).toMatchObject({ id: grantId, status: "revoked", revoked_by: "admin-dashboard" });
  });

  it("prevents reactivation of a permanently revoked environment identity", async () => {
    const db = new MemoryD1();
    const appId = "11111111-2222-4333-8444-555555555555";
    const environmentId = "22222222-3333-4444-8555-666666666666";
    db.applications.push({ id: appId, status: "active" });
    db.environments.push({ id: environmentId, application_id: appId, status: "revoked" });
    const response = await setBrvinEnvironmentStatus(environment(db), request({ environmentId, status: "active" }));
    expect(response.status).toBe(409);
  });

  it("allows project editing and deactivation without dropping source or app grants", async () => {
    const db = new MemoryD1();
    db.projects.push({ id: "fatman", name: "Fatman", description: "", status: "active" });
    db.grants.push({ id: "grant-1", application_id: "app-1", project_id: "fatman", status: "active" });
    const response = await updateBrvinProject(environment(db), request({
      projectId: "fatman",
      name: "Fatman Knowledge",
      description: "Preserved legacy knowledge project",
      ownerLabel: "Legacy owner",
      status: "inactive",
    }));
    expect(response.status).toBe(200);
    expect(db.projects[0]).toMatchObject({ name: "Fatman Knowledge", owner_label: "Legacy owner", status: "inactive" });
    expect(db.grants[0].status).toBe("active");
  });

  it("updates application owner metadata without changing its identity or status", async () => {
    const db = new MemoryD1();
    const appId = "11111111-2222-4333-8444-555555555555";
    db.applications.push({
      id: appId, slug: "math-bot", name: "Math Bot", description: "Before",
      owner_label: "Teacher A", status: "active",
    });
    const response = await updateBrvinApplication(environment(db), request({
      applicationId: appId,
      name: "SSC Mathematics Bot",
      description: "Teacher-specific mathematics assistant",
      ownerLabel: "Teacher A · Mathematics",
    }));
    const body = await response.json() as { application: { name: string; ownerLabel: string; status: string } };
    expect(response.status).toBe(200);
    expect(body.application).toMatchObject({
      name: "SSC Mathematics Bot", ownerLabel: "Teacher A · Mathematics", status: "active",
    });
    expect(db.applications[0]).toMatchObject({
      slug: "math-bot", owner_label: "Teacher A · Mathematics", status: "active",
    });
    expect(activity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "application.updated" }));
  });

  it("does not reactivate a permanently revoked application", async () => {
    const db = new MemoryD1();
    const appId = "11111111-2222-4333-8444-555555555555";
    db.applications.push({ id: appId, status: "revoked" });
    const response = await setBrvinApplicationStatus(environment(db), request({ applicationId: appId, status: "active" }));
    expect(response.status).toBe(409);
  });
});
