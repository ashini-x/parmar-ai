export const BRVIN_CORPUS_SCHEMA_VERSION = 1;
export const BRVIN_CHUNKER_VERSION = "lexical-window-v1";
export const BRVIN_NORMALIZER_VERSION = "unicode-nfc-whitespace-v1";
export const BRVIN_CHUNK_MAX_TOKENS = 256;
export const BRVIN_CHUNK_OVERLAP_TOKENS = 26;

export interface BrvinFormulaCandidate {
  lineNumber: number;
  startChar: number;
  endChar: number;
  originalExpression: string;
  normalizedSearchExpression: string;
  extractionMethod: "conservative-ocr-line-heuristic";
  confidence: "candidate-unverified";
}

export interface BrvinCorpusChunk {
  id: string;
  chunkIndex: number;
  startToken: number;
  endToken: number;
  startChar: number;
  endChar: number;
  rawText: string;
  normalizedText: string;
  contentSha256: string;
  contentTypes: string[];
  formulaCandidates: BrvinFormulaCandidate[];
}

export interface BrvinCorpusSourceManifest {
  schemaVersion: number;
  sourceId: string;
  sourcePdfSha256: string;
  generationId: string;
  pageCount: number;
  ocrEngine: "google-cloud-vision-document-text-detection";
  chunker: {
    version: string;
    tokenizer: "unicode-lexical-and-symbol";
    maxTokens: number;
    overlapTokens: number;
  };
  normalizer: {
    version: string;
    operations: ["unicode-nfc", "collapse-whitespace", "trim-outer-whitespace"];
    caseFolding: false;
    operatorSubstitution: false;
  };
  formulaExtraction: {
    method: "conservative-ocr-line-heuristic";
    confidence: "candidate-unverified";
    preservesOriginalExpression: true;
  };
  pageManifestPattern: string;
}

export interface BrvinCorpusPageManifest {
  schemaVersion: number;
  sourceId: string;
  sourcePdfSha256: string;
  generationId: string;
  pdfPage: number;
  rawOcrText: string;
  rawOcrSha256: string;
  normalizedSearchText: string;
  normalizedSearchTextSha256: string;
  contentTypes: string[];
  formulaCandidates: BrvinFormulaCandidate[];
  chunks: BrvinCorpusChunk[];
}

interface TokenSpan {
  start: number;
  end: number;
}

const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu;
const FORMULA_LINE_PATTERN = /(?:=|≤|≥|≠|≈|±|×|÷|\\(?:frac|sqrt)|\b[A-Za-z][A-Za-z0-9_]*\s*(?:\+|-|\*|\/|\^)\s*[A-Za-z0-9])/u;

export function normalizeBrvinSearchText(value: string): string {
  // NFC and whitespace normalization are intentionally conservative. In
  // particular, we do not lowercase variables or rewrite mathematical glyphs.
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function classifyBrvinContent(value: string, formulas: readonly BrvinFormulaCandidate[] = []): string[] {
  const tags: string[] = [];
  const lower = value.toLocaleLowerCase("en-US");

  if (/\b(?:means|defined as|refers to|is called|definition of)\b/u.test(lower)) tags.push("definition");
  if (/\b(?:worked example|example|solution|step\s*\d+)\b/u.test(lower)) tags.push("worked_example");
  if (/\b(?:calculate|compute|determine|find the value|solve for|how much)\b/u.test(lower) && /\d/u.test(value)) {
    tags.push("numerical_problem");
  }
  if (/\b(?:answer key|answers|correct answer)\b/u.test(lower)) tags.push("answer_key");
  if (formulas.length) tags.push("formula");
  if (/[\p{L}]{2}/u.test(value)) tags.push("explanatory_text");

  return [...new Set(tags)];
}

export function extractBrvinFormulaCandidates(value: string): BrvinFormulaCandidate[] {
  const lines = value.split(/\r\n|\r|\n/u);
  const candidates: BrvinFormulaCandidate[] = [];
  let lineStart = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const originalExpression = lines[index];
    const lineEnd = lineStart + originalExpression.length;
    if (!originalExpression.trim() || originalExpression.length > 400 || !FORMULA_LINE_PATTERN.test(originalExpression)) {
      const terminatorLength = value.startsWith("\r\n", lineEnd) ? 2 : (lineEnd < value.length ? 1 : 0);
      lineStart = lineEnd + terminatorLength;
      continue;
    }
    candidates.push({
      lineNumber: index + 1,
      startChar: lineStart,
      endChar: lineEnd,
      originalExpression,
      normalizedSearchExpression: normalizeBrvinSearchText(originalExpression),
      extractionMethod: "conservative-ocr-line-heuristic",
      confidence: "candidate-unverified",
    });
    const terminatorLength = value.startsWith("\r\n", lineEnd) ? 2 : (lineEnd < value.length ? 1 : 0);
    lineStart = lineEnd + terminatorLength;
  }

  return candidates;
}

