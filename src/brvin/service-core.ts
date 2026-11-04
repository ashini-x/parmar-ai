import type {
  Env,
  BrvinServiceFailure,
  BrvinServiceRetrievalResult,
  BrvinServiceStatusResult,
  BrvinAuthorizedProject,
  BrvinV2Failure,
  BrvinV2FailureCode,
  BrvinV2Result,
  BrvinV2RetrievalData,
} from "../config/env";
import { logger } from "../core/logger";
import {
  BrvinRetrievalError,
  getBrvinProjectSources,
  retrieveBrvinProjectContextForProject,
  type BrvinProjectIdentity,
} from "./retrieval";

export type BrvinServiceEnv = Pick<
  Env,
  | "DB"
  | "BRVIN_SEARCH"
  | "BRVIN_SEARCH_INSTANCE"
  | "BRVIN_MIN_SCORE"
  | "BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT"
>;

const DEFAULT_MONTHLY_QUERY_LIMIT = 800;
const MAX_MONTHLY_QUERY_LIMIT = 800;

function failure(
  code: string,
  message: string,
  retryable: boolean,
  userMessage?: string,
): BrvinServiceFailure {
  return { ok: false, code, message, retryable, ...(userMessage ? { userMessage } : {}) };
}

function normalizedClientId(value: unknown): string {
  if (typeof value !== "string") return "";
  const clientId = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/u.test(clientId) ? clientId : "";
}

function queryLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(MAX_MONTHLY_QUERY_LIMIT, parsed)
    : DEFAULT_MONTHLY_QUERY_LIMIT;
}

async function resolveProjectForClient(
  env: BrvinServiceEnv,
  rawClientId: unknown,
): Promise<{ clientId: string; project: BrvinProjectIdentity } | null> {
  if (!env.DB) throw new Error("BRVIN database is not configured.");
  const clientId = normalizedClientId(rawClientId);
  if (!clientId) return null;
  const project = await env.DB.prepare(
    "SELECT p.id,p.name,p.slug FROM brvin_service_clients sc " +
    "JOIN brvin_projects p ON p.id=sc.project_id " +
    "WHERE sc.client_id=? AND p.status='active' LIMIT 1",
  ).bind(clientId).first<BrvinProjectIdentity>();
  return project ? { clientId, project } : null;
}

async function reserveProjectQuery(
  env: BrvinServiceEnv,
  project: BrvinProjectIdentity,
): Promise<{ allowed: boolean; queryCount: number }> {
  if (!env.DB) return { allowed: false, queryCount: 0 };
  const now = Date.now();
  const month = new Date(now).toISOString().slice(0, 7);
  const fatman = project.slug === "fatman";
  const monthlyLimit = queryLimit(env.BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT);

  const reserved = fatman
    ? await env.DB.prepare(
        "INSERT INTO fatman_search_usage (billing_month,query_count,updated_at) VALUES (?,1,?) " +
        "ON CONFLICT(billing_month) DO UPDATE SET query_count=query_count+1,updated_at=excluded.updated_at " +
        "WHERE query_count < ? RETURNING query_count",
      ).bind(month, now, monthlyLimit).first<{ query_count: number }>()
    : await env.DB.prepare(
        "INSERT INTO brvin_project_search_usage (project_id,billing_month,query_count,updated_at) VALUES (?,?,1,?) " +
        "ON CONFLICT(project_id,billing_month) DO UPDATE SET query_count=query_count+1,updated_at=excluded.updated_at " +
        "WHERE query_count < ? RETURNING query_count",
      ).bind(project.id, month, now, monthlyLimit).first<{ query_count: number }>();

  if (reserved) return { allowed: true, queryCount: Number(reserved.query_count) };

  const existing = fatman
    ? await env.DB.prepare(
        "SELECT query_count FROM fatman_search_usage WHERE billing_month=?",
      ).bind(month).first<{ query_count: number }>()
    : await env.DB.prepare(
        "SELECT query_count FROM brvin_project_search_usage WHERE project_id=? AND billing_month=?",
      ).bind(project.id, month).first<{ query_count: number }>();

  return {
    allowed: false,
    queryCount: Number(existing?.query_count ?? monthlyLimit),
  };
}

export async function getBrvinProjectStatusForClient(
  env: BrvinServiceEnv,
  clientId: string,
): Promise<BrvinServiceStatusResult> {
  try {
    const resolved = await resolveProjectForClient(env, clientId);
    if (!resolved) return failure("CLIENT_NOT_REGISTERED", "BRVIN application is not registered.", false);
    const sources = await getBrvinProjectSources(env, resolved.project.id);
    return {
      ok: true,
      ready: sources.length > 0,
      authorizedSourceCount: sources.length,
    };
  } catch {
    return failure("BRVIN_UNAVAILABLE", "BRVIN is temporarily unavailable.", true);
  }
}

