import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAnalyticsSchema: vi.fn(async () => undefined),
  recordBrvinActivity: vi.fn(async () => undefined),
}));
vi.mock("../src/analytics/db", () => mocks);

import {
  createBrvinApplication,
  createBrvinEnvironment,
  setBrvinApplicationStatus,
  setBrvinEnvironmentStatus,
  setBrvinProjectGrant,
  setBrvinProjectStatus,
  updateBrvinProject,
  brvinApplications,
} from "../src/brvin/application-admin";

type Row = Record<string, unknown>;
type State = {
  applications: Row[];
  environments: Row[];
  projects: Row[];
  grants: Row[];
  legacyClientProjectIds: string[];
};

function createDb(state: State): any {
  function first(sql: string, args: unknown[]): Row | null {
    const query = sql.toLowerCase().replace(/\s+/gu, " ");
    if (query.includes("from brvin_applications where slug")) {
      return state.applications.find(row => row.slug === args[0]) ?? null;
    }
    if (query.includes("from brvin_applications where id")) {
      return state.applications.find(row => row.id === args[0]) ?? null;
    }
    if (query.includes("from brvin_application_environments where application_id")) {
      return state.environments
        .filter(row => row.application_id === args[0] && row.environment_key === args[1])
        .sort((a,b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))[0] ?? null;
    }
    if (query.includes("from brvin_application_environments e join brvin_applications")) {
      const row = state.environments.find(item => item.id === args[0]);
      if (!row) return null;
      const app = state.applications.find(item => item.id === row.application_id);
      return app ? { ...row, application_status: app.status } : null;
    }
    if (query.includes("from brvin_projects p where p.id")) {
      const row = state.projects.find(item => item.id === args[0]);
      return row ? {
        ...row,
        has_legacy_identity: state.legacyClientProjectIds.includes(String(row.id)) ? 1 : 0,
      } : null;
    }
    if (query.includes("from brvin_projects where id")) {
      return state.projects.find(row => row.id === args[0]) ?? null;
    }
    if (query.includes("from brvin_application_project_grants where application_id")) {
      return state.grants.find(row =>
        row.application_id === args[0] && row.project_id === args[1] && row.status === "active"
      ) ?? null;
    }
    if (query.includes("from brvin_applications where id,slug,name")) {
      return state.applications.find(row => row.id === args[0]) ?? null;
    }
    if (query.includes("from brvin_application_environments where id")) {
      return state.environments.find(row => row.id === args[0]) ?? null;
    }
    return null;
  }

  function all(sql: string): Row[] {
    const query = sql.toLowerCase().replace(/\s+/gu, " ");
    if (query.includes("from brvin_applications order by")) return [...state.applications];
    if (query.includes("from brvin_application_environments order by")) return [...state.environments];
    if (query.includes("from brvin_application_project_grants g join brvin_projects")) {
      return state.grants.map(grant => {
        const project = state.projects.find(row => row.id === grant.project_id);
        return project ? {
          ...grant,
          project_name: project.name,
          project_slug: project.slug,
          project_status: project.status,
        } : null;
      }).filter((row): row is Row => row !== null);
    }
    if (query.includes("from brvin_projects order by")) return [...state.projects];
    return [];
  }

  async function run(sql: string, args: unknown[]): Promise<{ success: boolean }> {
    const query = sql.toLowerCase().replace(/\s+/gu, " ");
    if (query.includes("insert into brvin_applications")) {
      state.applications.push({
        id: args[0], slug: args[1], name: args[2], description: args[3],
        status: "active", created_at: args[4], updated_at: args[5],
      });
      return { success: true };
    }
    if (query.includes("insert into brvin_application_environments") && query.includes("select")) {
      const app = state.applications.find(row => row.id === args[5] && row.status === "active");
      if (app) state.environments.push({
        id: args[0], application_id: app.id, environment_key: args[1],
        display_name: args[2], status: "active", created_at: args[3], updated_at: args[4],
      });
      return { success: Boolean(app) };
    }
    if (query.includes("insert into brvin_application_environments")) {
      const app = state.applications.find(row => row.id === args[1] && row.status === "active");
      if (app) state.environments.push({
        id: args[0], application_id: args[1], environment_key: args[2],
        display_name: args[3], status: "active", created_at: args[4], updated_at: args[5],
      });
      return { success: Boolean(app) };
    }
    if (query.includes("update brvin_application_environments set status='active'")) {
      const row = state.environments.find(item => item.id === args[0] && item.status === "disabled");
      if (row) { row.status = "active"; row.updated_at = args[1]; }
      return { success: Boolean(row) };
    }
    if (query.includes("update brvin_application_environments set status='disabled'")) {
      const row = state.environments.find(item => item.id === args[1] && item.status === "active");
      if (row) { row.status = "disabled"; row.updated_at = args[0]; }
      return { success: Boolean(row) };
    }
    if (query.includes("update brvin_application_environments set status='revoked'")) {
      if (query.includes("where application_id")) {
        for (const row of state.environments) {
          if (row.application_id === args[2] && ["active","disabled"].includes(String(row.status))) {
            row.status = "revoked"; row.revoked_at = args[0]; row.revoked_by = "admin-dashboard"; row.updated_at = args[1];
          }
        }
        return { success: true };
      }
      const row = state.environments.find(item => item.id === args[2] && ["active","disabled"].includes(String(item.status)));
      if (row) { row.status = "revoked"; row.revoked_at = args[0]; row.revoked_by = "admin-dashboard"; row.updated_at = args[1]; }
      return { success: Boolean(row) };
    }
    if (query.includes("update brvin_application_environments set status=?")) {
      const row = state.environments.find(item => item.id === args[2] && item.status === "disabled");
      if (row) { row.status = args[0]; row.updated_at = args[1]; }
      return { success: Boolean(row) };
    }
    if (query.includes("update brvin_applications set status")) {
      const row = state.applications.find(item => item.id === args[2]);
      if (row) { row.status = args[0]; row.updated_at = args[1]; }
      return { success: Boolean(row) };
    }
    if (query.includes("update brvin_application_project_grants set status='revoked'") && query.includes("where application_id")) {
      for (const row of state.grants) {
        if (row.application_id === args[1] && row.status === "active") {
          row.status = "revoked"; row.revoked_at = args[0]; row.revoked_by = "admin-dashboard";
        }
      }
      return { success: true };
    }
    if (query.includes("insert into brvin_application_project_grants")) {
      state.grants.push({
        id: args[0], application_id: args[1], project_id: args[2],
        status: "active", created_at: args[3], created_by: "admin-dashboard",
      });
      return { success: true };
    }
    if (query.includes("update brvin_application_project_grants set status='revoked'")) {
      const row = state.grants.find(item => item.id === args[1] && item.status === "active");
      if (row) { row.status = "revoked"; row.revoked_at = args[0]; row.revoked_by = "admin-dashboard"; }
      return { success: Boolean(row) };
    }
    if (query.includes("update brvin_projects set name")) {
      const row = state.projects.find(item => item.id === args[4]);
      if (row) {
        row.name = args[0]; row.slug = args[1]; row.description = args[2]; row.updated_at = args[3];
      }
      return { success: Boolean(row) };
    }
    if (query.includes("update brvin_projects set status")) {
      const row = state.projects.find(item => item.id === args[2]);
      if (row) { row.status = args[0]; row.updated_at = args[1]; }
      return { success: Boolean(row) };
    }
    return { success: true };
  }

  const db = {
    prepare(sql: string) {
      const statement: any = {
        sql,
        args: [] as unknown[],
        bind(...values: unknown[]) { statement.args = values; return statement; },
        first() { return Promise.resolve(first(statement.sql, statement.args)); },
        all() { return Promise.resolve({ results: all(statement.sql) }); },
        run() { return run(statement.sql, statement.args); },
      };
      return statement;
    },
    async batch(statements: any[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return db;
}

function request(body: unknown): Request {
  return new Request("https://admin.example/admin/api/brvin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const TEST_APPLICATION_ID = "11111111-2222-4333-8444-555555555555";
const TEST_ENVIRONMENT_ID = "22222222-3333-4444-8555-666666666666";
const TEST_PROJECT_ID = "test-project";

describe("BRVIN application and project administration", () => {
  let state: State;
  let env: any;

  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      applications: [{
        id: TEST_APPLICATION_ID, slug: "test-client", name: "Test Client",
        description: "", status: "active", created_at: 1, updated_at: 1,
      }],
      environments: [{
        id: TEST_ENVIRONMENT_ID, application_id: TEST_APPLICATION_ID,
        environment_key: "production", display_name: "Production",
        status: "active", created_at: 1, updated_at: 1,
      }],
      projects: [{
        id: TEST_PROJECT_ID, name: "Test Project", slug: "test-project",
        description: "", status: "active", created_at: 1, updated_at: 1,
      }],
      grants: [],
      legacyClientProjectIds: [],
    };
    env = { DB: createDb(state) };
  });

  it("creates an application and its first generated environment identity", async () => {
    const response = await createBrvinApplication(env, request({
      name: "Second Test Client",
      description: "An isolated reference consumer",
      environmentKey: "test",
      environmentDisplayName: "Test",
    }));
    const data = await response.json() as any;

    expect(response.status).toBe(201);
    expect(data.application.slug).toBe("second-test-client");
    expect(data.application.id).toMatch(UUID_PATTERN);
    expect(data.environment.id).toMatch(UUID_PATTERN);
    expect(data.environment.environmentKey).toBe("test");
    expect(state.applications).toHaveLength(2);
    expect(state.environments.some(row => row.id === data.environment.id)).toBe(true);
    expect(mocks.recordBrvinActivity).toHaveBeenCalledWith(env, expect.objectContaining({
      eventType: "application.created",
    }));
  });

  it("creates a new environment with a unique generated ID", async () => {
    const response = await createBrvinEnvironment(env, request({
      applicationId: TEST_APPLICATION_ID,
      environmentKey: "preview",
      displayName: "Preview",
    }));
    const data = await response.json() as any;

    expect(response.status).toBe(201);
    expect(data.environment.id).toMatch(UUID_PATTERN);
    expect(data.environment.id).not.toBe(TEST_ENVIRONMENT_ID);
    expect(state.environments.some(row => row.environment_key === "preview" && row.status === "active")).toBe(true);
  });

  it("does not allow two active environments with the same key", async () => {
    const response = await createBrvinEnvironment(env, request({
      applicationId: TEST_APPLICATION_ID,
      environmentKey: "production",
    }));
    const data = await response.json() as any;

    expect(response.status).toBe(409);
    expect(data.error).toContain("already has an active environment");
  });

  it("revokes an application and cascades revocation to active environments and grants", async () => {
    state.grants.push({
      id: "33333333-4444-4555-8666-777777777777",
      application_id: TEST_APPLICATION_ID,
      project_id: TEST_PROJECT_ID,
      status: "active",
      created_at: 1,
    });
    const response = await setBrvinApplicationStatus(env, request({
      applicationId: TEST_APPLICATION_ID,
      status: "revoked",
    }));
    const data = await response.json() as any;

    expect(response.status).toBe(200);
    expect(data.status).toBe("revoked");
    expect(state.applications[0].status).toBe("revoked");
    expect(state.environments[0].status).toBe("revoked");
    expect(state.grants[0].status).toBe("revoked");
  });

  it("does not reactivate a revoked environment identity", async () => {
    state.environments[0].status = "revoked";
    const response = await setBrvinEnvironmentStatus(env, request({
      environmentId: TEST_ENVIRONMENT_ID,
      status: "active",
    }));
    const data = await response.json() as any;

    expect(response.status).toBe(409);
    expect(data.error).toContain("cannot be reactivated");
  });

  it("requires an active application and project before granting access", async () => {
    state.applications[0].status = "suspended";
    const response = await setBrvinProjectGrant(env, request({
      applicationId: TEST_APPLICATION_ID,
      projectId: TEST_PROJECT_ID,
      action: "grant",
    }));
    const data = await response.json() as any;

    expect(response.status).toBe(409);
    expect(data.error).toContain("active application");
    expect(state.grants).toHaveLength(0);
  });

  it("supports grant and explicit revocation of an existing project", async () => {
    const granted = await setBrvinProjectGrant(env, request({
      applicationId: TEST_APPLICATION_ID,
      projectId: TEST_PROJECT_ID,
      action: "grant",
    }));
    const grantData = await granted.json() as any;
    expect(granted.status).toBe(201);
    expect(grantData.status).toBe("active");
    expect(state.grants).toHaveLength(1);

    const revoked = await setBrvinProjectGrant(env, request({
      applicationId: TEST_APPLICATION_ID,
      projectId: TEST_PROJECT_ID,
      action: "revoke",
    }));
    const revokeData = await revoked.json() as any;
    expect(revoked.status).toBe(200);
    expect(revokeData.status).toBe("revoked");
    expect(state.grants[0].status).toBe("revoked");
    expect(state.grants[0].revoked_at).toBeTypeOf("number");
  });

  it("edits an application-owned project's name, slug and description without changing its ID", async () => {
    const response = await updateBrvinProject(env, request({
      projectId: TEST_PROJECT_ID,
      name: "New Test Project",
      description: "Updated reference project",
    }));
    const data = await response.json() as any;

    expect(response.status).toBe(200);
    expect(data.project.id).toBe(TEST_PROJECT_ID);
    expect(data.project.slug).toBe("new-test-project");
    expect(data.project.description).toBe("Updated reference project");
    expect(data.legacySlugPreserved).toBe(false);
  });

  it("preserves a legacy v1 client slug when editing its project display name", async () => {
    state.legacyClientProjectIds.push(TEST_PROJECT_ID);
    const response = await updateBrvinProject(env, request({
      projectId: TEST_PROJECT_ID,
      name: "Legacy Project Renamed",
      description: "Display name only",
    }));
    const data = await response.json() as any;

    expect(response.status).toBe(200);
    expect(data.project.name).toBe("Legacy Project Renamed");
    expect(data.project.slug).toBe("test-project");
    expect(data.legacySlugPreserved).toBe(true);
  });

  it("activates and deactivates a project without deleting its grants", async () => {
    const inactive = await setBrvinProjectStatus(env, request({
      projectId: TEST_PROJECT_ID,
      status: "inactive",
    }));
    expect(inactive.status).toBe(200);
    expect(state.projects[0].status).toBe("inactive");

    const active = await setBrvinProjectStatus(env, request({
      projectId: TEST_PROJECT_ID,
      status: "active",
    }));
    expect(active.status).toBe(200);
    expect(state.projects[0].status).toBe("active");
  });

  it("shows registered applications, environment IDs and grant history in the admin read model", async () => {
    const response = await brvinApplications(env);
    const data = await response.json() as any;

    expect(response.status).toBe(200);
    expect(data.applications[0].id).toBe(TEST_APPLICATION_ID);
    expect(data.applications[0].environments[0].id).toBe(TEST_ENVIRONMENT_ID);
    expect(data.projects[0].id).toBe(TEST_PROJECT_ID);
    expect(data.applications[0].activeEnvironmentCount).toBe(1);
  });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
