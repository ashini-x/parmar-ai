import type { Env } from "../config/env";
import { retrieveBrvinForApplicationV2 } from "./service-core";
import { readBrvinCorpusGeneration } from "./corpus-reader";
import { indexBrvinCorpusGeneration } from "./m14-pilot-runner";
import { BRVIN_M14_PHYSICS_PILOT } from "./m14-physics-evaluation";
import { BrvinQdrantHybridPilot } from "./qdrant-hybrid-pilot";
import { BrvinVertexEmbeddingProvider } from "./vertex-embedding";

export const BRVIN_M15_STAGING_SOURCE_ID = "3b4d116d-4c18-450f-9cba-cb2bec3da7ca";
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
export const BRVIN_M15_STAGING_PROJECT_ID = "890f6317-69f4-4391-aae6-556155ed0d12";
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
  "CREATE TABLE IF NOT EXISTS m15_v2_multisource_sources (source_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, generation_id TEXT NOT NULL, source_sha256 TEXT NOT NULL, page_count INTEGER NOT NULL, qdrant_point_count INTEGER NOT NULL DEFAULT 0, qdrant_points_upserted INTEGER NOT NULL DEFAULT 0, qdrant_verified_at INTEGER, ai_search_indexed_pages INTEGER NOT NULL DEFAULT 0, ai_search_items_uploaded INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS m15_v2_multisource_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed')), result_json TEXT, started_at INTEGER NOT NULL, completed_at INTEGER)"
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


const M14_SOURCE_ID = BRVIN_M14_PHYSICS_PILOT.sourceId;
const M14_SOURCE_SHA256 = BRVIN_M14_PHYSICS_PILOT.sourceSha256;
const M14_SOURCE_PAGE_COUNT = BRVIN_M14_PHYSICS_PILOT.pageCount;
const M14_SOURCE_GENERATION_ID = "57129957231e548064e5594d8fb9f501";
const M14_SOURCE_PREFIX = "brvin/books/" + M14_SOURCE_ID + "/pages/";
const M15_MULTI_SOURCE_QUERIES = [
  {
    id: "m14-worked-example",
    query: "Find the worked example with a 4 kg box, a 20 N pull to the right, and 8 N friction to the left. What is the resulting net force and acceleration?",
    expectedSourceId: M14_SOURCE_ID,
    expectedPage: 3
  },
  {
    id: "m15-static-friction",
    query: QUERY,
    expectedSourceId: SOURCE_ID,
    expectedPage: 4
  }
] as const;

type M15MultiSourceState = {
  source_id: string;
  project_id: string;
  generation_id: string;
  source_sha256: string;
  page_count: number;
  qdrant_point_count: number;
  qdrant_points_upserted: number;
  qdrant_verified_at: number | null;
  ai_search_indexed_pages: number;
  ai_search_items_uploaded: number;
  status: string;
};

function multiSourcePageFromItemKey(key: string): { sourceId: string; pdfPage: number } | null {
  const sources = [
    { sourceId: M14_SOURCE_ID, prefix: M14_SOURCE_PREFIX, pageCount: M14_SOURCE_PAGE_COUNT },
    { sourceId: SOURCE_ID, prefix: SOURCE_PREFIX, pageCount: SOURCE_PAGE_COUNT }
  ];
  const source = sources.find((item) => key.startsWith(item.prefix));
  if (!source) return null;
  const match = /^page-(\d{6})\.txt$/u.exec(key.slice(source.prefix.length));
  if (!match) return null;
  const pdfPage = Number(match[1]);
  return Number.isSafeInteger(pdfPage) && pdfPage >= 1 && pdfPage <= source.pageCount
    ? { sourceId: source.sourceId, pdfPage }
    : null;
}

function m15MultiSourceMetadataSchemaMatches(value: unknown): boolean {
  const expected = [
    { field_name: "source_id", data_type: "text" },
    { field_name: "project_id", data_type: "text" },
    { field_name: "pdf_page", data_type: "number" },
    { field_name: "benchmark", data_type: "text" }
  ];
  return Array.isArray(value) && value.length === expected.length &&
    expected.every((field) => value.some((actual) =>
      typeof actual === "object" && actual !== null &&
      (actual as { field_name?: unknown }).field_name === field.field_name &&
      (actual as { data_type?: unknown }).data_type === field.data_type
    ));
}

