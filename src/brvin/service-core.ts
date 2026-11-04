import type {
  Env,
  BrvinServiceFailure,
  BrvinServiceRetrievalResult,
  BrvinServiceStatusResult,
} from "../config/env";
import {
  BrvinRetrievalError,
  getBrvinProjectSources,
  retrieveBrvinProjectContextForProject,
  type BrvinProjectIdentity,
} from "./retrieval";

export type BrvinServiceEnv = Pick<
  Env,
  | "DB"
  | "FATMAN_SEARCH"
  | "FATMAN_INSTANCE_NAME"
  | "FATMAN_MIN_SCORE"
  | "FATMAN_MONTHLY_QUERY_LIMIT"
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

  const reserved = fatman
    ? await env.DB.prepare(
        "INSERT INTO fatman_search_usage (billing_month,query_count,updated_at) VALUES (?,1,?) " +
        "ON CONFLICT(billing_month) DO UPDATE SET query_count=query_count+1,updated_at=excluded.updated_at " +
        "WHERE query_count < ? RETURNING query_count",
      ).bind(month, now, queryLimit(env.FATMAN_MONTHLY_QUERY_LIMIT)).first<{ query_count: number }>()
    : await env.DB.prepare(
        "INSERT INTO brvin_project_search_usage (project_id,billing_month,query_count,updated_at) VALUES (?,?,1,?) " +
        "ON CONFLICT(project_id,billing_month) DO UPDATE SET query_count=query_count+1,updated_at=excluded.updated_at " +
        "WHERE query_count < ? RETURNING query_count",
      ).bind(project.id, month, now, queryLimit(env.BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT)).first<{ query_count: number }>();

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
    queryCount: Number(existing?.query_count ?? queryLimit(
      fatman ? env.FATMAN_MONTHLY_QUERY_LIMIT : env.BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT,
    )),
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
  input: { queries?: unknown },
): Promise<BrvinServiceRetrievalResult> {
  try {
    if (!input || !Array.isArray(input.queries)) {
      return failure("INVALID_REQUEST", "A list of search queries is required.", false);
    }
    const queries = [...new Set(
      input.queries
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/\u0000/gu, "").replace(/\s+/gu, " ").trim().slice(0, 2_000))
        .filter(Boolean),
    )].slice(0, 3);
    if (!queries.length) return failure("INVALID_REQUEST", "A non-empty search query is required.", false);

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
    );
    return {
      ok: true,
      passages: context.passages,
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
