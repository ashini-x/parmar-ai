/**
 * BRVIN v2 server-side connector.
 *
 * This package wraps only the private WorkerEntrypoint RPC. It must be used
 * from a trusted server-side Worker, never from browser/mobile code.
 *
 * It intentionally does not cache project grants or automatically retry
 * retrieval calls: permission changes must apply immediately, and a timed-out
 * retrieval may already have reserved project quota on the BRVIN side.
 */

export type BrvinFailureCode =
  | "INVALID_REQUEST"
  | "APPLICATION_NOT_REGISTERED"
  | "APPLICATION_INACTIVE"
  | "ENVIRONMENT_NOT_REGISTERED"
  | "ENVIRONMENT_INACTIVE"
  | "PROJECT_NOT_AUTHORIZED"
  | "PROJECT_INACTIVE"
  | "MONTHLY_LIMIT_REACHED"
  | "RETRIEVAL_FAILED"
  | "BRVIN_UNAVAILABLE";

export interface BrvinFailure {
  ok: false;
  code: BrvinFailureCode;
  message: string;
  retryable: boolean;
  userMessage?: string;
  requestId?: string;
}

export interface BrvinSuccess<T> {
  ok: true;
  data: T;
}

export type BrvinResult<T> = BrvinSuccess<T> | BrvinFailure;

export interface BrvinProjectSelector {
  /** Opaque BRVIN project ID; this is a selector, not proof of permission. */
  projectId: string;
}

export interface BrvinAuthorizedProject {
  projectId: string;
  slug: string;
  name: string;
  description: string;
  ready: boolean;
  authorizedSourceCount: number;
}

export interface BrvinProjectStatus {
  projectId: string;
  ready: boolean;
  authorizedSourceCount: number;
}

export interface BrvinPassage {
  id: string;
  bookId: string;
  bookTitle: string;
  pdfPage: number;
  printedPage?: string;
  section?: string;
  text: string;
  score: number;
}

export interface BrvinPageImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
  byteLength: number;
}

export interface BrvinRetrievalInput extends BrvinProjectSelector {
  queries: string[];
  pageNumbers?: number[];
  requestId?: string;
}

export interface BrvinRetrievalData {
  passages: BrvinPassage[];
  pageImages?: BrvinPageImage[];
  searchedSources: number;
  searchCount: number;
}

/**
 * Structural type for a Cloudflare Service Binding configured with the
 * BrvinRetrievalApi WorkerEntrypoint. Runtime props are not part of RPC input;
 * the caller identity is fixed by the trusted binding configuration.
 */
export interface BrvinV2RpcBinding {
  listAuthorizedProjectsV2(): Promise<BrvinResult<BrvinAuthorizedProject[]>>;
  getProjectStatusV2(
    input: BrvinProjectSelector,
  ): Promise<BrvinResult<BrvinProjectStatus>>;
  retrieveProjectContextV2(
    input: BrvinRetrievalInput,
  ): Promise<BrvinResult<BrvinRetrievalData>>;
}

export interface BrvinConnectorOptions {
  /** Per-call deadline. Default: 15 seconds. */
  timeoutMs?: number;
  /** Maximum serialized RPC response size. Default: 8 MiB. */
  maxResponseBytes?: number;
  /** Override the correlation ID generator for tests or host integration. */
  requestIdFactory?: () => string;
  /** Optional content-free diagnostics callback. Never receives query or passage text. */
  onDiagnostic?: (event: BrvinConnectorDiagnostic) => void;
}

export interface BrvinConnectorDiagnostic {
  method: "listAuthorizedProjectsV2" | "getProjectStatusV2" | "retrieveProjectContextV2";
  requestId: string;
  outcome: "success" | BrvinFailureCode;
  latencyMs: number;
  responseBytes?: number;
}

export type BrvinConnectorAction =
  | "check_application_configuration"
  | "request_project_access"
  | "wait_for_project_or_quota"
  | "review_request"
  | "none";

export interface BrvinFailureGuidance {
  /** Server-declared retryability, not an instruction to retry automatically. */
  retryable: boolean;
  /** Automatic retries are deliberately disabled for all retrieval methods. */
  automaticRetryAllowed: false;
  action: BrvinConnectorAction;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_PROJECT_ID_LENGTH = 128;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_QUERIES = 3;
const MAX_QUERY_LENGTH = 2_000;
const MAX_PAGE_NUMBERS = 3;
const MAX_PDF_PAGE = 100_000;
const MAX_PASSAGES = 8;

type ConnectorMethod = BrvinConnectorDiagnostic["method"];

class BrvinTimeoutError extends Error {
  constructor() {
    super("BRVIN RPC deadline exceeded.");
    this.name = "BrvinTimeoutError";
  }
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 1) return fallback;
  return Math.min(value, maximum);
}

function defaultRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Use the deterministic-format fallback below in non-Worker test runtimes.
  }
  return "brvin-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
}

function validProjectId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PROJECT_ID_LENGTH &&
    value.trim() === value &&
    !value.includes("\u0000");
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function serializedSize(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

function failure(
  code: BrvinFailureCode,
  message: string,
  retryable: boolean,
  requestId: string,
  userMessage?: string,
): BrvinFailure {
  return {
    ok: false,
    code,
    message,
    retryable,
    requestId,
    ...(userMessage ? { userMessage } : {}),
  };
}

function normalizeQueries(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_QUERIES) return null;
  const queries: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || candidate.includes("\u0000")) return null;
    const normalized = candidate.replace(/\s+/gu, " ").trim();
    if (normalized.length > MAX_QUERY_LENGTH) return null;
    if (normalized && !queries.includes(normalized)) queries.push(normalized);
  }
  if (queries.length > MAX_QUERIES) return null;
  return queries;
}

function normalizePageNumbers(value: unknown): number[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PAGE_NUMBERS) return null;
  const pages: number[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "number" ||
      !Number.isSafeInteger(candidate) ||
      candidate < 1 ||
      candidate > MAX_PDF_PAGE
    ) return null;
    if (!pages.includes(candidate)) pages.push(candidate);
  }
  return pages.length <= MAX_PAGE_NUMBERS ? pages : null;
}

export function classifyBrvinFailure(error: BrvinFailure): BrvinFailureGuidance {
  let action: BrvinConnectorAction = "review_request";
  switch (error.code) {
    case "APPLICATION_NOT_REGISTERED":
    case "APPLICATION_INACTIVE":
    case "ENVIRONMENT_NOT_REGISTERED":
    case "ENVIRONMENT_INACTIVE":
      action = "check_application_configuration";
      break;
    case "PROJECT_NOT_AUTHORIZED":
      action = "request_project_access";
      break;
    case "PROJECT_INACTIVE":
    case "MONTHLY_LIMIT_REACHED":
      action = "wait_for_project_or_quota";
      break;
    case "INVALID_REQUEST":
      action = "none";
      break;
    case "RETRIEVAL_FAILED":
    case "BRVIN_UNAVAILABLE":
      action = error.retryable ? "review_request" : "none";
      break;
  }
  return {
    retryable: error.retryable,
    automaticRetryAllowed: false,
    action,
  };
}

export function formatBrvinCitation(passage: BrvinPassage): string {
  const page = Number.isSafeInteger(passage.pdfPage) && passage.pdfPage > 0
    ? "PDF page " + passage.pdfPage
    : "PDF page unknown";
  const printedPage = passage.printedPage?.trim()
    ? " (printed page " + passage.printedPage.trim() + ")"
    : "";
  const section = passage.section?.trim()
    ? " — " + passage.section.trim()
    : "";
  return passage.bookTitle + " — " + page + printedPage + section;
}

/**
 * Produce a plain-text evidence block with explicit citations. The consumer
 * still owns the model prompt, answer generation, and user-facing delivery.
 */
export function formatBrvinEvidence(passages: readonly BrvinPassage[]): string {
  return passages.slice(0, MAX_PASSAGES).map((passage, index) =>
    "[" + (index + 1) + "] " + formatBrvinCitation(passage) + "\n" + passage.text.trim()
  ).filter((block) => block.length > 0).join("\n\n");
}

