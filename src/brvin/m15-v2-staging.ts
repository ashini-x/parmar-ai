import type { Env } from "../config/env";
import { retrieveBrvinForApplicationV2 } from "./service-core";
import { BrvinQdrantHybridPilot } from "./qdrant-hybrid-pilot";
import { BrvinVertexEmbeddingProvider } from "./vertex-embedding";

export const BRVIN_M15_STAGING_SOURCE_ID = "3b4d116d-4c18-450f-9cba-cb2bec3da7ca";
export const BRVIN_M15_STAGING_PROJECT_ID = "890f6317-69f4-4391-aae6-556155ed0d12";
const SOURCE_ID = BRVIN_M15_STAGING_SOURCE_ID;
const PROJECT_ID = BRVIN_M15_STAGING_PROJECT_ID;
const SOURCE_SHA256 = "cc20addb908b8bcecc350f252cc4ff64d05147daa6c3f670d91863ce518f9b92";
const SOURCE_PAGE_COUNT = 8;
const SOURCE_PREFIX = "brvin/books/" + SOURCE_ID + "/pages/";

const APPLICATION_ID = "a1500000-0000-4000-8000-000000000001";
export const BRVIN_M15_STAGING_ENVIRONMENT_ID = "a1500000-0000-4000-8000-000000000002";
const ENVIRONMENT_ID = BRVIN_M15_STAGING_ENVIRONMENT_ID;
const GRANT_ID = "a1500000-0000-4000-8000-000000000003";
const APPLICATION_SLUG = "brvin-m15-staging-evaluator";
const APPLICATION_NAME = "BRVIN M15 Staging Evaluator";

const QUERY = "Does static friction always equal μ_s times the normal force, or can it adjust?";

const DDL = [
  `CREATE TABLE IF NOT EXISTS brvin_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    owner_label TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS brvin_books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    source_sha256 TEXT NOT NULL DEFAULT '',
    expected_size INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    indexed_pages INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    collection_id TEXT NOT NULL DEFAULT 'general',
    search_prefix TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'pdf',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS brvin_project_books (
    project_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    PRIMARY KEY(project_id, book_id)
  )`,
  `CREATE TABLE IF NOT EXISTS brvin_project_collections (
    project_id TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    PRIMARY KEY(project_id, collection_id)
  )`,
  `CREATE TABLE IF NOT EXISTS brvin_applications (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_label TEXT NOT NULL DEFAULT '',
    repository_url TEXT NOT NULL DEFAULT '',
    repository_default_branch TEXT NOT NULL DEFAULT 'main',
    runtime_provider TEXT NOT NULL DEFAULT 'cloudflare-workers',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS brvin_application_environments (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    application_id TEXT NOT NULL REFERENCES brvin_applications(id) ON DELETE RESTRICT,
    environment_key TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    worker_name TEXT NOT NULL DEFAULT '',
    worker_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'revoked')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revoked_at INTEGER,
    revoked_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS brvin_application_project_grants (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    application_id TEXT NOT NULL REFERENCES brvin_applications(id) ON DELETE RESTRICT,
    project_id TEXT NOT NULL REFERENCES brvin_projects(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at INTEGER NOT NULL,
    created_by TEXT,
    revoked_at INTEGER,
    revoked_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS brvin_project_search_usage (
    project_id TEXT NOT NULL,
    billing_month TEXT NOT NULL,
    query_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(project_id, billing_month)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_m15_v2_app_env_lookup ON brvin_application_environments(application_id, status, environment_key)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_m15_v2_one_active_environment ON brvin_application_environments(application_id, environment_key) WHERE status = 'active'",
  "CREATE INDEX IF NOT EXISTS idx_m15_v2_grant_lookup ON brvin_application_project_grants(application_id, project_id, status)",
  `CREATE TABLE IF NOT EXISTS m15_v2_authorization_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed')),
    result_json TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS idx_m15_v2_authorization_runs_started ON m15_v2_authorization_runs(started_at DESC)",
];

type M15BenchmarkSourceRow = {
  source_id: string;
  project_id: string;
  title: string;
  source_sha256: string;
  status: string;
  page_count: number;
  indexed_pages: number;
};

type FixtureRow = { id: string; status: string; slug?: string; application_id?: string; project_id?: string; environment_key?: string; search_prefix?: string; source_sha256?: string; indexed_pages?: number; page_count?: number };

function assertDb(env: Env): NonNullable<Env["DB"]> {
  if (!env.DB) throw new Error("M15 v2 staging requires its isolated D1 database.");
  return env.DB;
}

