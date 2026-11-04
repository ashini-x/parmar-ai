import { describe, expect, it } from "vitest";
import {
  BRVIN2_ASKMOINA_IDENTITIES,
  BRVIN2_ASKMOINA_MIGRATION_KEY,
  ensureBrvin2AskMoinaIdentities,
} from "../src/brvin/identity-migration";

type Row = Record<string, string | number | null>;

type State = {
  projects: Map<string, Row>;
  applications: Map<string, Row>;
  environments: Map<string, Row>;
  grants: Map<string, Row>;
  migrations: Set<string>;
  foreignKeyIssues: Row[];
};

class FakeStatement {
  private values: unknown[] = [];

  constructor(private readonly db: FakeD1, readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (this.db.read(this.sql, this.values)[0] as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.db.read(this.sql, this.values) as T[], success: true };
  }

  get bound(): unknown[] {
    return this.values;
  }
}

class FakeD1 {
  private state: State;
  private batchTail: Promise<void> = Promise.resolve();
  failMarkerOnce = false;
  seedBatches = 0;
  markerBatches = 0;

  constructor(options?: {
    projects?: Row[];
    applications?: Row[];
    environments?: Row[];
    grants?: Row[];
    foreignKeyIssues?: Row[];
    failMarkerOnce?: boolean;
  }) {
    this.state = {
      projects: new Map((options?.projects ?? [
        { id: "fatman", slug: "fatman", status: "active" },
      ]).map((row): [string, Row] => [String(row.id), { ...row }])),
      applications: new Map((options?.applications ?? []).map((row): [string, Row] => [String(row.id), { ...row }])),
      environments: new Map((options?.environments ?? []).map((row): [string, Row] => [String(row.id), { ...row }])),
      grants: new Map((options?.grants ?? []).map((row): [string, Row] => [String(row.id), { ...row }])),
      migrations: new Set(),
      foreignKeyIssues: options?.foreignKeyIssues ?? [],
    };
    this.failMarkerOnce = options?.failMarkerOnce ?? false;
  }

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean }>> {
    const previous = this.batchTail;
    let release!: () => void;
    this.batchTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const typed = statements as unknown as FakeStatement[];
      const isMarker = typed.some((statement) => statement.sql.includes("INSERT OR IGNORE INTO brvin_migrations"));
      if (isMarker) {
        this.markerBatches += 1;
        if (this.failMarkerOnce) {
          this.failMarkerOnce = false;
          throw new Error("Simulated marker interruption.");
        }
      } else {
        this.seedBatches += 1;
      }
      for (const statement of typed) this.apply(statement.sql, statement.bound);
      return typed.map(() => ({ success: true }));
    } finally {
      release();
    }
  }

  read(sql: string, values: unknown[]): Row[] {
    const seed = BRVIN2_ASKMOINA_IDENTITIES;
    if (sql.includes("FROM brvin_migrations")) {
      const key = String(values[0]);
      return this.state.migrations.has(key) ? [{ migration_key: key }] : [];
    }
    if (sql.includes("PRAGMA foreign_key_check")) {
      return this.state.foreignKeyIssues.map((row) => ({ ...row }));
    }
    if (sql.includes("FROM brvin_projects")) {
      return [...this.state.projects.values()]
        .filter((row) => row.id === values[0] || row.slug === values[1])
        .map((row) => ({ ...row }));
    }
    if (sql.includes("FROM brvin_applications")) {
      return [...this.state.applications.values()]
        .filter((row) => row.id === values[0] || row.slug === values[1])
        .map((row) => ({ ...row }));
    }
    if (sql.includes("FROM brvin_application_environments")) {
      const ids = [seed.productionEnvironmentId, seed.previewEnvironmentId];
      return [...this.state.environments.values()]
        .filter((row) => {
          if (sql.includes("environment_key IN ('production', 'preview')")) {
            return row.id === values[0] ||
              row.id === values[1] ||
              (row.application_id === values[2] && ["production", "preview"].includes(String(row.environment_key)) && row.status === "active");
          }
          return ids.includes(String(row.id)) && (values.length < 3 || row.id === values[0] || row.id === values[1]);
        })
        .map((row) => ({ ...row }));
    }
    if (sql.includes("FROM brvin_application_project_grants")) {
      return [...this.state.grants.values()]
        .filter((row) => row.id === values[0] ||
          (row.application_id === values[1] && row.project_id === values[2] && row.status === "active"))
        .map((row) => ({ ...row }));
    }
    throw new Error("Unexpected FakeD1 read: " + sql);
  }

  getApplication(): Row | undefined {
    const row = this.state.applications.get(BRVIN2_ASKMOINA_IDENTITIES.applicationId);
    return row ? { ...row } : undefined;
  }

  getEnvironment(id: string): Row | undefined {
    const row = this.state.environments.get(id);
    return row ? { ...row } : undefined;
  }

  getGrant(): Row | undefined {
    const row = this.state.grants.get(BRVIN2_ASKMOINA_IDENTITIES.grantId);
    return row ? { ...row } : undefined;
  }

  revokeGrant(): void {
    const row = this.state.grants.get(BRVIN2_ASKMOINA_IDENTITIES.grantId);
    if (row) row.status = "revoked";
  }

  private apply(sql: string, values: unknown[]): void {
    const seed = BRVIN2_ASKMOINA_IDENTITIES;
    if (sql.includes("INSERT OR IGNORE INTO brvin_applications")) {
      const [id, slug, name, description, createdAt, updatedAt] = values;
      const duplicate = [...this.state.applications.values()].some((row) => row.id === id || row.slug === slug);
      if (!duplicate) {
        this.state.applications.set(String(id), {
          id: String(id), slug: String(slug), name: String(name), description: String(description),
          status: "active", created_at: Number(createdAt), updated_at: Number(updatedAt),
        });
      }
      return;
    }
    if (sql.includes("INSERT OR IGNORE INTO brvin_application_environments")) {
      const [id, createdAt, updatedAt, applicationId, applicationSlug] = values;
      const environmentKey = sql.includes("VALUES") ? String(values[1]) : (sql.includes("'preview'") ? "preview" : "production");
      const displayName = sql.includes("'Preview (not bound to BRVIN)'") ? "Preview (not bound to BRVIN)" : "Production";
      const app = this.state.applications.get(String(applicationId));
      const duplicate = [...this.state.environments.values()].some((row) =>
        row.id === id || (row.application_id === applicationId && row.environment_key === environmentKey && row.status === "active")
      );
      if (app?.slug === applicationSlug && app.status === "active" && !duplicate) {
        this.state.environments.set(String(id), {
          id: String(id), application_id: String(applicationId), environment_key: environmentKey,
          display_name: displayName, status: "active", created_at: Number(createdAt), updated_at: Number(updatedAt),
        });
      }
      return;
    }
    if (sql.includes("INSERT OR IGNORE INTO brvin_application_project_grants")) {
      const [id, createdAt, projectId, projectSlug, applicationId, applicationSlug] = values;
      const app = this.state.applications.get(String(applicationId));
      const project = this.state.projects.get(String(projectId));
      const duplicate = [...this.state.grants.values()].some((row) =>
        row.id === id || (row.application_id === applicationId && row.project_id === projectId && row.status === "active")
      );
      if (app?.slug === applicationSlug && app.status === "active" &&
          project?.slug === projectSlug && project.status === "active" && !duplicate) {
        this.state.grants.set(String(id), {
          id: String(id), application_id: String(applicationId), project_id: String(projectId),
          status: "active", created_at: Number(createdAt), created_by: "migration",
        });
      }
      return;
    }
    if (sql.includes("INSERT OR IGNORE INTO brvin_migrations")) {
      this.state.migrations.add(String(values[0]));
      return;
    }
    throw new Error("Unexpected FakeD1 write: " + sql);
  }
}

