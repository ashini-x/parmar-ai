import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyBrvinFailure,
  createBrvinConnector,
  formatBrvinCitation,
  formatBrvinEvidence,
  type BrvinAuthorizedProject,
  type BrvinPageImage,
  type BrvinPassage,
  type BrvinProjectStatus,
  type BrvinResult,
  type BrvinRetrievalData,
  type BrvinRetrievalInput,
  type BrvinV2RpcBinding,
} from "../packages/brvin-connector/src";

const project: BrvinAuthorizedProject = {
  projectId: "fatman",
  slug: "fatman",
  name: "Fatman",
  description: "SSC learning project",
  ready: true,
  authorizedSourceCount: 1,
};

const status: BrvinProjectStatus = {
  projectId: "fatman",
  ready: true,
  authorizedSourceCount: 1,
};

const passage: BrvinPassage = {
  id: "fatman-page-200",
  bookId: "fatman-legacy-538",
  bookTitle: "Fatman 2nd Edition",
  pdfPage: 200,
  printedPage: "184",
  section: "Indian Constitution",
  text: "The distribution of powers separates legislative, executive and judicial functions.",
  score: 0.94,
};

const retrievalData: BrvinRetrievalData = {
  passages: [passage],
  searchedSources: 1,
  searchCount: 1,
};

function makeBinding(overrides: Partial<BrvinV2RpcBinding> = {}): BrvinV2RpcBinding {
  return {
    listAuthorizedProjectsV2: vi.fn(async () => ({
      ok: true,
      data: [project],
    })),
    getProjectStatusV2: vi.fn(async () => ({
      ok: true,
      data: status,
    })),
    retrieveProjectContextV2: vi.fn(async () => ({
      ok: true,
      data: retrievalData,
    })),
    ...overrides,
  };
}