async function ensureFixture(env: Env): Promise<void> {
  const db = assertDb(env);
  const source = await db.prepare(
    "SELECT source_id,project_id,title,source_sha256,status,page_count,indexed_pages " +
    "FROM m15_benchmark_sources WHERE source_id=? LIMIT 1",
  ).bind(SOURCE_ID).first<M15BenchmarkSourceRow>();
  if (!source || source.source_id !== SOURCE_ID || source.project_id !== PROJECT_ID ||
      source.source_sha256?.toLowerCase() !== SOURCE_SHA256 ||
      source.status !== "ready" || Number(source.page_count) !== SOURCE_PAGE_COUNT ||
      Number(source.indexed_pages) !== SOURCE_PAGE_COUNT) {
    throw new Error("The exact M15 source registry row is not ready in isolated staging D1.");
  }

  const ddlResults = await db.batch(DDL.map((sql) => db.prepare(sql)));
  if (ddlResults.some((result) => !result.success)) {
    throw new Error("M15 v2 staging registry schema setup was not fully confirmed by D1.");
  }

  const now = Date.now();
  const seeded = await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO brvin_projects (id,name,slug,description,status,created_at,updated_at) " +
      "VALUES (?,?,?,?,'active',?,?)",
    ).bind(PROJECT_ID, "Physics Benchmark M15", "m15-physics-benchmark",
      "Isolated eight-page source used only for M15 provider and authorization acceptance.", now, now),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_books " +
      "(id,title,source_filename,source_sha256,expected_size,page_count,status,indexed_pages,error_message,collection_id,search_prefix,source_type,created_at,updated_at) " +
      "SELECT source_id,title,file_name,source_sha256,expected_size,page_count,'ready',indexed_pages,NULL,'m15-staging',?,'pdf',?,? " +
      "FROM m15_benchmark_sources WHERE source_id=? AND project_id=? AND status='ready'",
    ).bind(SOURCE_PREFIX, now, now, SOURCE_ID, PROJECT_ID),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_project_books (project_id,book_id,created_at,created_by) VALUES (?,?,?,'m15-staging-fixture')",
    ).bind(PROJECT_ID, SOURCE_ID, now),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_applications (id,slug,name,description,status,created_at,updated_at) " +
      "VALUES (?,?,?,?,'active',?,?)",
    ).bind(APPLICATION_ID, APPLICATION_SLUG, APPLICATION_NAME,
      "Temporary isolated application identity for M15 Core v2 authorization acceptance.", now, now),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_application_environments " +
      "(id,application_id,environment_key,display_name,worker_name,worker_url,status,created_at,updated_at) " +
      "VALUES (?,?,'staging','M15 isolated staging','parmar-ai-m14-staging','', 'active',?,?)",
    ).bind(ENVIRONMENT_ID, APPLICATION_ID, now, now),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_application_project_grants (id,application_id,project_id,status,created_at,created_by) " +
      "VALUES (?,?,?,'active',?,'m15-staging-fixture')",
    ).bind(GRANT_ID, APPLICATION_ID, PROJECT_ID, now),
  ]);
  if (seeded.some((result) => !result.success)) {
    throw new Error("M15 v2 isolated D1 identity/source fixture could not be seeded.");
  }

  const [project, book, projectBook, app, environment, grant] = await Promise.all([
    db.prepare("SELECT id,slug,status FROM brvin_projects WHERE id=?").bind(PROJECT_ID).first<FixtureRow>(),
    db.prepare("SELECT id,status,search_prefix,source_sha256,indexed_pages,page_count FROM brvin_books WHERE id=?").bind(SOURCE_ID).first<FixtureRow>(),
    db.prepare("SELECT project_id,book_id FROM brvin_project_books WHERE project_id=? AND book_id=?").bind(PROJECT_ID,SOURCE_ID).first<{project_id:string;book_id:string}>(),
    db.prepare("SELECT id,slug,status FROM brvin_applications WHERE id=?").bind(APPLICATION_ID).first<FixtureRow>(),
    db.prepare("SELECT id,application_id,environment_key,status FROM brvin_application_environments WHERE id=?").bind(ENVIRONMENT_ID).first<FixtureRow>(),
    db.prepare("SELECT id,application_id,project_id,status FROM brvin_application_project_grants WHERE id=?").bind(GRANT_ID).first<FixtureRow>(),
  ]);
  if (!project || project.slug !== "m15-physics-benchmark" || project.status !== "active" ||
      !book || book.status !== "ready" || book.search_prefix !== SOURCE_PREFIX ||
      book.source_sha256?.toLowerCase() !== SOURCE_SHA256 ||
      Number(book.indexed_pages) !== SOURCE_PAGE_COUNT || Number(book.page_count) !== SOURCE_PAGE_COUNT ||
      !projectBook || projectBook.project_id !== PROJECT_ID || projectBook.book_id !== SOURCE_ID ||
      !app || app.slug !== APPLICATION_SLUG || app.status !== "active" ||
      !environment || environment.application_id !== APPLICATION_ID ||
      environment.environment_key !== "staging" || environment.status !== "active" ||
      !grant || grant.application_id !== APPLICATION_ID || grant.project_id !== PROJECT_ID ||
      (grant.status !== "active" && grant.status !== "revoked")) {
    throw new Error("M15 staging identity or source fixture read-back did not match its fixed expected values.");
  }
}

