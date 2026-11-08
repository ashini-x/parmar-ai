/**
 * Deterministic, provider-neutral BRVIN OCR corpus representation.
 *
 * This module deliberately has no Cloudflare, Qdrant or Vertex SDK dependency.
 * The same page OCR + source generation always produces byte-stable manifests
 * and chunk IDs, so the records can be replayed into another index provider.
 */

export const BRVIN_CHUNK_MANIFEST_SCHEMA = "brvin-page-chunk-manifest/v1" as const;
export const BRVIN_CHUNKER_VERSION = "brvin-lexical-span-256-overlap-26-v1" as const;
export const BRVIN_NORMALIZER_VERSION = "brvin-unicode-nfc-whitespace-v1" as const;
export const BRVIN_CHUNK_TOKEN_TARGET = 256;
export const BRVIN_CHUNK_OVERLAP_TOKENS = 26;

export type BrvinContentType =
  | "explanatory_text"
  | "definition"
  | "formula"
  | "worked_example"
  | "numerical_problem"
  | "answer_key";

export interface BrvinFormulaExpression {
  /** Exact OCR line, retained without symbol substitution or mathematical repair. */
  original: string;
  /** Search-only NFC/whitespace representation; operators are not rewritten. */
  searchText: string;
}

export interface BrvinChunkRecord {
  chunkId: string;
  chunkIndex: number;
  /** Zero-based inclusive token offset in the page's deterministic lexical stream. */
  tokenStart: number;
  /** Zero-based exclusive token offset in the page's deterministic lexical stream. */
  tokenEndExclusive: number;
  /** Exact substring copied from the persisted Vision OCR text. */
  rawText: string;
  /** Versioned searchable representation; never replaces rawText. */
  normalizedText: string;
  contentHash: string;
  contentTypes: BrvinContentType[];
  formulaExpressions?: BrvinFormulaExpression[];
  ocrAverageWordConfidence?: number;
  ocrConfidenceSamples: number;
}

export interface BrvinPageChunkManifest {
  schema: typeof BRVIN_CHUNK_MANIFEST_SCHEMA;
  sourceId: string;
  sourceTitle: string;
  sourceItemKey: string;
  sourceSha256: string;
  ocrOperationId: string;
  sourceGeneration: string;
  physicalPdfPage: number;
  chunkerVersion: typeof BRVIN_CHUNKER_VERSION;
  normalizerVersion: typeof BRVIN_NORMALIZER_VERSION;
  chunkTokenTarget: number;
  overlapTokens: number;
  /** Complete raw page OCR exactly as read from the private Vision output object. */
  rawOcrText: string;
  rawOcrContentHash: string;
  ocrAverageWordConfidence?: number;
  ocrConfidenceSamples: number;
  chunks: BrvinChunkRecord[];
  /** SHA-256 of the manifest payload excluding this field. */
  manifestHash: string;
}

export interface BuildBrvinPageManifestInput {
  sourceId: string;
  sourceTitle: string;
  sourceItemKey: string;
  sourceSha256: string;
  ocrOperationId: string;
  physicalPdfPage: number;
  rawOcrText: string;
  ocrAverageWordConfidence?: number;
  ocrConfidenceSamples?: number;
}

