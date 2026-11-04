import { describe, expect, it } from "vitest";
import {
  BRVIN2_APPLICATION_MIGRATION_KEY,
  BRVIN2_SEED_IDENTITIES,
  ensureBrvin2ApplicationIdentities,
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

  constructor(
    private readonly db: FakeD1Database,
    readonly sql: string,
  ) {}

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

  async run(): Promise<{ success: boolean }> {
    await this.db.batch([this as unknown as D1PreparedStatement]);
    return { success: true };
  }

  getBoundValues(): unknown[] {
    return this.values;
  }
}

class FakeD1Database {
  private state: State;
  private batchTail: Promise<void> = Promise.resolve();
  failMarkerBatchOnce = false;
  seedBatchCount = 0;
  markerBatchCount = 0;

  constructor(options?: {
    applications?: Row[];
    environments?: Row[];
    grants?: Row[];
    projects?: Row[];
    foreignKeyIssues?: Row[];
    failMarkerBatchOnce?: boolean;
  }) {
    this.state = {
      projects: new Map<string, Row>((options?.projects ?? [
        { id: "fatman", slug: "fatman", status: "active" },
      ]).map((row): [string, Row] => [String(row.id), { ...row }])),
      applications: new Map<string, Row>((options?.applications ?? []).map((row): [string, Row] => [String(row.id), { ...row }])),
      environments: new Map<string, Row>((options?.environments ?? []).map((row): [string, Row] => [String(row.id), { ...row }])),
      grants: new Map<string, Row>((options?.grants ?? []).map((row): [string, Row] => [String(row.id), { ...row }])),
      migrations: new Set(),
      foreignKeyIssues: options?.foreignKeyIssues ?? [],
    };
    this.failMarkerBatchOnce = options?.failMarkerBatchOnce ?? false;
  }

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean }>> {
    const previous = this.batchTail;
    let release!: () => void;
    this.batchTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      const working = this.cloneState();
      const typed = statements as unknown as FakeStatement[];
      if (typed.some((statement) => statement.sql.includes("INSERT OR IGNORE INTO brvin_migrations"))) {
        this.markerBatchCount += 1;
        if (this.failMarkerBatchOnce) {
          this.failMarkerBatchOnce = false;
          throw new Error("Simulated interruption before migration marker commit.");
        }
      } else {
        this.seedBatchCount += 1;
      }
      for (const statement of typed) {
        this.apply(working, statement.sql, statement.getBoundValues());
      }
      this.state = working;
      return typed.map(() => ({ success: true }));
    } finally {
      release();
    }
  }

  read(sql: string, values: unknown[]): Row[] {
    if (sql.includes("FROM brvin_migrations")) {
      const key = String(values[0]);
      return this.state.migrations.has(key) ? [{ migration_key: key }] : [];
    }
    if (sql === "PRAGMA foreign_key_check") return this.state.foreignKeyIssues.map((row) => ({ ...row }));
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
      return [...this.state.environments.values()]
        .filter((row) =>
          row.id === values[0] ||
          (row.application_id === values[1] &&
            row.environment_key === values[2] &&
            (sql.includes("status = 'active'") ? row.status === "active" : true)),
        )
        .map((row) => ({ ...row }));
    }
    if (sql.includes("FROM brvin_application_project_grants")) {
      return [...this.state.grants.values()]
        .filter((row) =>
          row.id === values[0] ||
          (row.application_id === values[1] &&
            row.project_id === values[2] &&
            (sql.includes("status = 'active'") ? row.status === "active" : true)),
        )
        .map((row) => ({ ...row }));
    }
    throw new Error("Unexpected fake D1 read: " + sql);
  }

  getApplication(id: string): Row | undefined {
    const row = this.state.applications.get(id);
    return row ? { ...row } : undefined;
  }

  getEnvironment(id: string): Row | undefined {
    const row = this.state.environments.get(id);
    return row ? { ...row } : undefined;
  }

  getGrant(id: string): Row | undefined {
    const row = this.state.grants.get(id);
    return row ? { ...row } : undefined;
  }

  revokeSeedGrant(): void {
    const row = this.state.grants.get(BRVIN2_SEED_IDENTITIES.grantId);
    if (row) row.status = "revoked";
  }

  private cloneState(): State {
    const copyMap = (source: Map<string, Row>) =>
      new Map([...source.entries()].map(([key, value]) => [key, { ...value }]));
    return {
      projects: copyMap(this.state.projects),
      applications: copyMap(this.state.applications),
      environments: copyMap(this.state.environments),
      grants: copyMap(this.state.grants),
      migrations: new Set(this.state.migrations),
      foreignKeyIssues: this.state.foreignKeyIssues.map((row) => ({ ...row })),
    };
  }

  private apply(state: State, sql: string, values: unknown[]): void {
    const seed = BRVIN2_SEED_IDENTITIES;
    if (sql.includes("INSERT OR IGNORE INTO brvin_applications")) {
      const [id, slug, name, description, createdAt, updatedAt] = values;
      const duplicate = [...state.applications.values()].some((row) => row.id === id || row.slug === slug);
      if (!duplicate) {
        state.applications.set(String(id), {
          id: String(id),
          slug: String(slug),
          name: String(name),
          description: String(description),
          status: "active",
          created_at: Number(createdAt),
          updated_at: Number(updatedAt),
        });
      }
      return;
    }
    if (sql.includes("INSERT OR IGNORE INTO brvin_application_environments")) {
      const [id, environmentKey, displayName, createdAt, updatedAt, applicationId, applicationSlug] = values;
      const app = state.applications.get(String(applicationId));
      const duplicate = [...state.environments.values()].some((row) =>
        row.id === id ||
        (row.application_id === applicationId &&
          row.environment_key === environmentKey &&
          row.status === "active"),
      );
      if (app?.slug === applicationSlug && app.status === "active" && !duplicate) {
        state.environments.set(String(id), {
          id: String(id),
          application_id: String(applicationId),
          environment_key: String(environmentKey),
          display_name: String(displayName),
          status: "active",
          created_at: Number(createdAt),
          updated_at: Number(updatedAt),
        });
      }
      return;
    }
    if (sql.includes("INSERT OR IGNORE INTO brvin_application_project_grants")) {
      const [id, createdAt, projectId, projectSlug, applicationId, applicationSlug] = values;
      const app = state.applications.get(String(applicationId));
      const project = state.projects.get(String(projectId));
      const duplicate = [...state.grants.values()].some((row) =>
        row.id === id ||
        (row.application_id === applicationId &&
          row.project_id === projectId &&
          row.status === "active"),
      );
      if (
        app?.slug === applicationSlug &&
        app.status === "active" &&
        project?.slug === projectSlug &&
        project.status === "active" &&
        !duplicate
      ) {
        state.grants.set(String(id), {
          id: String(id),
          application_id: String(applicationId),
          project_id: String(projectId),
          status: "active",
          created_at: Number(createdAt),
          created_by: "migration",
        });
      }
      return;
    }
    if (sql.includes("INSERT OR IGNORE INTO brvin_migrations")) {
      state.migrations.add(String(values[0]));
      return;
    }
    throw new Error("Unexpected fake D1 write: " + sql);
  }
}