async function setGrantStatus(env: Env, status: "active" | "revoked"): Promise<void> {
  const db = assertDb(env);
  const result = await db.prepare(
    "UPDATE brvin_application_project_grants SET status=?,revoked_at=?,revoked_by=? " +
    "WHERE id=? AND application_id=? AND project_id=?",
  ).bind(status, status === "revoked" ? Date.now() : null,
    status === "revoked" ? "m15-v2-authorization-check" : null,
    GRANT_ID, APPLICATION_ID, PROJECT_ID).run();
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
    throw new Error("M15 staging project grant status change could not be confirmed.");
  }
}

export async function persistM15V2AuthorizationReceipt(
  env: Pick<Env, "DB">,
  input: {
    runId: string;
    status: "passed" | "failed";
    result: Record<string, unknown>;
    completedAt: number;
  },
): Promise<void> {
  const db = env.DB;
  if (!db) throw new Error("M15 v2 staging requires its isolated D1 database.");
  const persisted = await db.prepare(
    "UPDATE m15_v2_authorization_runs SET status=?,result_json=?,completed_at=? WHERE id=? AND status='running'",
  ).bind(input.status, JSON.stringify(input.result), input.completedAt, input.runId).run();
  if (!persisted.success || Number(persisted.meta?.changes ?? 0) !== 1) {
    throw new Error("M15 v2 authorization result could not be persisted to isolated staging D1.");
  }
}

async function queryUsage(env: Env): Promise<number> {
  const db = assertDb(env);
  const month = new Date().toISOString().slice(0, 7);
  const row = await db.prepare(
    "SELECT query_count FROM brvin_project_search_usage WHERE project_id=? AND billing_month=?",
  ).bind(PROJECT_ID, month).first<{ query_count: number }>();
  return Number(row?.query_count ?? 0);
}

/**
 * Exercise the real Core v2 service resolver and D1 grant checks with the
 * isolated M15 Qdrant collection. No corpus writes/deletes are performed.
 */