async function ensureM15MultiSourceAiSearchSchema(env: Env): Promise<void> {
  const search = env.BRVIN_M15_BENCHMARK_AI_SEARCH;
  if (!search) throw new Error("The isolated M15 benchmark AI Search binding is not configured.");
  const info = await search.info();
  if (m15MultiSourceMetadataSchemaMatches(info.custom_metadata)) return;
  if (Array.isArray(info.custom_metadata) && info.custom_metadata.length > 0) {
    throw new Error("The M15 AI Search custom metadata schema is unexpected; refusing to replace it.");
  }
  const updated = await search.update({
    custom_metadata: [
      { field_name: "source_id", data_type: "text" },
      { field_name: "project_id", data_type: "text" },
      { field_name: "pdf_page", data_type: "number" },
      { field_name: "benchmark", data_type: "text" }
    ]
  });
  if (!updated || typeof updated !== "object" ||
      !m15MultiSourceMetadataSchemaMatches((updated as Record<string, unknown>).custom_metadata)) {
    throw new Error("The M15 AI Search instance did not confirm its expected metadata schema.");
  }
}

async function ensureM15MultiSourceRegistry(
  env: Env,
  generationId: string,
): Promise<M15MultiSourceState> {
  const db = assertDb(env);
  const now = Date.now();
  const seeded = await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO brvin_books " +
      "(id,title,source_filename,source_sha256,expected_size,page_count,status,indexed_pages,error_message,collection_id,search_prefix,source_type,created_at,updated_at) " +
      "VALUES (?,?,?,?,0,?,'processing',0,NULL,'m15-staging',?,'pdf',?,?)"
    ).bind(
      M14_SOURCE_ID,
      BRVIN_M14_PHYSICS_PILOT.sourceTitle,
      "Force-and-Laws-of-Motion-Class-IX-pilot-handout.pdf",
      M14_SOURCE_SHA256,
      M14_SOURCE_PAGE_COUNT,
      M14_SOURCE_PREFIX,
      now,
      now
    ),
    db.prepare(
      "INSERT OR IGNORE INTO brvin_project_books (project_id,book_id,created_at,created_by) VALUES (?,?,?,'m15-multisource-staging-fixture')"
    ).bind(PROJECT_ID, M14_SOURCE_ID, now),
    db.prepare(
      "INSERT OR IGNORE INTO m15_v2_multisource_sources " +
      "(source_id,project_id,generation_id,source_sha256,page_count,qdrant_point_count,qdrant_points_upserted,qdrant_verified_at,ai_search_indexed_pages,ai_search_items_uploaded,status,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,0,0,NULL,0,0,'pending',?,?)"
    ).bind(
      M14_SOURCE_ID,
      PROJECT_ID,
      generationId,
      M14_SOURCE_SHA256,
      M14_SOURCE_PAGE_COUNT,
      now,
      now
    )
  ]);
  if (seeded.some((result) => !result.success)) {
    throw new Error("The second M15 staging source could not be registered in isolated D1.");
  }

  const [book, mapping, state] = await Promise.all([
    db.prepare(
      "SELECT id,title,source_sha256,page_count,status,indexed_pages,collection_id,search_prefix " +
      "FROM brvin_books WHERE id=? LIMIT 1"
    ).bind(M14_SOURCE_ID).first<{
      id: string; title: string; source_sha256: string; page_count: number; status: string;
      indexed_pages: number; collection_id: string; search_prefix: string;
    }>(),
    db.prepare(
      "SELECT project_id,book_id FROM brvin_project_books WHERE project_id=? AND book_id=? LIMIT 1"
    ).bind(PROJECT_ID, M14_SOURCE_ID).first<{ project_id: string; book_id: string }>(),
    db.prepare(
      "SELECT source_id,project_id,generation_id,source_sha256,page_count,qdrant_point_count,qdrant_points_upserted,qdrant_verified_at,ai_search_indexed_pages,ai_search_items_uploaded,status " +
      "FROM m15_v2_multisource_sources WHERE source_id=? LIMIT 1"
    ).bind(M14_SOURCE_ID).first<M15MultiSourceState>()
  ]);

  if (!book || book.id !== M14_SOURCE_ID ||
      book.source_sha256?.toLowerCase() !== M14_SOURCE_SHA256 ||
      Number(book.page_count) !== M14_SOURCE_PAGE_COUNT ||
      book.collection_id !== "m15-staging" ||
      book.search_prefix !== M14_SOURCE_PREFIX ||
      (book.status !== "processing" && book.status !== "ready") ||
      !mapping || mapping.project_id !== PROJECT_ID || mapping.book_id !== M14_SOURCE_ID ||
      !state || state.project_id !== PROJECT_ID ||
      state.generation_id !== generationId ||
      state.source_sha256?.toLowerCase() !== M14_SOURCE_SHA256 ||
      Number(state.page_count) !== M14_SOURCE_PAGE_COUNT) {
    throw new Error("The second M15 staging source registry did not match the immutable M14 source identity.");
  }
  return state;
}

