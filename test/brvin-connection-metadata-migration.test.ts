import { describe, expect, it } from "vitest";
import {
  BRVIN_CONNECTION_METADATA_MIGRATION_KEY,
  ensureBrvinConnectionMetadataSchema,
} from "../src/analytics/db";

type Table = "brvin_applications" | "brvin_application_environments";

class ConnectionMetadataStatement {
  private values: unknown[] = [];
  constructor(private readonly db: ConnectionMetadataDb, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>(): Promise<{ results: T[] }> {
    const match = this.sql.match(/^PRAGMA table_info\((brvin_applications|brvin_application_environments)\)$/u);
    if (!match) return { results: [] };
    return {
      results: [...(this.db.columns.get(match[1] as Table) ?? new Set<string>())]
        .map(name => ({ name })) as T[],
    };
  }
  async run(): Promise<{ success: boolean }> {
    const alter = this.sql.match(
      /^ALTER TABLE (brvin_applications|brvin_application_environments) ADD COLUMN ([a-z_]+) /u,
    );
    if (alter) {
      const table = alter[1] as Table;
      const column = alter[2];
      const columns = this.db.columns.get(table) ?? new Set<string>();
      if (columns.has(column)) throw new Error("duplicate column name: " + column);
      columns.add(column);
      this.db.columns.set(table, columns);
      this.db.alters.push(table + "." + column);
    }
    if (this.sql.startsWith("INSERT OR IGNORE INTO brvin_migrations")) {
      this.db.migrations.add(String(this.values[0]));
    }
    return { success: true };
  }
}

class ConnectionMetadataDb {
  columns = new Map<Table, Set<string>>([
    ["brvin_applications", new Set(["id", "slug", "name", "description", "owner_label", "status"])],
    ["brvin_application_environments", new Set(["id", "application_id", "environment_key", "display_name", "status"])],
  ]);
  migrations = new Set<string>();
  alters: string[] = [];
  prepare(sql: string) { return new ConnectionMetadataStatement(this, sql); }
}

describe("BRVIN application connection metadata migration", () => {
  it("adds repository and Worker metadata columns in place and records the migration", async () => {
    const db = new ConnectionMetadataDb();
    await ensureBrvinConnectionMetadataSchema(db as never);

    expect(db.columns.get("brvin_applications")).toEqual(expect.objectContaining(new Set([
      "id", "slug", "name", "description", "owner_label", "status",
      "repository_url", "repository_default_branch", "runtime_provider",
    ])));
    expect(db.columns.get("brvin_application_environments")).toEqual(expect.objectContaining(new Set([
      "id", "application_id", "environment_key", "display_name", "status", "worker_name", "worker_url",
    ])));
    expect(db.alters).toEqual([
      "brvin_applications.repository_url",
      "brvin_applications.repository_default_branch",
      "brvin_applications.runtime_provider",
      "brvin_application_environments.worker_name",
      "brvin_application_environments.worker_url",
    ]);
    expect(db.migrations.has(BRVIN_CONNECTION_METADATA_MIGRATION_KEY)).toBe(true);
  });

  it("is idempotent when the metadata columns already exist", async () => {
    const db = new ConnectionMetadataDb();
    db.columns.get("brvin_applications")?.add("repository_url");
    db.columns.get("brvin_applications")?.add("repository_default_branch");
    db.columns.get("brvin_applications")?.add("runtime_provider");
    db.columns.get("brvin_application_environments")?.add("worker_name");
    db.columns.get("brvin_application_environments")?.add("worker_url");

    await ensureBrvinConnectionMetadataSchema(db as never);
    await ensureBrvinConnectionMetadataSchema(db as never);

    expect(db.alters).toHaveLength(0);
    expect(db.migrations.has(BRVIN_CONNECTION_METADATA_MIGRATION_KEY)).toBe(true);
  });
});