interface TextToken {
  start: number;
  end: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function brvinSha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Search normalization is intentionally conservative: preserve punctuation,
 * equation operators, sub/superscript characters and minus variants. Raw OCR
 * remains stored separately and is never modified by this function.
 */
export function normalizeBrvinSearchText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\u0000/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * A deterministic Unicode-aware lexical tokenizer. Words and numeric literals
 * remain whole; non-whitespace symbols (including math operators) are tokens.
 * This is a stable chunking unit, not a claim that it matches a vendor tokenizer.
 */
function tokenizeBrvinPage(value: string): TextToken[] {
  const tokens: TextToken[] = [];
  const expression = /[\p{L}\p{M}_][\p{L}\p{M}\p{N}_]*|\p{N}+(?:[.,]\p{N}+)*|[^\s]/gu;
  for (const match of value.matchAll(expression)) {
    const start = match.index;
    tokens.push({ start, end: start + match[0].length });
  }
  return tokens;
}

function extractFormulaExpressions(value: string): BrvinFormulaExpression[] {
  const expressions: BrvinFormulaExpression[] = [];
  for (const line of value.split(/\r?\n/u)) {
    const candidate = line.trim();
    if (!candidate || candidate.length > 240) continue;
    // Require an explicit mathematical relation/operator plus an operand. This
    // errs on the side of omitting uncertain extraction, never repairing OCR.
    if (!/[=<>≤≥≈≠±×÷√∑∫∂∆^]/u.test(candidate)) continue;
    if (!/[\p{L}\p{N}]/u.test(candidate)) continue;
    expressions.push({
      original: line,
      searchText: normalizeBrvinSearchText(candidate),
    });
  }
  return expressions;
}

function classifyBrvinContent(value: string, hasFormula: boolean): BrvinContentType[] {
  const text = value.toLowerCase();
  const types: BrvinContentType[] = [];
  if (/\b(?:answer key|answers to|answer[s]? section|final answers?)\b/u.test(text)) {
    types.push("answer_key");
  }
  if (/\b(?:worked example|example\s*\d*|illustration|solved example|solution\s*\d*)\b/u.test(text)) {
    types.push("worked_example");
  }
  if (/\b(?:calculate|compute|determine|evaluate|find the value|solve for|how much|what is the value)\b/u.test(text) &&
      /\d/u.test(text)) {
    types.push("numerical_problem");
  }
  if (/\b(?:is defined as|are defined as|means|refers to|is called|are called)\b/u.test(text)) {
    types.push("definition");
  }
  if (hasFormula) types.push("formula");
  if (!types.length) types.push("explanatory_text");
  return types;
}

function validateBuildInput(input: BuildBrvinPageManifestInput): void {
  if (!input.sourceId || input.sourceId.length > 128 || /[\u0000/\\]/u.test(input.sourceId)) {
    throw new TypeError("A safe BRVIN source ID is required for a chunk manifest.");
  }
  if (!input.sourceItemKey || input.sourceItemKey.length > 512 || /\u0000/u.test(input.sourceItemKey)) {
    throw new TypeError("A stable BRVIN source item key is required for a chunk manifest.");
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.sourceSha256)) {
    throw new TypeError("The BRVIN source SHA-256 must contain exactly 64 hexadecimal characters.");
  }
  if (!input.ocrOperationId || input.ocrOperationId.length > 2048 || /\u0000/u.test(input.ocrOperationId)) {
    throw new TypeError("The persisted Vision OCR operation ID is required for deterministic generation.");
  }
  if (!Number.isSafeInteger(input.physicalPdfPage) || input.physicalPdfPage < 1 || input.physicalPdfPage > 2_000) {
    throw new RangeError("The physical PDF page number must be between 1 and 2,000.");
  }
  if (typeof input.rawOcrText !== "string" || !input.rawOcrText.trim()) {
    throw new TypeError("The raw Vision OCR page text must not be empty.");
  }
  const confidenceSamples = input.ocrConfidenceSamples ?? 0;
  if (!Number.isSafeInteger(confidenceSamples) || confidenceSamples < 0) {
    throw new RangeError("OCR confidence sample count must be a non-negative integer.");
  }
  if (input.ocrAverageWordConfidence !== undefined &&
      (!Number.isFinite(input.ocrAverageWordConfidence) ||
       input.ocrAverageWordConfidence < 0 ||
       input.ocrAverageWordConfidence > 1 ||
       confidenceSamples < 1)) {
    throw new RangeError("OCR average confidence must be between zero and one and have at least one sample.");
  }
}