export async function retrieveBrvinForClient(
  env: BrvinServiceEnv,
  clientId: string,
  input: { queries?: unknown; pageNumbers?: unknown },
): Promise<BrvinServiceRetrievalResult> {
  try {
    if (!input || (input.queries !== undefined && !Array.isArray(input.queries))) {
      return failure("INVALID_REQUEST", "A list of search queries is required.", false);
    }
    const queries = [...new Set(
      (Array.isArray(input.queries) ? input.queries : [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/\u0000/gu, "").replace(/\s+/gu, " ").trim().slice(0, 2_000))
        .filter(Boolean),
    )].slice(0, 3);
    const pageNumbers = [...new Set(
      (Array.isArray(input.pageNumbers) ? input.pageNumbers : [])
        .filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100_000),
    )].slice(0, 3);
    if (!queries.length && !pageNumbers.length) {
      return failure("INVALID_REQUEST", "A non-empty search query or a valid PDF page number is required.", false);
    }

    const resolved = await resolveProjectForClient(env, clientId);
    if (!resolved) return failure("CLIENT_NOT_REGISTERED", "BRVIN application is not registered.", false);

    const sources = await getBrvinProjectSources(env, resolved.project.id);
    if (!sources.length) {
      return { ok: true, passages: [], searchedSources: 0, searchCount: 0 };
    }

    const quota = await reserveProjectQuery(env, resolved.project);
    if (!quota.allowed) {
      const userMessage = resolved.project.slug === "fatman"
        ? "Fatman search has reached this month's free usage limit. Use /help to return to usual study mode."
        : "This project's monthly BRVIN search allowance has been reached.";
      return failure("MONTHLY_LIMIT_REACHED", "The project's monthly BRVIN search allowance has been reached.", false, userMessage);
    }

    const context = await retrieveBrvinProjectContextForProject(
      env,
      resolved.project,
      queries,
      sources,
      pageNumbers,
    );
    return {
      ok: true,
      passages: context.passages,
      ...(context.pageImages?.length ? { pageImages: context.pageImages } : {}),
      searchedSources: context.searchedSources,
      searchCount: context.searchCount,
    };
  } catch (error) {
    if (error instanceof BrvinRetrievalError) {
      return failure(
        "RETRIEVAL_FAILED",
        error.retryable ? "BRVIN retrieval is temporarily unavailable." : "BRVIN could not complete this retrieval.",
        error.retryable,
      );
    }
    return failure("BRVIN_UNAVAILABLE", "BRVIN is temporarily unavailable.", true);
  }
}


type BrvinV2Caller = {
  applicationId: string;
  applicationSlug: string;
  environmentId: string;
  environmentKey: string;
};

type BrvinV2Project = BrvinProjectIdentity & {
  description: string;
  status: string;
};

type BrvinV2IdentityRow = {
  environment_id: string;
  application_id: string | null;
  environment_key: string;
  environment_status: string;
  resolved_application_id: string | null;
  application_slug: string | null;
  application_status: string | null;
};

type BrvinV2ParsedRetrievalInput = {
  projectId: string;
  queries: string[];
  pageNumbers: number[];
  requestId?: string;
};

type BrvinV2Resolution<T> =
  | { ok: true; value: T }
  | { ok: false; failure: BrvinV2Failure };

const BRVIN_V2_ENVIRONMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const BRVIN_V2_MAX_PROJECT_ID_LENGTH = 128;
const BRVIN_V2_MAX_REQUEST_ID_LENGTH = 128;

