export const BRVIN2_APPLICATION_MIGRATION_KEY = "brvin2-application-identities-v1";

export const BRVIN2_SEED_IDENTITIES = {
  applicationId: "00000000-0000-4000-8000-000000000101",
  environmentId: "00000000-0000-4000-8000-000000000102",
  grantId: "00000000-0000-4000-8000-000000000103",
  applicationSlug: "parmar-ai",
  applicationName: "Parmar AI",
  environmentKey: "production",
  environmentDisplayName: "Production",
  projectId: "fatman",
  projectSlug: "fatman",
} as const;

type ApplicationRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

type EnvironmentRow = {
  id: string;
  application_id: string;
  environment_key: string;
  status: string;
};

type GrantRow = {
  id: string;
  application_id: string;
  project_id: string;
  status: string;
};

type ProjectRow = {
  id: string;
  slug: string;
  status: string;
};

async function rows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

function assertBatchSucceeded(results: Array<{ success: boolean }>, name: string): void {
  if (results.some((result) => !result.success)) {
    throw new Error("BRVIN 2 identity migration " + name + " batch was not confirmed by D1.");
  }
}

function failConflict(entity: string): never {
  throw new Error(
    "BRVIN 2 identity migration found a conflicting " + entity +
    " record. The migration marker was not written; reconcile the existing row explicitly.",
  );
}

async function verifyPreviouslyApplied(db: D1Database): Promise<void> {
  const seed = BRVIN2_SEED_IDENTITIES;
  const [application, environment, grant] = await Promise.all([
    db.prepare(
      "SELECT id, slug, name, status FROM brvin_applications WHERE id = ?",
    ).bind(seed.applicationId).first<ApplicationRow>(),
    db.prepare(
      "SELECT id, application_id, environment_key, status FROM brvin_application_environments WHERE id = ?",
    ).bind(seed.environmentId).first<EnvironmentRow>(),
    db.prepare(
      "SELECT id, application_id, project_id, status FROM brvin_application_project_grants WHERE id = ?",
    ).bind(seed.grantId).first<GrantRow>(),
  ]);

  // A completed migration must never recreate or reactivate a grant that an
  // administrator later revoked. It only verifies that the seeded identities
  // still refer to their original records.
  if (!application || application.slug !== seed.applicationSlug) {
    throw new Error("BRVIN 2 identity migration marker exists, but its application record is missing or mismatched.");
  }
  if (
    !environment ||
    environment.application_id !== seed.applicationId ||
    environment.environment_key !== seed.environmentKey
  ) {
    throw new Error("BRVIN 2 identity migration marker exists, but its production environment record is missing or mismatched.");
  }
  if (
    !grant ||
    grant.application_id !== seed.applicationId ||
    grant.project_id !== seed.projectId
  ) {
    throw new Error("BRVIN 2 identity migration marker exists, but its Fatman grant record is missing or mismatched.");
  }
}

async function preflight(db: D1Database): Promise<void> {
  const seed = BRVIN2_SEED_IDENTITIES;

  const [projects, applications, environments, grants] = await Promise.all([
    rows<ProjectRow>(
      db.prepare(
        "SELECT id, slug, status FROM brvin_projects WHERE id = ? OR slug = ?",
      ).bind(seed.projectId, seed.projectSlug),
    ),
    rows<ApplicationRow>(
      db.prepare(
        "SELECT id, slug, name, status FROM brvin_applications WHERE id = ? OR slug = ?",
      ).bind(seed.applicationId, seed.applicationSlug),
    ),
    rows<EnvironmentRow>(
      db.prepare(
        "SELECT id, application_id, environment_key, status " +
        "FROM brvin_application_environments WHERE id = ? " +
        "OR (application_id = ? AND environment_key = ? AND status = 'active')",
      ).bind(seed.environmentId, seed.applicationId, seed.environmentKey),
    ),
    rows<GrantRow>(
      db.prepare(
        "SELECT id, application_id, project_id, status " +
        "FROM brvin_application_project_grants WHERE id = ? " +
        "OR (application_id = ? AND project_id = ? AND status = 'active')",
      ).bind(seed.grantId, seed.applicationId, seed.projectId),
    ),
  ]);

  if (
    projects.length !== 1 ||
    projects[0].id !== seed.projectId ||
    projects[0].slug !== seed.projectSlug ||
    projects[0].status !== "active"
  ) {
    throw new Error("BRVIN 2 identity migration requires the existing active Fatman project (id and slug 'fatman').");
  }

  if (
    applications.length > 1 ||
    (applications.length === 1 &&
      (applications[0].id !== seed.applicationId ||
        applications[0].slug !== seed.applicationSlug ||
        applications[0].name !== seed.applicationName ||
        applications[0].status !== "active"))
  ) {
    failConflict("application");
  }

  if (
    environments.length > 1 ||
    (environments.length === 1 &&
      (environments[0].id !== seed.environmentId ||
        environments[0].application_id !== seed.applicationId ||
        environments[0].environment_key !== seed.environmentKey ||
        environments[0].status !== "active"))
  ) {
    failConflict("production environment");
  }

  if (
    grants.length > 1 ||
    (grants.length === 1 &&
      (grants[0].id !== seed.grantId ||
        grants[0].application_id !== seed.applicationId ||
        grants[0].project_id !== seed.projectId ||
        grants[0].status !== "active"))
  ) {
    failConflict("Parmar AI to Fatman grant");
  }
}