export async function buildBrvinPageChunkManifest(
  input: BuildBrvinPageManifestInput,
): Promise<BrvinPageChunkManifest> {
  validateBuildInput(input);
  const sourceSha256 = input.sourceSha256.toLowerCase();
  const sourceGeneration = await brvinSha256Hex([
    input.sourceId,
    sourceSha256,
    input.ocrOperationId,
    BRVIN_CHUNK_MANIFEST_SCHEMA,
    BRVIN_CHUNKER_VERSION,
    BRVIN_NORMALIZER_VERSION,
  ].join("\n"));
  const rawOcrContentHash = await brvinSha256Hex(input.rawOcrText);
  const tokens = tokenizeBrvinPage(input.rawOcrText);
  const chunks: BrvinChunkRecord[] = [];
  const stride = BRVIN_CHUNK_TOKEN_TARGET - BRVIN_CHUNK_OVERLAP_TOKENS;

  for (let tokenStart = 0, chunkIndex = 0; tokenStart < tokens.length; chunkIndex += 1) {
    const tokenEndExclusive = Math.min(tokens.length, tokenStart + BRVIN_CHUNK_TOKEN_TARGET);
    const first = tokens[tokenStart];
    const last = tokens[tokenEndExclusive - 1];
    const rawText = input.rawOcrText.slice(first.start, last.end);
    const normalizedText = normalizeBrvinSearchText(rawText);
    if (!normalizedText) {
      tokenStart = tokenEndExclusive;
      continue;
    }
    const contentHash = await brvinSha256Hex(rawText);
    const formulaExpressions = extractFormulaExpressions(rawText);
    const chunkId = await brvinSha256Hex([
      input.sourceId,
      sourceGeneration,
      input.sourceItemKey,
      String(input.physicalPdfPage),
      String(chunkIndex),
      String(tokenStart),
      String(tokenEndExclusive),
      contentHash,
    ].join("\n"));
    chunks.push({
      chunkId,
      chunkIndex,
      tokenStart,
      tokenEndExclusive,
      rawText,
      normalizedText,
      contentHash,
      contentTypes: classifyBrvinContent(normalizedText, formulaExpressions.length > 0),
      ...(formulaExpressions.length ? { formulaExpressions } : {}),
      ...(input.ocrAverageWordConfidence !== undefined
        ? { ocrAverageWordConfidence: input.ocrAverageWordConfidence }
        : {}),
      ocrConfidenceSamples: input.ocrConfidenceSamples ?? 0,
    });
    if (tokenEndExclusive >= tokens.length) break;
    tokenStart += Math.max(1, Math.min(stride, tokenEndExclusive - tokenStart));
  }

  const payload = {
    schema: BRVIN_CHUNK_MANIFEST_SCHEMA,
    sourceId: input.sourceId,
    sourceTitle: input.sourceTitle,
    sourceItemKey: input.sourceItemKey,
    sourceSha256,
    ocrOperationId: input.ocrOperationId,
    sourceGeneration,
    physicalPdfPage: input.physicalPdfPage,
    chunkerVersion: BRVIN_CHUNKER_VERSION,
    normalizerVersion: BRVIN_NORMALIZER_VERSION,
    chunkTokenTarget: BRVIN_CHUNK_TOKEN_TARGET,
    overlapTokens: BRVIN_CHUNK_OVERLAP_TOKENS,
    rawOcrText: input.rawOcrText,
    rawOcrContentHash,
    ...(input.ocrAverageWordConfidence !== undefined
      ? { ocrAverageWordConfidence: input.ocrAverageWordConfidence }
      : {}),
    ocrConfidenceSamples: input.ocrConfidenceSamples ?? 0,
    chunks,
  };
  return {
    ...payload,
    manifestHash: await brvinSha256Hex(JSON.stringify(payload)),
  };
}

export async function verifyBrvinPageChunkManifest(value: unknown): Promise<value is BrvinPageChunkManifest> {
  if (!isRecord(value) ||
      value.schema !== BRVIN_CHUNK_MANIFEST_SCHEMA ||
      typeof value.sourceId !== "string" ||
      typeof value.sourceItemKey !== "string" ||
      typeof value.sourceSha256 !== "string" ||
      typeof value.ocrOperationId !== "string" ||
      typeof value.sourceGeneration !== "string" ||
      !Number.isSafeInteger(value.physicalPdfPage) ||
      typeof value.rawOcrText !== "string" ||
      typeof value.rawOcrContentHash !== "string" ||
      !Array.isArray(value.chunks) ||
      typeof value.manifestHash !== "string") return false;
  const { manifestHash, ...payload } = value;
  if (!/^[a-f0-9]{64}$/iu.test(manifestHash)) return false;
  if (new Set(value.chunks.map((chunk) =>
    isRecord(chunk) && typeof chunk.chunkId === "string" ? chunk.chunkId : "",
  )).size !== value.chunks.length) return false;
  return (await brvinSha256Hex(JSON.stringify(payload))) === manifestHash;
}

/** Returns the same stable page-scoped generation key for every replay. */
export function brvinPageManifestGenerationKey(manifest: Pick<BrvinPageChunkManifest, "sourceGeneration" | "physicalPdfPage">): string {
  return manifest.sourceGeneration + "/page-" + String(manifest.physicalPdfPage).padStart(6, "0");
}