describe("BRVIN reusable server-side connector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists projects through the v2 discovery method without inventing a project selector", async () => {
    const binding = makeBinding();
    const connector = createBrvinConnector(binding, {
      requestIdFactory: () => "request-project-list",
    });

    const result = await connector.listAuthorizedProjects();

    expect(result).toEqual({ ok: true, data: [project] });
    expect(binding.listAuthorizedProjectsV2).toHaveBeenCalledTimes(1);
    expect(binding.getProjectStatusV2).not.toHaveBeenCalled();
  });

  it("gets readiness for an opaque legacy project ID", async () => {
    const binding = makeBinding();
    const connector = createBrvinConnector(binding, {
      requestIdFactory: () => "request-fatman-status",
    });

    const result = await connector.getProjectStatus({ projectId: "fatman" });

    expect(result).toEqual({ ok: true, data: status });
    expect(binding.getProjectStatusV2).toHaveBeenCalledWith({ projectId: "fatman" });
  });

  it("normalizes queries and page numbers and forwards a correlation ID", async () => {
    const binding = makeBinding();
    const connector = createBrvinConnector(binding, {
      requestIdFactory: () => "connector-request-01",
    });

    const input: BrvinRetrievalInput = {
      projectId: "fatman",
      queries: ["  explain   separation of powers ", "explain separation of powers", "Compare legislature and executive"],
      pageNumbers: [200, 200, 201],
    };
    const result = await connector.retrieveProjectContext(input);

    expect(result).toEqual({ ok: true, data: retrievalData });
    expect(binding.retrieveProjectContextV2).toHaveBeenCalledWith({
      projectId: "fatman",
      queries: ["explain separation of powers", "Compare legislature and executive"],
      pageNumbers: [200, 201],
      requestId: "connector-request-01",
    });
  });

  it("allows exact-page-only retrieval without inventing a semantic query", async () => {
    const binding = makeBinding();
    const connector = createBrvinConnector(binding, {
      requestIdFactory: () => "page-only-request",
    });

    const result = await connector.retrieveProjectContext({
      projectId: "fatman",
      queries: [],
      pageNumbers: [200],
    });

    expect(result.ok).toBe(true);
    expect(binding.retrieveProjectContextV2).toHaveBeenCalledWith({
      projectId: "fatman",
      queries: [],
      pageNumbers: [200],
      requestId: "page-only-request",
    });
  });

  it("rejects invalid project selectors without calling the binding", async () => {
    const binding = makeBinding();
    const connector = createBrvinConnector(binding, {
      requestIdFactory: () => "invalid-selector-test",
    });

    const invalidProjectIds = ["", " fatman", "fatman ", "x".repeat(129), "fatman\u0000"];
    for (const projectId of invalidProjectIds) {
      const result = await connector.getProjectStatus({ projectId });
      expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST", retryable: false });
    }
    expect(binding.getProjectStatusV2).not.toHaveBeenCalled();
  });

  it("rejects malformed query and page limits before the RPC", async () => {
    const binding = makeBinding();
    const connector = createBrvinConnector(binding, {
      requestIdFactory: () => "invalid-retrieval-test",
    });
    const invalidInputs: BrvinRetrievalInput[] = [
      { projectId: "fatman", queries: [] },
      { projectId: "fatman", queries: ["x".repeat(2_001)] },
      { projectId: "fatman", queries: ["one", "two", "three", "four"] },
      { projectId: "fatman", queries: ["valid"], pageNumbers: [0] },
      { projectId: "fatman", queries: ["valid"], pageNumbers: [1, 2, 3, 4] },
      { projectId: "fatman", queries: Array(10_000).fill("same query") },
      { projectId: "fatman", queries: ["valid"], pageNumbers: Array(10_000).fill(200) },
    ];

    for (const input of invalidInputs) {
      const result = await connector.retrieveProjectContext(input);
      expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST", retryable: false });
    }
    expect(binding.retrieveProjectContextV2).not.toHaveBeenCalled();
  });

  it("preserves the service's typed authorization failure and adds a request ID", async () => {
    const denied: BrvinResult<BrvinProjectStatus> = {
      ok: false,
      code: "PROJECT_NOT_AUTHORIZED",
      message: "This application is not authorised to access the requested BRVIN project.",
      retryable: false,
    };
    const binding = makeBinding({
      getProjectStatusV2: vi.fn(async () => denied),
    });
    const connector = createBrvinConnector(binding, {
      requestIdFactory: () => "denied-project-request",
    });

    const result = await connector.getProjectStatus({ projectId: "private-project" });

    expect(result).toMatchObject({
      ok: false,
      code: "PROJECT_NOT_AUTHORIZED",
      retryable: false,
      requestId: "denied-project-request",
    });
    if (result.ok) throw new Error("Expected an authorization failure.");
    expect(classifyBrvinFailure(result)).toEqual({
      retryable: false,
      automaticRetryAllowed: false,
      action: "request_project_access",
    });
  });

  it("classifies quota and configuration failures without enabling automatic retry", () => {
    const quota = classifyBrvinFailure({
      ok: false,
      code: "MONTHLY_LIMIT_REACHED",
      message: "Allowance exhausted.",
      retryable: false,
    });
    const environment = classifyBrvinFailure({
      ok: false,
      code: "ENVIRONMENT_NOT_REGISTERED",
      message: "Unknown environment.",
      retryable: false,
    });

    expect(quota).toEqual({
      retryable: false,
      automaticRetryAllowed: false,
      action: "wait_for_project_or_quota",
    });
    expect(environment.action).toBe("check_application_configuration");
    expect(environment.automaticRetryAllowed).toBe(false);
  });

  it("normalizes a thrown RPC error and does not automatically retry", async () => {
    const call = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const binding = makeBinding({
      getProjectStatusV2: call,
    });
    const connector = createBrvinConnector(binding, {
      requestIdFactory: () => "connection-error-request",
    });

    const result = await connector.getProjectStatus({ projectId: "fatman" });

    expect(result).toMatchObject({
      ok: false,
      code: "BRVIN_UNAVAILABLE",
      retryable: false,
      requestId: "connection-error-request",
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("returns an ambiguous timeout as non-retryable and calls the RPC only once", async () => {
    const call = vi.fn(() => new Promise<BrvinResult<BrvinProjectStatus>>(() => undefined));
    const binding = makeBinding({
      getProjectStatusV2: call,
    });
    const connector = createBrvinConnector(binding, {
      timeoutMs: 5,
      requestIdFactory: () => "timeout-request",
    });

    const result = await connector.getProjectStatus({ projectId: "fatman" });

    expect(result).toMatchObject({
      ok: false,
      code: "BRVIN_UNAVAILABLE",
      retryable: false,
      requestId: "timeout-request",
      userMessage: expect.stringContaining("Do not automatically repeat"),
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("rejects a response above the configured size limit", async () => {
    const binding = makeBinding();
    const connector = createBrvinConnector(binding, {
      maxResponseBytes: 64,
      requestIdFactory: () => "oversized-response",
    });

    const result = await connector.listAuthorizedProjects();

    expect(result).toMatchObject({
      ok: false,
      code: "RETRIEVAL_FAILED",
      retryable: false,
      requestId: "oversized-response",
    });
  });

  it("emits content-free diagnostics without query or passage text", async () => {
    const binding = makeBinding();
    const events: Array<Record<string, unknown>> = [];
    const connector = createBrvinConnector(binding, {
      requestIdFactory: () => "diagnostic-request",
      onDiagnostic: (event) => events.push(event as unknown as Record<string, unknown>),
    });

    await connector.retrieveProjectContext({
      projectId: "fatman",
      queries: ["private student's exact question"],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: "retrieveProjectContextV2",
      requestId: "diagnostic-request",
      outcome: "success",
    });
    expect(JSON.stringify(events[0])).not.toContain("private student's exact question");
  });

  it("formats provenance with physical and printed PDF page references", () => {
    expect(formatBrvinCitation(passage)).toBe(
      "Fatman 2nd Edition — PDF page 200 (printed page 184) — Indian Constitution",
    );
    expect(formatBrvinEvidence([passage])).toBe(
      "[1] Fatman 2nd Edition — PDF page 200 (printed page 184) — Indian Constitution\n" +
      passage.text,
    );
  });
});