function v2Failure(
  code: BrvinV2FailureCode,
  message: string,
  retryable = false,
  userMessage?: string,
  requestId?: string,
): BrvinV2Failure {
  return {
    ok: false,
    code,
    message,
    retryable,
    ...(userMessage ? { userMessage } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function validBrvinV2ProjectId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= BRVIN_V2_MAX_PROJECT_ID_LENGTH &&
    value.trim() === value &&
    !value.includes("\u0000");
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBrvinV2StatusInput(value: unknown): { projectId: string } | null {
  if (!plainRecord(value) || !validBrvinV2ProjectId(value.projectId)) return null;
  return { projectId: value.projectId };
}

function parseBrvinV2RetrievalInput(value: unknown): BrvinV2ParsedRetrievalInput | null {
  if (!plainRecord(value) || !validBrvinV2ProjectId(value.projectId)) return null;
  if (!Array.isArray(value.queries)) return null;
  if (value.pageNumbers !== undefined && !Array.isArray(value.pageNumbers)) return null;

  const queries: string[] = [];
  for (const rawQuery of value.queries) {
    if (typeof rawQuery !== "string" || rawQuery.includes("\u0000")) return null;
    const query = rawQuery.replace(/\s+/gu, " ").trim();
    if (query.length > 2_000) return null;
    if (query && !queries.includes(query)) queries.push(query);
  }
  if (queries.length > 3) return null;

  const pageNumbers: number[] = [];
  for (const rawPage of (value.pageNumbers ?? []) as unknown[]) {
    if (
      typeof rawPage !== "number" ||
      !Number.isSafeInteger(rawPage) ||
      rawPage < 1 ||
      rawPage > 100_000
    ) return null;
    if (!pageNumbers.includes(rawPage)) pageNumbers.push(rawPage);
  }
  if (pageNumbers.length > 3 || (!queries.length && !pageNumbers.length)) return null;

  let requestId: string | undefined;
  if (value.requestId !== undefined) {
    if (
      typeof value.requestId !== "string" ||
      value.requestId.length < 1 ||
      value.requestId.length > BRVIN_V2_MAX_REQUEST_ID_LENGTH ||
      value.requestId.trim() !== value.requestId ||
      /[\u0000-\u001f\u007f]/u.test(value.requestId)
    ) return null;
    requestId = value.requestId;
  }

  return { projectId: value.projectId, queries, pageNumbers, ...(requestId ? { requestId } : {}) };
}

async function resolveBrvinV2Caller(
  env: BrvinServiceEnv,
  rawEnvironmentId: unknown,
): Promise<BrvinV2Resolution<BrvinV2Caller>> {
  if (!env.DB) throw new Error("BRVIN database is not configured.");
  if (typeof rawEnvironmentId !== "string" || !BRVIN_V2_ENVIRONMENT_ID.test(rawEnvironmentId)) {
    return {
      ok: false,
      failure: v2Failure("ENVIRONMENT_NOT_REGISTERED", "The BRVIN application environment is not registered."),
    };
  }

  const row = await env.DB.prepare(
    "SELECT e.id AS environment_id,e.application_id,e.environment_key,e.status AS environment_status," +
    "a.id AS resolved_application_id,a.slug AS application_slug,a.status AS application_status " +
    "FROM brvin_application_environments e " +
    "LEFT JOIN brvin_applications a ON a.id=e.application_id " +
    "WHERE e.id=? LIMIT 1",
  ).bind(rawEnvironmentId).first<BrvinV2IdentityRow>();

  if (!row) {
    return {
      ok: false,
      failure: v2Failure("ENVIRONMENT_NOT_REGISTERED", "The BRVIN application environment is not registered."),
    };
  }
  if (!row.resolved_application_id || !row.application_slug || !row.application_status) {
    return {
      ok: false,
      failure: v2Failure("APPLICATION_NOT_REGISTERED", "The BRVIN application is not registered."),
    };
  }
  if (row.application_status !== "active") {
    return {
      ok: false,
      failure: v2Failure("APPLICATION_INACTIVE", "The BRVIN application is inactive."),
    };
  }
  if (row.environment_status !== "active") {
    return {
      ok: false,
      failure: v2Failure("ENVIRONMENT_INACTIVE", "The BRVIN application environment is inactive."),
    };
  }

  return {
    ok: true,
    value: {
      applicationId: row.resolved_application_id,
      applicationSlug: row.application_slug,
      environmentId: row.environment_id,
      environmentKey: row.environment_key,
    },
  };
}

async function resolveBrvinV2AuthorizedProject(
  env: BrvinServiceEnv,
  applicationId: string,
  projectId: string,
): Promise<BrvinV2Resolution<BrvinV2Project>> {
  if (!env.DB) throw new Error("BRVIN database is not configured.");
  const project = await env.DB.prepare(
    "SELECT p.id,p.name,p.slug,p.description,p.status " +
    "FROM brvin_application_project_grants g " +
    "JOIN brvin_projects p ON p.id=g.project_id " +
    "WHERE g.application_id=? AND g.project_id=? AND g.status='active' LIMIT 1",
  ).bind(applicationId, projectId).first<BrvinV2Project>();

  if (!project) {
    // Keep unknown projects and missing/revoked grants indistinguishable.
    return {
      ok: false,
      failure: v2Failure("PROJECT_NOT_AUTHORIZED", "This application is not authorised to access the requested BRVIN project."),
    };
  }
  if (project.status !== "active") {
    return {
      ok: false,
      failure: v2Failure("PROJECT_INACTIVE", "The requested BRVIN project is inactive."),
    };
  }
  return { ok: true, value: project };
}

function logBrvinV2Result<T>(
  method: string,
  startedAt: number,
  result: BrvinV2Result<T>,
  context: {
    caller?: BrvinV2Caller;
    projectId?: string;
    queryCount?: number;
    sourceCount?: number;
    requestId?: string;
  } = {},
): BrvinV2Result<T> {
  const details = {
    requestId: context.requestId ?? crypto.randomUUID(),
    method,
    applicationId: context.caller?.applicationId,
    environmentId: context.caller?.environmentId,
    environmentKey: context.caller?.environmentKey,
    projectId: context.projectId,
    outcome: result.ok ? "success" : result.code,
    queryCount: context.queryCount ?? 0,
    sourceCount: context.sourceCount ?? 0,
    latencyMs: Date.now() - startedAt,
  };
  if (result.ok) logger.info("brvin_v2_rpc_completed", details);
  else logger.warn("brvin_v2_rpc_denied_or_failed", details);
  return result;
}

function logBrvinV2Unavailable<T>(
  method: string,
  startedAt: number,
  requestId?: string,
): BrvinV2Result<T> {
  return logBrvinV2Result(
    method,
    startedAt,
    v2Failure("BRVIN_UNAVAILABLE", "BRVIN is temporarily unavailable.", true, undefined, requestId),
    { requestId },
  );
}

export async function listAuthorizedProjectsV2(
  env: BrvinServiceEnv,
  applicationEnvironmentId: string,
): Promise<BrvinV2Result<BrvinAuthorizedProject[]>> {
  const startedAt = Date.now();
  let caller: BrvinV2Caller | undefined;
  try {
    const callerResult = await resolveBrvinV2Caller(env, applicationEnvironmentId);
    if (!callerResult.ok) {
      return logBrvinV2Result("listAuthorizedProjectsV2", startedAt, callerResult.failure);
    }
    caller = callerResult.value;
    if (!env.DB) throw new Error("BRVIN database is not configured.");

    const projects = await env.DB.prepare(
      "SELECT p.id,p.name,p.slug,p.description,p.status " +
      "FROM brvin_application_project_grants g " +
      "JOIN brvin_projects p ON p.id=g.project_id " +
      "WHERE g.application_id=? AND g.status='active' AND p.status='active' " +
      "ORDER BY p.name COLLATE NOCASE ASC,p.id ASC",
    ).bind(caller.applicationId).all<BrvinV2Project>();

    const data: BrvinAuthorizedProject[] = await Promise.all(
      (projects.results ?? []).map(async (project) => {
        const sources = await getBrvinProjectSources(env, project.id);
        return {
          projectId: project.id,
          slug: project.slug,
          name: project.name,
          description: project.description,
          ready: sources.length > 0,
          authorizedSourceCount: sources.length,
        };
      }),
    );
    return logBrvinV2Result(
      "listAuthorizedProjectsV2",
      startedAt,
      { ok: true, data },
      { caller, sourceCount: data.reduce((total, project) => total + project.authorizedSourceCount, 0) },
    );
  } catch {
    return logBrvinV2Unavailable("listAuthorizedProjectsV2", startedAt);
  }
}

export async function getBrvinProjectStatusV2(
  env: BrvinServiceEnv,
  applicationEnvironmentId: string,
  input: unknown,
): Promise<BrvinV2Result<{
  projectId: string;
  ready: boolean;
  authorizedSourceCount: number;
}>> {
  const startedAt = Date.now();
  const parsed = parseBrvinV2StatusInput(input);
  if (!parsed) {
    return logBrvinV2Result(
      "getProjectStatusV2",
      startedAt,
      v2Failure("INVALID_REQUEST", "A valid BRVIN project identifier is required."),
    );
  }

  let caller: BrvinV2Caller | undefined;
  try {
    const callerResult = await resolveBrvinV2Caller(env, applicationEnvironmentId);
    if (!callerResult.ok) {
      return logBrvinV2Result("getProjectStatusV2", startedAt, callerResult.failure, { projectId: parsed.projectId });
    }
    caller = callerResult.value;

    const projectResult = await resolveBrvinV2AuthorizedProject(env, caller.applicationId, parsed.projectId);
    if (!projectResult.ok) {
      return logBrvinV2Result("getProjectStatusV2", startedAt, projectResult.failure, {
        caller, projectId: parsed.projectId,
      });
    }

    const sources = await getBrvinProjectSources(env, projectResult.value.id);
    return logBrvinV2Result(
      "getProjectStatusV2",
      startedAt,
      {
        ok: true,
        data: {
          projectId: projectResult.value.id,
          ready: sources.length > 0,
          authorizedSourceCount: sources.length,
        },
      },
      { caller, projectId: parsed.projectId, sourceCount: sources.length },
    );
  } catch {
    return logBrvinV2Unavailable("getProjectStatusV2", startedAt);
  }
}

export async function retrieveBrvinForApplicationV2(
  env: BrvinServiceEnv,
  applicationEnvironmentId: string,
  input: unknown,
): Promise<BrvinV2Result<BrvinV2RetrievalData>> {
  const startedAt = Date.now();
  const parsed = parseBrvinV2RetrievalInput(input);
  if (!parsed) {
    return logBrvinV2Result(
      "retrieveProjectContextV2",
      startedAt,
      v2Failure("INVALID_REQUEST", "A valid project identifier and at least one bounded query or page number are required."),
    );
  }

  let caller: BrvinV2Caller | undefined;
  try {
    const callerResult = await resolveBrvinV2Caller(env, applicationEnvironmentId);
    if (!callerResult.ok) {
      return logBrvinV2Result("retrieveProjectContextV2", startedAt, {
        ...callerResult.failure,
        ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
      }, { projectId: parsed.projectId, requestId: parsed.requestId });
    }
    caller = callerResult.value;

    const projectResult = await resolveBrvinV2AuthorizedProject(env, caller.applicationId, parsed.projectId);
    if (!projectResult.ok) {
      return logBrvinV2Result("retrieveProjectContextV2", startedAt, {
        ...projectResult.failure,
        ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
      }, { caller, projectId: parsed.projectId, queryCount: parsed.queries.length, requestId: parsed.requestId });
    }

    const sources = await getBrvinProjectSources(env, projectResult.value.id);
    if (!sources.length) {
      return logBrvinV2Result(
        "retrieveProjectContextV2",
        startedAt,
        { ok: true, data: { passages: [], searchedSources: 0, searchCount: 0 } },
        { caller, projectId: parsed.projectId, queryCount: parsed.queries.length, sourceCount: 0, requestId: parsed.requestId },
      );
    }

    const quota = await reserveProjectQuery(env, projectResult.value);
    if (!quota.allowed) {
      const userMessage = projectResult.value.slug === "fatman"
        ? "Fatman search has reached this month's free usage limit. Use /help to return to usual study mode."
        : "This project's monthly BRVIN search allowance has been reached.";
      return logBrvinV2Result(
        "retrieveProjectContextV2",
        startedAt,
        v2Failure("MONTHLY_LIMIT_REACHED", "The project's monthly BRVIN search allowance has been reached.", false, userMessage, parsed.requestId),
        { caller, projectId: parsed.projectId, queryCount: parsed.queries.length, sourceCount: sources.length, requestId: parsed.requestId },
      );
    }

    const context = await retrieveBrvinProjectContextForProject(
      env,
      projectResult.value,
      parsed.queries,
      sources,
      parsed.pageNumbers,
    );
    return logBrvinV2Result(
      "retrieveProjectContextV2",
      startedAt,
      {
        ok: true,
        data: {
          passages: context.passages,
          ...(context.pageImages?.length ? { pageImages: context.pageImages } : {}),
          searchedSources: context.searchedSources,
          searchCount: context.searchCount,
        },
      },
      { caller, projectId: parsed.projectId, queryCount: parsed.queries.length, sourceCount: sources.length, requestId: parsed.requestId },
    );
  } catch (error) {
    if (error instanceof BrvinRetrievalError) {
      return logBrvinV2Result(
        "retrieveProjectContextV2",
        startedAt,
        v2Failure(
          "RETRIEVAL_FAILED",
          error.retryable ? "BRVIN retrieval is temporarily unavailable." : "BRVIN could not complete this retrieval.",
          error.retryable,
          undefined,
          parsed.requestId,
        ),
        { caller, projectId: parsed.projectId, queryCount: parsed.queries.length, requestId: parsed.requestId },
      );
    }
    return logBrvinV2Unavailable("retrieveProjectContextV2", startedAt, parsed.requestId);
  }
}
