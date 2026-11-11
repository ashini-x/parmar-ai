import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  brvinMonthlyQueryLimit,
  getBrvinProjectStatusV2,
  listAuthorizedProjectsV2,
  retrieveBrvinForApplicationV2,
} from "../src/brvin/service-core";

const ENVIRONMENT_ID = "00000000-0000-4000-8000-000000000102";
const APPLICATION_ID = "00000000-0000-4000-8000-000000000101";

type Project = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
};

type Source = {
  id: string;
  title: string;
  search_prefix: string;
  page_count: number;
};

type Options = {
  identity?: {
    environment_id: string;
    application_id: string | null;
    environment_key: string;
    environment_status: string;
    resolved_application_id: string | null;
    application_slug: string | null;
    application_status: string | null;
  } | null;
  project?: Project | null;
  projects?: Project[];
  sources?: Source[];
  quotaAllowed?: boolean;
  grantStatus?: "active" | "revoked";
};

const fatman: Project = {
  id: "fatman",
  name: "Fatman",
  slug: "fatman",
  description: "SSC knowledge project",
  status: "active",
};

const fatmanSource: Source = {
  id: "fatman-legacy-538",
  title: "Fatman 2nd Edition",
  search_prefix: "fatman/pages/",
  page_count: 538,
};

describe("BRVIN monthly project query limit", () => {
  it("uses the same bounded monthly limit as retrieval enforcement", () => {
    expect(brvinMonthlyQueryLimit("400")).toBe(400);
    expect(brvinMonthlyQueryLimit("800")).toBe(800);
    expect(brvinMonthlyQueryLimit("1200")).toBe(800);
    expect(brvinMonthlyQueryLimit("0")).toBe(800);
    expect(brvinMonthlyQueryLimit("invalid")).toBe(800);
    expect(brvinMonthlyQueryLimit(undefined)).toBe(800);
  });
});