function asD1(db: FakeD1): D1Database {
  return db as unknown as D1Database;
}

describe("BRVIN 2 AskMoina application identity registration", () => {
  it("creates distinct production and preview identities and only grants Fatman", async () => {
    const db = new FakeD1();
    await ensureBrvin2AskMoinaIdentities(asD1(db), 1_800_000_000_000);

    expect(db.getApplication()).toMatchObject({
      id: BRVIN2_ASKMOINA_IDENTITIES.applicationId,
      slug: "askmoina-voice",
      name: "AskMoina Voice",
      status: "active",
    });
    expect(db.getEnvironment(BRVIN2_ASKMOINA_IDENTITIES.productionEnvironmentId)).toMatchObject({
      application_id: BRVIN2_ASKMOINA_IDENTITIES.applicationId,
      environment_key: "production",
      status: "active",
    });
    expect(db.getEnvironment(BRVIN2_ASKMOINA_IDENTITIES.previewEnvironmentId)).toMatchObject({
      application_id: BRVIN2_ASKMOINA_IDENTITIES.applicationId,
      environment_key: "preview",
      status: "active",
    });
    expect(db.getGrant()).toMatchObject({
      application_id: BRVIN2_ASKMOINA_IDENTITIES.applicationId,
      project_id: "fatman",
      status: "active",
    });
    expect(db.seedBatches).toBe(1);
    expect(db.markerBatches).toBe(1);
  });

  it("is idempotent and does not recreate an administrator-revoked grant", async () => {
    const db = new FakeD1();
    await ensureBrvin2AskMoinaIdentities(asD1(db), 1_800_000_000_000);
    db.revokeGrant();

    await ensureBrvin2AskMoinaIdentities(asD1(db), 1_800_000_100_000);

    expect(db.getGrant()?.status).toBe("revoked");
    expect(db.seedBatches).toBe(1);
    expect(db.markerBatches).toBe(1);
  });

  it("recovers after seed commit if writing the migration marker is interrupted", async () => {
    const db = new FakeD1({ failMarkerOnce: true });

    await expect(ensureBrvin2AskMoinaIdentities(asD1(db), 1_800_000_000_000))
      .rejects.toThrow("Simulated marker interruption.");
    expect(db.getApplication()).toBeDefined();
    expect(db.getEnvironment(BRVIN2_ASKMOINA_IDENTITIES.productionEnvironmentId)).toBeDefined();
    expect(db.getEnvironment(BRVIN2_ASKMOINA_IDENTITIES.previewEnvironmentId)).toBeDefined();
    expect(db.getGrant()).toBeDefined();

    await ensureBrvin2AskMoinaIdentities(asD1(db), 1_800_000_100_000);

    expect(db.markerBatches).toBe(2);
    expect(db.seedBatches).toBe(2);
  });

  it("fails closed if another application already owns the AskMoina slug", async () => {
    const db = new FakeD1({
      applications: [{
        id: "different-id", slug: "askmoina-voice", name: "Other app", status: "active",
      }],
    });

    await expect(ensureBrvin2AskMoinaIdentities(asD1(db)))
      .rejects.toThrow("conflicting AskMoina application");
    expect(db.seedBatches).toBe(0);
    expect(db.markerBatches).toBe(0);
  });

  it("serializes simultaneous initialization without duplicating AskMoina identities", async () => {
    const db = new FakeD1();

    await Promise.all([
      ensureBrvin2AskMoinaIdentities(asD1(db), 1_800_000_000_000),
      ensureBrvin2AskMoinaIdentities(asD1(db), 1_800_000_000_001),
    ]);

    expect(db.getApplication()).toBeDefined();
    expect(db.getEnvironment(BRVIN2_ASKMOINA_IDENTITIES.productionEnvironmentId)).toBeDefined();
    expect(db.getEnvironment(BRVIN2_ASKMOINA_IDENTITIES.previewEnvironmentId)).toBeDefined();
    expect(db.getGrant()?.project_id).toBe("fatman");
  });

  it("fails closed when orphaned AskMoina environment rows exist without the application", async () => {
    const db = new FakeD1({
      environments: [{
        id: BRVIN2_ASKMOINA_IDENTITIES.productionEnvironmentId,
        application_id: "different-application",
        environment_key: "production",
        status: "active",
      }],
    });

    await expect(ensureBrvin2AskMoinaIdentities(asD1(db)))
      .rejects.toThrow("orphaned AskMoina environment");
    expect(db.seedBatches).toBe(0);
    expect(db.markerBatches).toBe(0);
  });

  it("fails closed when a different active row owns the production environment key", async () => {
    const db = new FakeD1({
      applications: [{
        id: BRVIN2_ASKMOINA_IDENTITIES.applicationId,
        slug: "askmoina-voice",
        name: "AskMoina Voice",
        status: "active",
      }],
      environments: [{
        id: "different-production-id",
        application_id: BRVIN2_ASKMOINA_IDENTITIES.applicationId,
        environment_key: "production",
        status: "active",
      }],
    });

    await expect(ensureBrvin2AskMoinaIdentities(asD1(db)))
      .rejects.toThrow("conflicting AskMoina production environment");
    expect(db.seedBatches).toBe(0);
    expect(db.markerBatches).toBe(0);
  });

  it("fails closed when a different active grant ID already connects AskMoina to Fatman", async () => {
    const db = new FakeD1({
      applications: [{
        id: BRVIN2_ASKMOINA_IDENTITIES.applicationId,
        slug: "askmoina-voice",
        name: "AskMoina Voice",
        status: "active",
      }],
      grants: [{
        id: "different-grant-id",
        application_id: BRVIN2_ASKMOINA_IDENTITIES.applicationId,
        project_id: "fatman",
        status: "active",
      }],
    });

    await expect(ensureBrvin2AskMoinaIdentities(asD1(db)))
      .rejects.toThrow("conflicting AskMoina to Fatman project grant");
    expect(db.seedBatches).toBe(0);
    expect(db.markerBatches).toBe(0);
  });

  it("does not register AskMoina when Fatman is missing or inactive", async () => {
    const missing = new FakeD1({ projects: [] });
    await expect(ensureBrvin2AskMoinaIdentities(asD1(missing)))
      .rejects.toThrow("active Fatman project");
    expect(missing.seedBatches).toBe(0);
  });

  it("does not write a marker when the database reports a foreign-key violation", async () => {
    const db = new FakeD1({ foreignKeyIssues: [{ table: "invalid", rowid: 1 }] });
    await expect(ensureBrvin2AskMoinaIdentities(asD1(db)))
      .rejects.toThrow("foreign-key violation");
    expect(db.markerBatches).toBe(0);
  });

  it("uses a distinct, versioned migration marker", () => {
    expect(BRVIN2_ASKMOINA_MIGRATION_KEY).toBe("brvin2-askmoina-application-identities-v1");
  });
});