function tokenize(value: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  for (let match = TOKEN_PATTERN.exec(value); match; match = TOKEN_PATTERN.exec(value)) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildBrvinSourceManifest(input: {
  sourceId: string;
  sourcePdfSha256: string;
  pageCount: number;
}): Promise<BrvinCorpusSourceManifest> {
  const sourcePdfSha256 = input.sourcePdfSha256.toLowerCase();
  const generationSeed = JSON.stringify({
    sourceId: input.sourceId,
    sourcePdfSha256,
    ocrEngine: "google-cloud-vision-document-text-detection",
    schemaVersion: BRVIN_CORPUS_SCHEMA_VERSION,
    chunkerVersion: BRVIN_CHUNKER_VERSION,
    normalizerVersion: BRVIN_NORMALIZER_VERSION,
    maxTokens: BRVIN_CHUNK_MAX_TOKENS,
    overlapTokens: BRVIN_CHUNK_OVERLAP_TOKENS,
  });
  const generationId = (await sha256Hex(generationSeed)).slice(0, 32);

  return {
    schemaVersion: BRVIN_CORPUS_SCHEMA_VERSION,
    sourceId: input.sourceId,
    sourcePdfSha256,
    generationId,
    pageCount: input.pageCount,
    ocrEngine: "google-cloud-vision-document-text-detection",
    chunker: {
      version: BRVIN_CHUNKER_VERSION,
      tokenizer: "unicode-lexical-and-symbol",
      maxTokens: BRVIN_CHUNK_MAX_TOKENS,
      overlapTokens: BRVIN_CHUNK_OVERLAP_TOKENS,
    },
    normalizer: {
      version: BRVIN_NORMALIZER_VERSION,
      operations: ["unicode-nfc", "collapse-whitespace", "trim-outer-whitespace"],
      caseFolding: false,
      operatorSubstitution: false,
    },
    formulaExtraction: {
      method: "conservative-ocr-line-heuristic",
      confidence: "candidate-unverified",
      preservesOriginalExpression: true,
    },
    pageManifestPattern: "pages/page-{pdfPage}-{rawOcrSha256}.json",
  };
}

export async function buildBrvinPageManifest(input: {
  sourceId: string;
  sourcePdfSha256: string;
  generationId: string;
  pdfPage: number;
  rawOcrText: string;
}): Promise<BrvinCorpusPageManifest> {
  if (!Number.isSafeInteger(input.pdfPage) || input.pdfPage < 1) {
    throw new RangeError("A BRVIN corpus page must be a positive physical PDF page number.");
  }
  if (!input.rawOcrText.trim()) {
    throw new Error("BRVIN cannot create a page manifest from empty OCR text.");
  }

  const rawOcrSha256 = await sha256Hex(input.rawOcrText);
  const normalizedSearchText = normalizeBrvinSearchText(input.rawOcrText);
  const normalizedSearchTextSha256 = await sha256Hex(normalizedSearchText);
  const pageFormulas = extractBrvinFormulaCandidates(input.rawOcrText);
  const spans = tokenize(input.rawOcrText);
  const chunks: BrvinCorpusChunk[] = [];
  const step = BRVIN_CHUNK_MAX_TOKENS - BRVIN_CHUNK_OVERLAP_TOKENS;

  for (let startToken = 0, chunkIndex = 0; startToken < spans.length; startToken += step, chunkIndex += 1) {
    const endToken = Math.min(spans.length, startToken + BRVIN_CHUNK_MAX_TOKENS);
    const startChar = spans[startToken].start;
    const endChar = spans[endToken - 1].end;
    const rawText = input.rawOcrText.slice(startChar, endChar);
    const normalizedText = normalizeBrvinSearchText(rawText);
    const contentSha256 = await sha256Hex(rawText);
    const formulaCandidates = pageFormulas.filter((candidate) =>
      candidate.startChar < endChar && candidate.endChar > startChar
    );
    chunks.push({
      id: "brvchunk_" + (await sha256Hex([
        input.sourceId, input.pdfPage, BRVIN_CHUNKER_VERSION, BRVIN_NORMALIZER_VERSION,
        chunkIndex, startChar, endChar, contentSha256,
      ].join("|"))),
      chunkIndex,
      startToken,
      endToken,
      startChar,
      endChar,
      rawText,
      normalizedText,
      contentSha256,
      contentTypes: classifyBrvinContent(rawText, formulaCandidates),
      formulaCandidates,
    });
    if (endToken === spans.length) break;
  }

  return {
    schemaVersion: BRVIN_CORPUS_SCHEMA_VERSION,
    sourceId: input.sourceId,
    sourcePdfSha256: input.sourcePdfSha256.toLowerCase(),
    generationId: input.generationId,
    pdfPage: input.pdfPage,
    rawOcrText: input.rawOcrText,
    rawOcrSha256,
    normalizedSearchText,
    normalizedSearchTextSha256,
    contentTypes: classifyBrvinContent(input.rawOcrText, pageFormulas),
    formulaCandidates: pageFormulas,
    chunks,
  };
}