async function verifySeededRows(db: D1Database): Promise<void> {
  const seed = BRVIN2_SEED_IDENTITIES;
  const [applications, environments, grants] = await Promise.all([
    rows<ApplicationRow>(
      db.prepare(
        "SELECT id, slug, name, status FROM brvin_applications WHERE id = ? OR slug = ?",
      ).bind(seed.applicationId, seed.applicationSlug),
    ),
    rows<EnvironmentRow>(
      db.prepare(
        "SELECT id, application_id, environment_key, status " +
        "FROM brvin_application_environments WHERE id = ? " +
        "OR (application_id = ? AND environment_key = ? AND status = 'active')",
      ).bind(seed.environmentId, seed.applicationId, seed.environmentKey),
    ),
    rows<GrantRow>(
      db.prepare(
        "SELECT id, application_id, project_id, status " +
        "FROM brvin_application_project_grants WHERE id = ? " +
        "OR (application_id = ? AND project_id = ? AND status = 'active')",
      ).bind(seed.grantId, seed.applicationId, seed.projectId),
    ),
  ]);

  if (
    applications.length !== 1 ||
    applications[0].id !== seed.applicationId ||
    applications[0].slug !== seed.applicationSlug ||
    applications[0].name !== seed.applicationName ||
    applications[0].status !== "active"
  ) {
    failConflict("seeded application");
  }

  if (
    environments.length !== 1 ||
    environments[0].id !== seed.environmentId ||
    environments[0].application_id !== seed.applicationId ||
    environments[0].environment_key !== seed.environmentKey ||
    environments[0].status !== "active"
  ) {
    failConflict("seeded production environment");
  }

  if (
    grants.length !== 1 ||
    grants[0].id !== seed.grantId ||
    grants[0].application_id !== seed.applicationId ||
    grants[0].project_id !== seed.projectId ||
    grants[0].status !== "active"
  ) {
    failConflict("seeded Fatman project grant");
  }

  const foreignKeyCheck = await db.prepare("PRAGMA foreign_key_check").all<Record<string, unknown>>();
  if ((foreignKeyCheck.results ?? []).length > 0) {
    throw new Error("BRVIN 2 identity migration detected a D1 foreign-key violation; the migration marker was not written.");
  }
}

/**
 * Add the one-time Parmar AI production identity and Fatman project grant.
 *
 * This function is intentionally separate from retrieval authorization. It
 * does not change the legacy v1 client mapping, consumer binding props, source
 * grants, or project usage counters. D1 batch() makes the three seed inserts a
 * single transaction; read-back validation precedes the migration marker.
 */
export async function ensureBrvin2ApplicationIdentities(
  db: D1Database,
  now = Date.now(),
): Promise<void> {
  const migration = await db.prepare(
    "SELECT migration_key FROM brvin_migrations WHERE migration_key = ?",
  ).bind(BRVIN2_APPLICATION_MIGRATION_KEY).first<{ migration_key: string }>();

  if (migration) {
    await verifyPreviouslyApplied(db);
    return;
  }

  await preflight(db);

  const seed = BRVIN2_SEED_IDENTITIES;
  const seedResults = await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO brvin_applications " +
      "(id, slug, name, description, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, 'active', ?, ?)",
    ).bind(
      seed.applicationId,
      seed.applicationSlug,
      seed.applicationName,
      "Primary Parmar AI production application.",
      now,
      now,
    ),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_application_environments " +
      "(id, application_id, environment_key, display_name, status, created_at, updated_at) " +
      "SELECT ?, id, ?, ?, 'active', ?, ? FROM brvin_applications " +
      "WHERE id = ? AND slug = ? AND status = 'active'",
    ).bind(
      seed.environmentId,
      seed.environmentKey,
      seed.environmentDisplayName,
      now,
      now,
      seed.applicationId,
      seed.applicationSlug,
    ),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_application_project_grants " +
      "(id, application_id, project_id, status, created_at, created_by) " +
      "SELECT ?, a.id, p.id, 'active', ?, 'migration' " +
      "FROM brvin_applications a JOIN brvin_projects p ON p.id = ? AND p.slug = ? AND p.status = 'active' " +
      "WHERE a.id = ? AND a.slug = ? AND a.status = 'active'",
    ).bind(
      seed.grantId,
      now,
      seed.projectId,
      seed.projectSlug,
      seed.applicationId,
      seed.applicationSlug,
    ),
  ]);
  assertBatchSucceeded(seedResults, "seed");

  await verifySeededRows(db);

  const markerResults = await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO brvin_migrations (migration_key, applied_at) VALUES (?, ?)",
    ).bind(BRVIN2_APPLICATION_MIGRATION_KEY, now),
  ]);
  assertBatchSucceeded(markerResults, "marker");

  const verifiedMarker = await db.prepare(
    "SELECT migration_key FROM brvin_migrations WHERE migration_key = ?",
  ).bind(BRVIN2_APPLICATION_MIGRATION_KEY).first<{ migration_key: string }>();
  if (!verifiedMarker) {
    throw new Error("BRVIN 2 identity migration marker could not be verified after the seed records were committed.");
  }
}