export async function runBrvinM15V2AuthorizationCheck(env: Env) {
  if (env.ENVIRONMENT !== "staging" ||
      env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("The Core v2 Qdrant acceptance check is staging-only.");
  }
  if (!env.GCP_PROJECT_ID || !env.GCP_CLIENT_EMAIL || !env.GCP_PRIVATE_KEY ||
      !env.BRVIN_M14_VERTEX_LOCATION || !env.BRVIN_M14_VERTEX_MODEL ||
      !env.BRVIN_M14_EMBEDDING_DIMENSIONS || !env.BRVIN_M14_QDRANT_URL ||
      !env.BRVIN_M14_QDRANT_API_KEY || !env.BRVIN_M15_BENCHMARK_QDRANT_COLLECTION) {
    throw new Error("The isolated M15 Vertex/Qdrant provider settings are incomplete.");
  }

  await ensureFixture(env);
  await setGrantStatus(env, "active");

  // Persist a staging-only receipt so operators do not need to copy the JSON
  // response. The receipt contains test outcomes, never credentials or passage text.
  const runId = crypto.randomUUID();
  const db = assertDb(env);
  const startedAt = Date.now();
  const started = await db.prepare(
    "INSERT INTO m15_v2_authorization_runs (id,status,result_json,started_at,completed_at) VALUES (?,'running',NULL,?,NULL)",
  ).bind(runId, startedAt).run();
  if (!started.success || Number(started.meta?.changes ?? 0) !== 1) {
    throw new Error("M15 v2 authorization run receipt could not be initialized.");
  }

  const serviceEnv = { ...env, BRVIN_RETRIEVAL_PROVIDER: "qdrant-vertex" };
  const baseUsage = await queryUsage(env);
  const authorized = await retrieveBrvinForApplicationV2(serviceEnv, ENVIRONMENT_ID, {
    projectId: PROJECT_ID,
    queries: [QUERY],
    requestId: "m15-v2-authorized-retrieval",
  });
  const usageAfterAuthorized = await queryUsage(env);

  const wrongProject = await retrieveBrvinForApplicationV2(serviceEnv, ENVIRONMENT_ID, {
    projectId: "m15-project-without-a-grant",
    queries: [QUERY],
    requestId: "m15-v2-wrong-project",
  });
  const usageAfterWrongProject = await queryUsage(env);

  let revoked: Awaited<ReturnType<typeof retrieveBrvinForApplicationV2>> | null = null;
  let retainedPoints = 0;
  let usageAfterRevocation = 0;
  let grantRestored = false;
  try {
    await setGrantStatus(env, "revoked");
    revoked = await retrieveBrvinForApplicationV2(serviceEnv, ENVIRONMENT_ID, {
      projectId: PROJECT_ID,
      queries: [QUERY],
      requestId: "m15-v2-revoked-project-grant",
    });
    usageAfterRevocation = await queryUsage(env);

    const countPilot = new BrvinQdrantHybridPilot({
      url: env.BRVIN_M14_QDRANT_URL,
      apiKey: env.BRVIN_M14_QDRANT_API_KEY,
      collection: env.BRVIN_M15_BENCHMARK_QDRANT_COLLECTION,
      dimensions: Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS),
    }, new BrvinVertexEmbeddingProvider(env));
    retainedPoints = await countPilot.countSourcePoints(PROJECT_ID, SOURCE_ID);
  } finally {
    await setGrantStatus(env, "active");
    grantRestored = true;
  }

  const authorizedData = authorized.ok ? authorized.data : null;
  const authorizedPassagePages = authorizedData?.passages.map((passage) => passage.pdfPage) ?? [];
  const authorizedPassageCount = authorizedData?.passages.length ?? 0;
  const authorizedSourceIds = authorizedData?.passages.map((passage) => passage.bookId) ?? [];
  const checks = {
    authorizedV2RetrievalSucceeded: Boolean(authorized.ok && authorizedPassageCount > 0),
    authorizedSourceAndProjectProvenance: Boolean(
      authorizedData && authorizedData.passages.every((passage) =>
        passage.bookId === SOURCE_ID && passage.pdfPage >= 1 && passage.pdfPage <= SOURCE_PAGE_COUNT,
      ),
    ),
    expectedPageFourReturned: authorizedPassagePages.includes(4),
    unknownProjectDeniedBeforeQuota: !wrongProject.ok &&
      wrongProject.code === "PROJECT_NOT_AUTHORIZED" &&
      usageAfterWrongProject === usageAfterAuthorized,
    revokedGrantDeniedBeforeQuota: Boolean(revoked && !revoked.ok &&
      revoked.code === "PROJECT_NOT_AUTHORIZED" &&
      usageAfterRevocation === usageAfterAuthorized),
    vectorsRetainedAfterGrantRevocation: retainedPoints > 0,
    stagingGrantRestored: grantRestored,
    exactlyOneAuthorizedQuotaReservation: usageAfterAuthorized === baseUsage + 1,
  };
  const passed = Object.values(checks).every(Boolean);

  const report = {
    ok: passed,
    receiptId: runId,
    benchmark: "brvin-m15-core-v2-qdrant-authorization",
    environment: "staging",
    provider: "qdrant-vertex",
    applicationId: APPLICATION_ID,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    sourceId: SOURCE_ID,
    sourceSha256: SOURCE_SHA256,
    sourcePageCount: SOURCE_PAGE_COUNT,
    query: QUERY,
    authorizedRetrieval: {
      ok: authorized.ok,
      ...(authorized.ok ? {} : { code: authorized.code, message: authorized.message }),
      passageCount: authorizedPassageCount,
      passagePages: authorizedPassagePages,
      distinctSourceIds: [...new Set(authorizedSourceIds)],
      searchedSources: authorizedData?.searchedSources ?? 0,
      searchCount: authorizedData?.searchCount ?? 0,
    },
    wrongProject: {
      denied: !wrongProject.ok && wrongProject.code === "PROJECT_NOT_AUTHORIZED",
      code: wrongProject.ok ? "unexpected_success" : wrongProject.code,
    },
    revokedGrant: {
      denied: Boolean(revoked && !revoked.ok && revoked.code === "PROJECT_NOT_AUTHORIZED"),
      code: revoked?.ok ? "unexpected_success" : revoked?.code ?? "not_run",
      qdrantPointsStillPresent: retainedPoints,
    },
    quotaUsage: {
      before: baseUsage,
      afterAuthorized: usageAfterAuthorized,
      afterWrongProject: usageAfterWrongProject,
      afterRevocation: usageAfterRevocation,
    },
    checks,
    sideEffects: {
      qdrantPointsUpserted: 0,
      qdrantPointsDeleted: 0,
      sourceOrOcrChanged: false,
      productionProviderChanged: false,
      productionD1Accessed: false,
    },
    note: "This invokes the real Core v2 service authorization, D1 source registry, project quota and Qdrant hybrid query path against the isolated M15 staging database/collection. The application/environment/project/grant fixture and one project quota counter are staging-only. The temporary staging grant is restored active in a finally block. Qdrant indexing and deletion remain disabled.",
  };
  await persistM15V2AuthorizationReceipt(env, {
    runId,
    status: report.ok ? "passed" : "failed",
    result: report,
    completedAt: Date.now(),
  });
  return report;
}