export function createBrvinConnector(
  binding: BrvinV2RpcBinding,
  options: BrvinConnectorOptions = {},
) {
  const timeoutMs = boundedPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxResponseBytes = boundedPositiveInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    MAX_RESPONSE_BYTES,
  );
  const requestIdFactory = options.requestIdFactory ?? defaultRequestId;

  function diagnostic(event: BrvinConnectorDiagnostic): void {
    try {
      options.onDiagnostic?.(event);
    } catch {
      // Diagnostics must never break retrieval or hide the service result.
    }
  }

  async function execute<T>(
    method: ConnectorMethod,
    requestId: string,
    operation: () => Promise<BrvinResult<T>>,
  ): Promise<BrvinResult<T>> {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: BrvinResult<T>;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BrvinTimeoutError()), timeoutMs);
      });
      response = await Promise.race([operation(), deadline]);
      if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
        response = failure(
          "BRVIN_UNAVAILABLE",
          "BRVIN returned an invalid RPC response.",
          false,
          requestId,
        );
      } else if (!response.ok && !response.requestId) {
        response = { ...response, requestId };
      }

      const responseBytes = serializedSize(response);
      if (responseBytes === null || responseBytes > maxResponseBytes) {
        response = failure(
          "RETRIEVAL_FAILED",
          "BRVIN response exceeded the connector's configured size limit.",
          false,
          requestId,
        );
        diagnostic({
          method,
          requestId,
          outcome: "RETRIEVAL_FAILED",
          latencyMs: Date.now() - startedAt,
          responseBytes: responseBytes ?? undefined,
        });
        return response;
      }

      diagnostic({
        method,
        requestId,
        outcome: response.ok ? "success" : response.code,
        latencyMs: Date.now() - startedAt,
        responseBytes,
      });
      return response;
    } catch (error) {
      const timedOut = error instanceof BrvinTimeoutError;
      response = failure(
        "BRVIN_UNAVAILABLE",
        timedOut
          ? "BRVIN did not respond before the connector deadline."
          : "The private BRVIN RPC call could not be completed.",
        false,
        requestId,
        "The request outcome may be unknown. Do not automatically repeat a retrieval because BRVIN may already have reserved project quota.",
      );
      diagnostic({
        method,
        requestId,
        outcome: "BRVIN_UNAVAILABLE",
        latencyMs: Date.now() - startedAt,
      });
      return response;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    listAuthorizedProjects(): Promise<BrvinResult<BrvinAuthorizedProject[]>> {
      const requestId = requestIdFactory();
      if (!validRequestId(requestId)) {
        return Promise.resolve(failure(
          "INVALID_REQUEST",
          "The connector request ID generator returned an invalid value.",
          false,
          "brvin-invalid-request-id",
        ));
      }
      return execute("listAuthorizedProjectsV2", requestId, () =>
        binding.listAuthorizedProjectsV2()
      );
    },

    getProjectStatus(
      selector: BrvinProjectSelector,
    ): Promise<BrvinResult<BrvinProjectStatus>> {
      const requestId = requestIdFactory();
      if (!validRequestId(requestId)) {
        return Promise.resolve(failure(
          "INVALID_REQUEST",
          "The connector request ID generator returned an invalid value.",
          false,
          "brvin-invalid-request-id",
        ));
      }
      if (!selector || !validProjectId(selector.projectId)) {
        return Promise.resolve(failure(
          "INVALID_REQUEST",
          "A valid BRVIN project ID is required.",
          false,
          requestId,
        ));
      }
      return execute("getProjectStatusV2", requestId, () =>
        binding.getProjectStatusV2({ projectId: selector.projectId })
      );
    },

    retrieveProjectContext(
      input: BrvinRetrievalInput,
    ): Promise<BrvinResult<BrvinRetrievalData>> {
      const requestId = input?.requestId ?? requestIdFactory();
      if (!validRequestId(requestId)) {
        return Promise.resolve(failure(
          "INVALID_REQUEST",
          "A valid BRVIN request ID is required.",
          false,
          "brvin-invalid-request-id",
        ));
      }
      if (!input || !validProjectId(input.projectId)) {
        return Promise.resolve(failure(
          "INVALID_REQUEST",
          "A valid BRVIN project ID is required.",
          false,
          requestId,
        ));
      }
      const queries = normalizeQueries(input.queries);
      const pageNumbers = normalizePageNumbers(input.pageNumbers);
      if (
        queries === null ||
        pageNumbers === null ||
        (!queries.length && !pageNumbers.length)
      ) {
        return Promise.resolve(failure(
          "INVALID_REQUEST",
          "Provide up to three bounded search queries or up to three valid PDF page numbers.",
          false,
          requestId,
        ));
      }
      return execute("retrieveProjectContextV2", requestId, () =>
        binding.retrieveProjectContextV2({
          projectId: input.projectId,
          queries,
          ...(pageNumbers.length ? { pageNumbers } : {}),
          requestId,
        })
      );
    },
  };
}