async function persistM15MultiSourceReceipt(
  env: Pick<Env, "DB">,
  input: {
    runId: string;
    status: "passed" | "failed";
    result: Record<string, unknown>;
    completedAt: number;
  },
): Promise<void> {
  const db = env.DB;
  if (!db) throw new Error("M15 multi-source staging requires isolated D1.");
  const saved = await db.prepare(
    "UPDATE m15_v2_multisource_runs SET status=?,result_json=?,completed_at=? WHERE id=? AND status='running'"
  ).bind(input.status, JSON.stringify(input.result), input.completedAt, input.runId).run();
  if (!saved.success || Number(saved.meta?.changes ?? 0) !== 1) {
    throw new Error("The M15 multi-source receipt could not be persisted.");
  }
}

/**
 * Indexes the existing immutable three-page M14 corpus into only the isolated
 * M15 provider resources, registers that same source identity in the M15 test
 * project, then exercises both sources through the real Core v2 Qdrant path.
 * It never uploads a PDF or invokes Vision OCR.
 */
export async function runBrvinM15V2MultiSourceCheck(env: Env) {
  if (env.ENVIRONMENT !== "staging" ||
      env.BRVIN_M14_PILOT_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("The M15 multi-source acceptance action is staging-only.");
  }
  if (!env.GCP_PROJECT_ID || !env.GCP_CLIENT_EMAIL || !env.GCP_PRIVATE_KEY ||
      !env.BRVIN_M14_VERTEX_LOCATION || !env.BRVIN_M14_VERTEX_MODEL ||
      !env.BRVIN_M14_EMBEDDING_DIMENSIONS || !env.BRVIN_M14_QDRANT_URL ||
      !env.BRVIN_M14_QDRANT_API_KEY || !env.BRVIN_M15_BENCHMARK_QDRANT_COLLECTION ||
      !env.BRVIN_M15_BENCHMARK_AI_SEARCH) {
    throw new Error("The isolated M15 Vertex/Qdrant/AI Search settings are incomplete.");
  }

  await ensureFixture(env);
  const corpus = await readBrvinCorpusGeneration(env, M14_SOURCE_ID, M14_SOURCE_GENERATION_ID);
  if (corpus.sourceManifest.sourcePdfSha256.toLowerCase() !== M14_SOURCE_SHA256 ||
      corpus.sourceManifest.pageCount !== M14_SOURCE_PAGE_COUNT ||
      corpus.pageManifests.length !== M14_SOURCE_PAGE_COUNT ||
      corpus.chunkCount !== 7) {
    throw new Error("The retained M14 immutable corpus does not match the pinned three-page, seven-chunk source.");
  }
  let state = await ensureM15MultiSourceRegistry(env, corpus.sourceManifest.generationId);

  const pilot = new BrvinQdrantHybridPilot({
    url: env.BRVIN_M14_QDRANT_URL,
    apiKey: env.BRVIN_M14_QDRANT_API_KEY,
    collection: env.BRVIN_M15_BENCHMARK_QDRANT_COLLECTION,
    dimensions: Number(env.BRVIN_M14_EMBEDDING_DIMENSIONS)
  }, new BrvinVertexEmbeddingProvider(env));

  let qdrantPointCount = await pilot.countSourcePoints(PROJECT_ID, M14_SOURCE_ID);
  let qdrantUpsertedPointCount = 0;
  if (!state.qdrant_verified_at || Number(state.qdrant_point_count) !== corpus.chunkCount ||
      qdrantPointCount !== corpus.chunkCount) {
    const indexed = await indexBrvinCorpusGeneration(pilot, PROJECT_ID, corpus);
    qdrantUpsertedPointCount = indexed.pointCount;
    qdrantPointCount = await pilot.countSourcePoints(PROJECT_ID, M14_SOURCE_ID);
    if (indexed.pageCount !== M14_SOURCE_PAGE_COUNT ||
        indexed.chunkCount !== corpus.chunkCount ||
        indexed.pointCount !== corpus.chunkCount ||
        qdrantPointCount !== corpus.chunkCount) {
      throw new Error("Qdrant did not verify all deterministic chunks from the retained M14 corpus.");
    }
    await assertDb(env).prepare(
      "UPDATE m15_v2_multisource_sources SET qdrant_point_count=?,qdrant_points_upserted=qdrant_points_upserted+?,qdrant_verified_at=?,status='qdrant_ready',updated_at=? WHERE source_id=? AND project_id=?"
    ).bind(qdrantPointCount, indexed.pointCount, Date.now(), Date.now(), M14_SOURCE_ID, PROJECT_ID).run();
  }

  await ensureM15MultiSourceAiSearchSchema(env);
  const search = env.BRVIN_M15_BENCHMARK_AI_SEARCH!;
  const initialListing = await search.items.list({ page: 1, per_page: 50 });
  const visibleItems = [...(initialListing.result ?? [])];
  let newlyUploadedAiSearchItems = 0;

  for (const page of [...corpus.pageManifests].sort((left, right) => left.pdfPage - right.pdfPage)) {
    const key = page.stableItemKey;
    if (!key.startsWith(M14_SOURCE_PREFIX)) {
      throw new Error("An immutable M14 page key escaped its pinned source prefix.");
    }
    const existing = visibleItems.find((item) => item.key === key);
    if (existing) {
      if (existing.status === "queued" || existing.status === "running") {
        await assertDb(env).prepare(
          "UPDATE m15_v2_multisource_sources SET status='ai_search_indexing',ai_search_indexed_pages=?,updated_at=? WHERE source_id=?"
        ).bind(visibleItems.filter((item) => item.key.startsWith(M14_SOURCE_PREFIX) && item.status === "completed").length, Date.now(), M14_SOURCE_ID).run();
        return {
          ok: true,
          complete: false,
          status: "ai_search_indexing",
          sourceId: M14_SOURCE_ID,
          qdrantPointCount,
          aiSearchIndexedPages: visibleItems.filter((item) =>
            item.key.startsWith(M14_SOURCE_PREFIX) && item.status === "completed"
          ).length,
          pendingPage: page.pdfPage,
          pendingItemStatus: existing.status,
          message: "Qdrant indexing is verified. The existing AI Search item is still processing; run the same action again after it completes."
        };
      }
      if (existing.status !== "completed") {
        throw new Error("The existing M15 AI Search item for M14 page " + page.pdfPage + " is in terminal status " + existing.status + ".");
      }
      continue;
    }

    const uploaded = await search.items.upload(key, page.rawOcrText, {
      metadata: {
        source_id: M14_SOURCE_ID,
        project_id: PROJECT_ID,
        pdf_page: String(page.pdfPage),
        benchmark: "brvin-m15-multisource-v1"
      }
    });
    if (uploaded.key !== key) {
      throw new Error("AI Search returned a page key that does not match the immutable M14 source manifest.");
    }
    newlyUploadedAiSearchItems += 1;
    if (uploaded.status === "queued" || uploaded.status === "running") {
      await assertDb(env).prepare(
        "UPDATE m15_v2_multisource_sources SET status='ai_search_indexing',ai_search_indexed_pages=?,ai_search_items_uploaded=ai_search_items_uploaded+1,updated_at=? WHERE source_id=?"
      ).bind(visibleItems.filter((item) => item.key.startsWith(M14_SOURCE_PREFIX) && item.status === "completed").length, Date.now(), M14_SOURCE_ID).run();
      return {
        ok: true,
        complete: false,
        status: "ai_search_indexing",
        sourceId: M14_SOURCE_ID,
        qdrantPointCount,
        newlyUploadedAiSearchItems,
        aiSearchIndexedPages: visibleItems.filter((item) =>
          item.key.startsWith(M14_SOURCE_PREFIX) && item.status === "completed"
        ).length,
        pendingPage: page.pdfPage,
        pendingItemStatus: uploaded.status,
        message: "The first missing AI Search page was accepted and is processing. Run the same action again after it completes; deterministic page keys prevent duplicate uploads."
      };
    }
    if (uploaded.status !== "completed") {
      throw new Error("AI Search indexing failed for immutable M14 page " + page.pdfPage + " with status " + uploaded.status + ".");
    }
    const completedBefore = visibleItems.filter((item) =>
      item.key.startsWith(M14_SOURCE_PREFIX) && item.status === "completed"
    ).length;
    await assertDb(env).prepare(
      "UPDATE m15_v2_multisource_sources SET ai_search_indexed_pages=?,ai_search_items_uploaded=ai_search_items_uploaded+1,updated_at=? WHERE source_id=?"
    ).bind(completedBefore + 1, Date.now(), M14_SOURCE_ID).run();
    visibleItems.push(uploaded);
  }

  const finalListing = await search.items.list({ page: 1, per_page: 50 });
  const expectedKeys = new Set(corpus.pageManifests.map((page) => page.stableItemKey));
  const finalM14Items = (finalListing.result ?? []).filter((item) => item.key.startsWith(M14_SOURCE_PREFIX));
  if (finalM14Items.length !== M14_SOURCE_PAGE_COUNT ||
      finalM14Items.some((item) => item.status !== "completed" || !expectedKeys.has(item.key)) ||
      [...expectedKeys].some((key) => !finalM14Items.some((item) => item.key === key))) {
    const completed = finalM14Items.filter((item) => item.status === "completed").length;
    await assertDb(env).prepare(
      "UPDATE m15_v2_multisource_sources SET status='ai_search_indexing',ai_search_indexed_pages=?,updated_at=? WHERE source_id=?"
    ).bind(completed, Date.now(), M14_SOURCE_ID).run();
    return {
      ok: true,
      complete: false,
      status: "ai_search_indexing",
      sourceId: M14_SOURCE_ID,
      qdrantPointCount,
      newlyUploadedAiSearchItems,
      aiSearchIndexedPages: completed,
      message: "AI Search has not confirmed all three immutable M14 page keys as completed. Run the same action again to inspect current status."
    };
  }

  const db = assertDb(env);
  const readyAt = Date.now();
  const completed = await db.batch([
    db.prepare(
      "UPDATE m15_v2_multisource_sources SET ai_search_indexed_pages=?,status='ready',updated_at=? WHERE source_id=? AND project_id=?"
    ).bind(M14_SOURCE_PAGE_COUNT, readyAt, M14_SOURCE_ID, PROJECT_ID),
    db.prepare(
      "UPDATE brvin_books SET status='ready',indexed_pages=?,error_message=NULL,updated_at=? WHERE id=? AND source_sha256=? AND page_count=? AND search_prefix=?"
    ).bind(M14_SOURCE_PAGE_COUNT, readyAt, M14_SOURCE_ID, M14_SOURCE_SHA256, M14_SOURCE_PAGE_COUNT, M14_SOURCE_PREFIX)
  ]);
  if (completed.some((result) => !result.success) ||
      Number(completed[1]?.meta?.changes ?? 0) !== 1) {
    throw new Error("The second M15 D1 source did not transition to READY after both provider indexes verified.");
  }

  const readySources = await db.prepare(
    "SELECT COUNT(DISTINCT b.id) AS source_count FROM brvin_books b " +
    "JOIN brvin_project_books pb ON pb.book_id=b.id AND pb.project_id=? " +
    "WHERE b.status='ready' AND b.indexed_pages=b.page_count"
  ).bind(PROJECT_ID).first<{ source_count: number }>();
  const sourceCount = Number(readySources?.source_count ?? 0);
  if (sourceCount !== 2) {
    throw new Error("The isolated M15 Core v2 project does not resolve exactly two READY source PDFs.");
  }

  await setGrantStatus(env, "active");
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const started = await db.prepare(
    "INSERT INTO m15_v2_multisource_runs (id,status,result_json,started_at,completed_at) VALUES (?,'running',NULL,?,NULL)"
  ).bind(runId, startedAt).run();
  if (!started.success || Number(started.meta?.changes ?? 0) !== 1) {
    throw new Error("The M15 multi-source v2 result receipt could not be initialized.");
  }

  const baseUsage = await queryUsage(env);
  const serviceEnv = { ...env, BRVIN_RETRIEVAL_PROVIDER: "qdrant-vertex" };
  const coreV2Results = await Promise.all(M15_MULTI_SOURCE_QUERIES.map(async (item) => {
    const result = await retrieveBrvinForApplicationV2(serviceEnv, ENVIRONMENT_ID, {
      projectId: PROJECT_ID,
      queries: [item.query],
      requestId: "m15-v2-multisource-" + item.id
    });
    return { item, result };
  }));
  const usageAfterCoreV2 = await queryUsage(env);

  const aiSearchResults = await Promise.all(M15_MULTI_SOURCE_QUERIES.map(async (item) => {
    const response = await search.search({
      messages: [{ role: "user", content: item.query }],
      ai_search_options: {
        cache: { enabled: false },
        retrieval: {
          max_num_results: 16,
          match_threshold: 0.3,
          retrieval_type: "hybrid",
          keyword_match_mode: "or",
          filters: { folder: { $in: [M14_SOURCE_PREFIX, SOURCE_PREFIX] } }
        },
        reranking: { enabled: true, model: "@cf/baai/bge-reranker-base", match_threshold: 0.4 }
      }
    });
    const candidates = (response.chunks ?? []).slice(0, 16).map((chunk) => {
      const key = typeof chunk.item?.key === "string" ? chunk.item.key : "";
      const locator = multiSourcePageFromItemKey(key);
      return locator ? {
        sourceId: locator.sourceId,
        pdfPage: locator.pdfPage,
        score: typeof chunk.score === "number" ? chunk.score : null
      } : { sourceId: null, pdfPage: null, score: typeof chunk.score === "number" ? chunk.score : null };
    });
    return { queryId: item.id, expectedSourceId: item.expectedSourceId, expectedPage: item.expectedPage, candidates };
  }));

  const qdrantEvidence = coreV2Results.map(({ item, result }) => {
    const passages = result.ok ? result.data.passages : [];
    return {
      queryId: item.id,
      ok: result.ok,
      ...(result.ok ? {} : { code: result.code }),
      searchedSources: result.ok ? result.data.searchedSources : 0,
      searchCount: result.ok ? result.data.searchCount : 0,
      passages: passages.map((passage) => ({ sourceId: passage.bookId, pdfPage: passage.pdfPage }))
    };
  });
  const aiSearchEvidence = aiSearchResults.map((result) => ({
    ...result,
    matchedExpectedSourcePage: result.candidates.some((candidate) =>
      candidate.sourceId === result.expectedSourceId && candidate.pdfPage === result.expectedPage
    )
  }));
  const qdrantAllValid = qdrantEvidence.every((result) =>
    result.ok && result.searchedSources === 2 &&
    result.passages.every((passage) =>
      (passage.sourceId === M14_SOURCE_ID && passage.pdfPage >= 1 && passage.pdfPage <= M14_SOURCE_PAGE_COUNT) ||
      (passage.sourceId === SOURCE_ID && passage.pdfPage >= 1 && passage.pdfPage <= SOURCE_PAGE_COUNT)
    )
  );
  const finalState = await db.prepare(
    "SELECT source_id,project_id,generation_id,source_sha256,page_count,qdrant_point_count,qdrant_points_upserted,qdrant_verified_at,ai_search_indexed_pages,ai_search_items_uploaded,status " +
    "FROM m15_v2_multisource_sources WHERE source_id=? LIMIT 1"
  ).bind(M14_SOURCE_ID).first<M15MultiSourceState>();
  if (!finalState || finalState.status !== "ready" ||
      Number(finalState.ai_search_indexed_pages) !== M14_SOURCE_PAGE_COUNT) {
    throw new Error("The second-source indexing progress receipt did not reach READY.");
  }

  const checks = {
    bothSourcesRegisteredAndReadyInD1: sourceCount === 2,
    immutableM14CorpusVerified: corpus.chunkCount === 7 && corpus.pageManifests.length === 3,
    qdrantAllSevenM14PointsPresent: qdrantPointCount === corpus.chunkCount,
    aiSearchAllThreeM14PagesCompleted: finalM14Items.length === M14_SOURCE_PAGE_COUNT &&
      finalM14Items.every((item) => item.status === "completed"),
    coreV2AuthorizedForBothSources: qdrantAllValid &&
      qdrantEvidence.every((result, index) =>
        result.passages.some((passage) =>
          passage.sourceId === M15_MULTI_SOURCE_QUERIES[index].expectedSourceId &&
          passage.pdfPage === M15_MULTI_SOURCE_QUERIES[index].expectedPage
        )
      ),
    aiSearchBaselineFindsBothSourceTargets: aiSearchEvidence.every((result) => result.matchedExpectedSourcePage),
    exactlyTwoAuthorizedQuotaReservations: usageAfterCoreV2 === baseUsage + M15_MULTI_SOURCE_QUERIES.length
  };
  const passed = Object.values(checks).every(Boolean);
  const report = {
    ok: passed,
    complete: true,
    receiptId: runId,
    benchmark: "brvin-m15-two-source-core-v2-hybrid-retrieval",
    environment: "staging",
    projectId: PROJECT_ID,
    sourceCount,
    sources: [
      { sourceId: SOURCE_ID, sourceSha256: SOURCE_SHA256, pageCount: SOURCE_PAGE_COUNT, qdrantPoints: 14, aiSearchPages: SOURCE_PAGE_COUNT },
      { sourceId: M14_SOURCE_ID, sourceSha256: M14_SOURCE_SHA256, pageCount: M14_SOURCE_PAGE_COUNT, generationId: corpus.sourceManifest.generationId, qdrantPoints: qdrantPointCount, aiSearchPages: finalM14Items.length }
    ],
    coreV2Qdrant: qdrantEvidence,
    cloudflareAiSearchBaseline: aiSearchEvidence,
    checks,
    quotaUsage: { before: baseUsage, afterTwoCoreV2Queries: usageAfterCoreV2 },
    sideEffects: {
      qdrantPointsUpsertedOrReplayed: Number(finalState.qdrant_points_upserted ?? qdrantUpsertedPointCount),
      qdrantPointsDeleted: 0,
      aiSearchItemsCreated: Number(finalState.ai_search_items_uploaded ?? newlyUploadedAiSearchItems),
      aiSearchItemsDeleted: 0,
      pdfUploads: 0,
      visionOcrRequests: 0,
      sourceOrOcrArtifactsChanged: false,
      consumerAnswerGenerationCalls: 0,
      productionProviderChanged: false,
      productionD1Accessed: false,
      teachersRuntimeChanged: false
    },
    note: "The existing immutable three-page M14 PDF/OCR/chunk corpus was replayed into only the M15 staging Qdrant collection and separate M15 staging AI Search instance. The real Core v2 service resolver searched both D1-authorized source IDs under one staging project. Query results and locators are recorded without passage text. No production or Teachers resource was accessed."
  };
  await persistM15MultiSourceReceipt(env, {
    runId,
    status: passed ? "passed" : "failed",
    result: report,
    completedAt: Date.now()
  });
  return report;
}