function asD1(db: FakeD1Database): D1Database {
  return db as unknown as D1Database;
}

describe("BRVIN 2 application identity migration", () => {
  it("creates the Parmar AI production identity and explicit Fatman grant", async () => {
    const db = new FakeD1Database();

    await ensureBrvin2ApplicationIdentities(asD1(db), 1_800_000_000_000);

    expect(db.getApplication(BRVIN2_SEED_IDENTITIES.applicationId)).toMatchObject({
      id: BRVIN2_SEED_IDENTITIES.applicationId,
      slug: "parmar-ai",
      name: "Parmar AI",
      status: "active",
    });
    expect(db.getEnvironment(BRVIN2_SEED_IDENTITIES.environmentId)).toMatchObject({
      id: BRVIN2_SEED_IDENTITIES.environmentId,
      application_id: BRVIN2_SEED_IDENTITIES.applicationId,
      environment_key: "production",
      status: "active",
    });
    expect(db.getGrant(BRVIN2_SEED_IDENTITIES.grantId)).toMatchObject({
      id: BRVIN2_SEED_IDENTITIES.grantId,
      application_id: BRVIN2_SEED_IDENTITIES.applicationId,
      project_id: "fatman",
      status: "active",
    });
    expect(db.seedBatchCount).toBe(1);
    expect(db.markerBatchCount).toBe(1);
  });

  it("is idempotent and does not recreate a grant after an administrator revokes it", async () => {
    const db = new FakeD1Database();
    await ensureBrvin2ApplicationIdentities(asD1(db), 1_800_000_000_000);
    db.revokeSeedGrant();

    await ensureBrvin2ApplicationIdentities(asD1(db), 1_800_000_010_000);

    expect(db.getGrant(BRVIN2_SEED_IDENTITIES.grantId)?.status).toBe("revoked");
    expect(db.seedBatchCount).toBe(1);
    expect(db.markerBatchCount).toBe(1);
  });

  it("recovers safely when the seed batch commits but the migration marker is interrupted", async () => {
    const db = new FakeD1Database({ failMarkerBatchOnce: true });

    await expect(ensureBrvin2ApplicationIdentities(asD1(db), 1_800_000_000_000))
      .rejects.toThrow("Simulated interruption");
    expect(db.getApplication(BRVIN2_SEED_IDENTITIES.applicationId)).toBeDefined();
    expect(db.getEnvironment(BRVIN2_SEED_IDENTITIES.environmentId)).toBeDefined();
    expect(db.getGrant(BRVIN2_SEED_IDENTITIES.grantId)).toBeDefined();

    await ensureBrvin2ApplicationIdentities(asD1(db), 1_800_000_010_000);

    expect(db.markerBatchCount).toBe(2);
    expect(db.seedBatchCount).toBe(2);
  });

  it("serializes simultaneous cold-start seed batches without duplicate identities", async () => {
    const db = new FakeD1Database();

    await Promise.all([
      ensureBrvin2ApplicationIdentities(asD1(db), 1_800_000_000_000),
      ensureBrvin2ApplicationIdentities(asD1(db), 1_800_000_000_001),
    ]);

    expect(db.seedBatchCount).toBe(2);
    expect(db.markerBatchCount).toBe(2);
    expect(db.getApplication(BRVIN2_SEED_IDENTITIES.applicationId)).toBeDefined();
    expect(db.getEnvironment(BRVIN2_SEED_IDENTITIES.environmentId)).toBeDefined();
    expect(db.getGrant(BRVIN2_SEED_IDENTITIES.grantId)).toBeDefined();
  });

  it("fails closed on a conflicting reserved application slug without writing a marker", async () => {
    const db = new FakeD1Database({
      applications: [{
        id: "different-reserved-id",
        slug: "parmar-ai",
        name: "Different application",
        status: "active",
      }],
    });

    await expect(ensureBrvin2ApplicationIdentities(asD1(db)))
      .rejects.toThrow("conflicting application");
    expect(db.seedBatchCount).toBe(0);
    expect(db.markerBatchCount).toBe(0);
  });

  it("fails closed when the reserved production environment key belongs to another identity", async () => {
    const db = new FakeD1Database({
      applications: [{
        id: BRVIN2_SEED_IDENTITIES.applicationId,
        slug: "parmar-ai",
        name: "Parmar AI",
        status: "active",
      }],
      environments: [{
        id: "different-environment-id",
        application_id: BRVIN2_SEED_IDENTITIES.applicationId,
        environment_key: "production",
        status: "active",
      }],
    });

    await expect(ensureBrvin2ApplicationIdentities(asD1(db)))
      .rejects.toThrow("conflicting production environment");
    expect(db.seedBatchCount).toBe(0);
    expect(db.markerBatchCount).toBe(0);
  });

  it("fails closed when the active Parmar AI to Fatman grant has a different reserved ID", async () => {
    const db = new FakeD1Database({
      applications: [{
        id: BRVIN2_SEED_IDENTITIES.applicationId,
        slug: "parmar-ai",
        name: "Parmar AI",
        status: "active",
      }],
      grants: [{
        id: "different-grant-id",
        application_id: BRVIN2_SEED_IDENTITIES.applicationId,
        project_id: "fatman",
        status: "active",
      }],
    });

    await expect(ensureBrvin2ApplicationIdentities(asD1(db)))
      .rejects.toThrow("conflicting Parmar AI to Fatman grant");
    expect(db.seedBatchCount).toBe(0);
    expect(db.markerBatchCount).toBe(0);
  });

  it("does not write the migration marker when D1 reports a foreign-key violation", async () => {
    const db = new FakeD1Database({
      foreignKeyIssues: [{ table: "some_table", rowid: 7 }],
    });

    await expect(ensureBrvin2ApplicationIdentities(asD1(db)))
      .rejects.toThrow("foreign-key violation");
    expect(db.markerBatchCount).toBe(0);
  });

  it("fails closed when the expected Fatman project is not present and active", async () => {
    const db = new FakeD1Database({ projects: [] });

    await expect(ensureBrvin2ApplicationIdentities(asD1(db)))
      .rejects.toThrow("existing active Fatman project");
    expect(db.seedBatchCount).toBe(0);
  });

  it("uses only the existing migration marker key", async () => {
    expect(BRVIN2_APPLICATION_MIGRATION_KEY).toBe("brvin2-application-identities-v1");
  });
});