describe("BRVIN private application retrieval RPC v2", () => {
  const search = vi.fn();
  let prepare: ReturnType<typeof vi.fn>;

  const makeEnv = (options: Options = {}) => {
    const identity = options.identity === undefined
      ? {
          environment_id: ENVIRONMENT_ID,
          application_id: APPLICATION_ID,
          environment_key: "production",
          environment_status: "active",
          resolved_application_id: APPLICATION_ID,
          application_slug: "parmar-ai",
          application_status: "active",
        }
      : options.identity;

    const project = options.project === undefined ? fatman : options.project;
    const projects = options.projects ?? (project ? [project] : []);
    const sources = options.sources ?? [fatmanSource];
    const quotaAllowed = options.quotaAllowed ?? true;

    prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes("FROM brvin_application_environments")) return identity;
          if (
            sql.includes("FROM brvin_application_project_grants") &&
            sql.includes("JOIN brvin_projects p") &&
            sql.includes("WHERE g.application_id=?")
          ) {
            if (!project || options.grantStatus === "revoked") return null;
            if (String(values[0]) !== APPLICATION_ID || String(values[1]) !== project.id) return null;
            return project;
          }
          if (sql.includes("INSERT INTO fatman_search_usage")) {
            return quotaAllowed ? { query_count: 21 } : null;
          }
          if (sql.includes("SELECT query_count FROM fatman_search_usage")) {
            return { query_count: 800 };
          }
          if (sql.includes("INSERT INTO brvin_project_search_usage")) {
            return quotaAllowed ? { query_count: 1 } : null;
          }
          if (sql.includes("SELECT query_count FROM brvin_project_search_usage")) {
            return { query_count: 800 };
          }
          return null;
        }),
        all: vi.fn(async () => {
          if (sql.includes("FROM brvin_books b")) return { results: sources };
          if (
            sql.includes("FROM brvin_application_project_grants") &&
            sql.includes("ORDER BY p.name")
          ) {
            return {
              results: projects.filter((item) => item.status === "active"),
            };
          }
          return { results: [] };
        }),
      })),
    }));

    return {
      DB: { prepare },
      BRVIN_SEARCH: {
        get: () => ({
          search,
          items: {
            list: vi.fn(async () => ({ result: [] })),
            get: vi.fn(() => ({ download: vi.fn() })),
          },
        }),
      },
      BRVIN_SEARCH_INSTANCE: "shared-index",
      BRVIN_MIN_SCORE: "0.2",
      BRVIN_DEFAULT_MONTHLY_QUERY_LIMIT: "800",
    } as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    search.mockResolvedValue({
      chunks: [{
        id: "fatman-page-14",
        text: "The Constitution guarantees equality before the law and equal protection of the laws.",
        score: 0.94,
        item: { key: "fatman/pages/page-000014.txt" },
      }],
    });
  });

  it("discovers only active projects explicitly granted to the application", async () => {
    const env = makeEnv({
      projects: [fatman],
      sources: [fatmanSource],
    });

    const result = await listAuthorizedProjectsV2(env, ENVIRONMENT_ID);

    expect(result).toEqual({
      ok: true,
      data: [{
        projectId: "fatman",
        slug: "fatman",
        name: "Fatman",
        description: "SSC knowledge project",
        ready: true,
        authorizedSourceCount: 1,
      }],
    });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("g.application_id=?"));
    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining("brvin_service_clients"));
  });

  it("accepts the existing opaque Fatman project ID and reports its authorised readiness", async () => {
    const env = makeEnv();

    const result = await getBrvinProjectStatusV2(env, ENVIRONMENT_ID, { projectId: "fatman" });

    expect(result).toEqual({
      ok: true,
      data: { projectId: "fatman", ready: true, authorizedSourceCount: 1 },
    });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("brvin_application_project_grants"));
  });

  it("fails closed when the trusted environment identity is missing, even if a body supplies legacy identity fields", async () => {
    const env = makeEnv();

    const result = await retrieveBrvinForApplicationV2(env, "", {
      projectId: "fatman",
      queries: ["equality"],
      clientId: "fatman",
      applicationEnvironmentId: ENVIRONMENT_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "ENVIRONMENT_NOT_REGISTERED",
      retryable: false,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown environment and never falls back to a co-present clientId", async () => {
    const env = makeEnv({ identity: null });

    const result = await getBrvinProjectStatusV2(env, ENVIRONMENT_ID, { projectId: "fatman", clientId: "fatman" });

    expect(result).toMatchObject({ ok: false, code: "ENVIRONMENT_NOT_REGISTERED", retryable: false });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("brvin_application_environments"));
    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining("brvin_service_clients"));
  });

  it("rejects an inactive environment before looking up a project", async () => {
    const env = makeEnv({
      identity: {
        environment_id: ENVIRONMENT_ID,
        application_id: APPLICATION_ID,
        environment_key: "production",
        environment_status: "revoked",
        resolved_application_id: APPLICATION_ID,
        application_slug: "parmar-ai",
        application_status: "active",
      },
    });

    const result = await getBrvinProjectStatusV2(env, ENVIRONMENT_ID, { projectId: "fatman" });

    expect(result).toMatchObject({ ok: false, code: "ENVIRONMENT_INACTIVE" });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects an inactive application before looking up a project", async () => {
    const env = makeEnv({
      identity: {
        environment_id: ENVIRONMENT_ID,
        application_id: APPLICATION_ID,
        environment_key: "production",
        environment_status: "active",
        resolved_application_id: APPLICATION_ID,
        application_slug: "parmar-ai",
        application_status: "suspended",
      },
    });

    const result = await getBrvinProjectStatusV2(env, ENVIRONMENT_ID, { projectId: "fatman" });

    expect(result).toMatchObject({ ok: false, code: "APPLICATION_INACTIVE" });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("does not disclose projects without an active application grant", async () => {
    const env = makeEnv({ project: null });

    const result = await retrieveBrvinForApplicationV2(env, ENVIRONMENT_ID, {
      projectId: "not-granted",
      queries: ["equality"],
    });

    expect(result).toMatchObject({ ok: false, code: "PROJECT_NOT_AUTHORIZED", retryable: false });
    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO fatman_search_usage"));
    expect(search).not.toHaveBeenCalled();
  });


  it("denies a revoked application-project grant before quota reservation or provider search", async () => {
    const env = makeEnv({ grantStatus: "revoked" });

    const result = await retrieveBrvinForApplicationV2(env, ENVIRONMENT_ID, {
      projectId: "fatman",
      queries: ["equality"],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "PROJECT_NOT_AUTHORIZED",
      retryable: false,
    });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("brvin_application_project_grants"));
    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO fatman_search_usage"));
    expect(search).not.toHaveBeenCalled();
  });

  it("distinguishes an inactive project only when the application has an active grant", async () => {
    const env = makeEnv({ project: { ...fatman, status: "suspended" } });

    const result = await getBrvinProjectStatusV2(env, ENVIRONMENT_ID, { projectId: "fatman" });

    expect(result).toMatchObject({ ok: false, code: "PROJECT_INACTIVE", retryable: false });
    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO fatman_search_usage"));
  });

  it("rejects padded, empty, oversized and NUL-containing project selectors before identity lookup", async () => {
    const env = makeEnv();
    const invalidIds = ["", " fatman", "fatman ", "x".repeat(129), "fatman\u0000"];
    for (const projectId of invalidIds) {
      const result = await getBrvinProjectStatusV2(env, ENVIRONMENT_ID, { projectId });
      expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("returns empty evidence without quota or search when an authorised project has no ready sources", async () => {
    const env = makeEnv({ sources: [] });

    const result = await retrieveBrvinForApplicationV2(env, ENVIRONMENT_ID, {
      projectId: "fatman",
      queries: ["equality"],
    });

    expect(result).toEqual({
      ok: true,
      data: { passages: [], searchedSources: 0, searchCount: 0 },
    });
    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO fatman_search_usage"));
    expect(search).not.toHaveBeenCalled();
  });

  it("retrieves only within the granted project's existing folder prefixes", async () => {
    const env = makeEnv();

    const result = await retrieveBrvinForApplicationV2(env, ENVIRONMENT_ID, {
      projectId: "fatman",
      queries: ["Constitution equality"],
      requestId: "askmoina-test-01",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        searchedSources: 1,
        searchCount: 1,
        passages: [expect.objectContaining({ bookId: "fatman-legacy-538", pdfPage: 14 })],
      },
    });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      ai_search_options: {
        cache: { enabled: true, cache_threshold: "super_strict_match" },
        retrieval: {
          max_num_results: 16,
          match_threshold: 0.3,
          retrieval_type: "hybrid",
          filters: { folder: { $in: ["fatman/pages/"] } },
        },
        reranking: {
          enabled: true,
          model: "@cf/baai/bge-reranker-base",
          match_threshold: 0.4,
        },
      },
    }));
  });

  it("uses the original Fatman monthly counter and rejects an exhausted allowance before search", async () => {
    const env = makeEnv({ quotaAllowed: false });

    const result = await retrieveBrvinForApplicationV2(env, ENVIRONMENT_ID, {
      projectId: "fatman",
      queries: ["equality"],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "MONTHLY_LIMIT_REACHED",
      retryable: false,
      userMessage: expect.stringContaining("Fatman search"),
    });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO fatman_search_usage"));
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects malformed query/page input instead of treating it as unrestricted retrieval", async () => {
    const env = makeEnv();
    const inputs: unknown[] = [
      { projectId: "fatman" },
      { projectId: "fatman", queries: "equality" },
      { projectId: "fatman", queries: ["x".repeat(2_001)] },
      { projectId: "fatman", queries: [null] },
      { projectId: "fatman", queries: [], pageNumbers: [0] },
      { projectId: "fatman", queries: [], pageNumbers: [1, 2, 3, 4] },
      { projectId: "fatman", queries: [], requestId: "bad\nrequest" },
    ];

    for (const input of inputs) {
      const result = await retrieveBrvinForApplicationV2(env, ENVIRONMENT_ID, input);
      expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST", retryable: false });
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
});
