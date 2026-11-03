import {
  formatFatmanCitations,
  mergeFatmanContexts,
  type FatmanBookContext,
} from "./retrieval";

export const FATMAN_RELEASE_QA_SUITE_VERSION = "fatman-real-user-qa-v3";

export interface FatmanReleaseQaCase {
  id: string;
  category: "exact_fact" | "concept" | "comparison" | "page_reference" | "out_of_book" | "difficult";
  question: string;
  queryCandidates: string[];
  expectedPages: number[];
  requiredFactGroups: string[][];
  expectAbstention?: boolean;
}

export const FATMAN_RELEASE_QA_CASES: readonly FatmanReleaseQaCase[] = [
  {
    id: "exact-plassey-fact",
    category: "exact_fact",
    question: "Who led the East India Company forces at the Battle of Plassey, and who was the Nawab of Bengal?",
    queryCandidates: [
      "Battle of Plassey Robert Clive Siraj-ud-Daulah Nawab of Bengal 1757",
      "Robert Clive led East India Company forces at Battle of Plassey Siraj-ud-Daulah",
    ],
    expectedPages: [168],
    requiredFactGroups: [["Robert Clive"], ["Siraj-ud-Daulah", "Siraj ud Daulah"]],
  },
  {
    id: "concept-president-parliament",
    category: "concept",
    question: "Why is the President considered an integral part of Parliament in India?",
    queryCandidates: [
      "Article 79 Parliament India consists President two Houses no Bill becomes law without President assent",
      "President integral part Parliament no Bill becomes law without his assent",
    ],
    expectedPages: [227],
    requiredFactGroups: [["Bill"], ["assent"]],
  },
  {
    id: "comparison-equality",
    category: "comparison",
    question: "Compare Fundamental Rights (Part III) with Directive Principles of State Policy (Part IV), focusing on enforceability and their constitutional roles.",
    queryCandidates: [
      "Fundamental Rights justiciable and Directive Principles of State Policy non justiciable compare",
      "Fundamental Rights Part III Article 12-35 legally enforceable and DPSP Part IV Article 36-51 non-justiciable political democracy social economic democracy",
    ],
    expectedPages: [213, 218],
    requiredFactGroups: [
      ["justiciable", "legally enforceable"],
      ["non-justiciable", "not legally enforceable"],
      ["Part III"],
      ["Part IV"],
      ["political democracy"],
      ["social and economic democracy", "welfare state"],
    ],
  },
  {
    id: "page-reference-plassey",
    category: "page_reference",
    question: "Which PDF page in Fatman describes the Battle of Plassey, and what are its key details?",
    queryCandidates: [
      "Battle of Plassey 1757 Robert Clive Siraj-ud-Daulah Nawab of Bengal",
      "Outcomes of Battle of Plassey Mir Jafar Robert Clive 1757",
    ],
    expectedPages: [168],
    requiredFactGroups: [["Robert Clive"], ["Siraj-ud-Daulah", "Siraj ud Daulah"]],
  },
  {
    id: "out-of-book-secret-fingerprint",
    category: "out_of_book",
    question: "What is the exact SHA-256 fingerprint of the Cloudflare API token used to deploy this PDF?",
    queryCandidates: [
      "exact SHA-256 fingerprint Cloudflare API token used to deploy PDF",
      "Cloudflare API token fingerprint secret hash",
    ],
    expectedPages: [],
    requiredFactGroups: [],
    expectAbstention: true,
  },
  {
    id: "difficult-bengal-control",
    category: "difficult",
    question: "Trace the relationship between the Battle of Plassey, the Battle of Buxar, the Treaty of Allahabad and the East India Company's Diwani rights in Bengal.",
    queryCandidates: [
      "Battle of Plassey 1757 Battle of Buxar 1764 Treaty of Allahabad 1765 Diwani Bengal",
      "Plassey Buxar Allahabad treaty 1765 Diwani revenue rights Bengal Bihar Orissa",
    ],
    expectedPages: [168],
    requiredFactGroups: [["1757"], ["1764"], ["1765"], ["Diwani"], ["Buxar"]],
  },
  {
    id: "short-article-79-lookup",
    category: "concept",
    question: "What is Article 79?",
    queryCandidates: ["What is Article 79?", "Article 79 Indian Constitution"],
    expectedPages: [227],
    requiredFactGroups: [["President"], ["Rajya Sabha"], ["Lok Sabha"]],
  },
  {
    id: "abbreviated-fr-dpsp-comparison",
    category: "comparison",
    question: "What is the difference between FR and DPSP, and which Parts of the Constitution contain them?",
    queryCandidates: [
      "What is the difference between FR and DPSP?",
      "Fundamental Rights versus Directive Principles enforceability",
    ],
    expectedPages: [213, 218],
    requiredFactGroups: [["Part III"], ["Part IV"], ["justiciable"], ["non-justiciable"]],
  },
  {
    id: "subsidiary-alliance-natural-question",
    category: "exact_fact",
    question: "Who introduced the Subsidiary Alliance?",
    queryCandidates: ["Who introduced the Subsidiary Alliance?", "Lord Wellesley Subsidiary Alliance 1798"],
    expectedPages: [169],
    requiredFactGroups: [["Lord Wellesley"], ["1798"]],
  },
  {
    id: "first-governor-general-bengal",
    category: "exact_fact",
    question: "Who was the first Governor-General of Bengal?",
    queryCandidates: ["Who was the first Governor-General of Bengal?", "Warren Hastings first Governor General of Bengal"],
    expectedPages: [197],
    requiredFactGroups: [["Warren Hastings"], ["first Governor General of Bengal"]],
  },
  {
    id: "cornwallis-land-revenue-question",
    category: "exact_fact",
    question: "Which land revenue system did Lord Cornwallis introduce?",
    queryCandidates: ["Which land revenue system did Lord Cornwallis introduce?", "Lord Cornwallis Permanent Settlement 1793"],
    expectedPages: [174],
    requiredFactGroups: [["Permanent Settlement"], ["1793"]],
  },
  {
    id: "plassey-cause-explanation",
    category: "concept",
    question: "Why did the British win the Battle of Plassey?",
    queryCandidates: ["Why did the British win the Battle of Plassey?", "Battle of Plassey Mir Jafar joined hands with British"],
    expectedPages: [168],
    requiredFactGroups: [["Mir Jafar"], ["Robert Clive"], ["joined hands", "betray"]],
  },
];

export interface FatmanReleaseQaAnswer {
  answer: string;
  estimatedCostMicrousd?: number;
}

export interface FatmanReleaseQaDependencies {
  retrieve(query: string): Promise<FatmanBookContext>;
  answer(question: string, context: FatmanBookContext, repairHint?: string): Promise<FatmanReleaseQaAnswer>;
}

export interface FatmanReleaseQaCaseResult {
  id: string;
  category: FatmanReleaseQaCase["category"];
  status: "passed" | "failed";
  retrievalStatus: "passed" | "failed";
  answerStatus: "passed" | "failed" | "not_run";
  expectedPages: number[];
  retrievedPages: number[];
  citedPages: number[];
  matchedFactGroups: number;
  requiredFactGroups: number;
  queryCount: number;
  generationAttempts: number;
  estimatedCostMicrousd: number;
  error?: string;
  answerExcerpt?: string;
}

export interface FatmanReleaseQaReport {
  runId: string;
  suiteVersion: string;
  documentVersion: string;
  status: "passed" | "failed";
  startedAt: number;
  completedAt: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  queryCount: number;
  generationAttempts: number;
  estimatedCostMicrousd: number;
  results: FatmanReleaseQaCaseResult[];
}

const ANSWER_REPAIR_HINT = [
  "QA REPAIR PASS: Re-read all supplied Fatman excerpts and answer every part of the student's question that those excerpts support.",
  "Be explicit about the distinguishing facts, dates, names, and cause/effect relationship when they appear in the excerpts.",
  "If the excerpts do not support a requested detail, say that it is not stated. Do not use outside knowledge to fill gaps.",
  "Keep the answer under 100 words or four short sentences unless the question explicitly asks for a longer explanation.",
  "For any comparison of constitutional concepts, explicitly state the relevant Part or Article for each concept when it appears in the retrieved excerpts.",
].join(" ");

const ABSTENTION_MARKERS = [
  "not found", "not stated", "not mentioned", "not available in the retrieved",
  "not in the retrieved", "does not contain", "no information", "cannot confirm",
  "can't confirm", "could not find", "couldn't find", "fatman pages do not",
  "fatman pages don't", "excerpts do not establish",
];

export async function runFatmanReleaseQa(
  dependencies: FatmanReleaseQaDependencies,
  input: { runId: string; documentVersion: string; startedAt?: number },
): Promise<FatmanReleaseQaReport> {
  const startedAt = input.startedAt ?? Date.now();
  const results: FatmanReleaseQaCaseResult[] = [];

  for (const qaCase of FATMAN_RELEASE_QA_CASES) {
    results.push(await runCase(dependencies, qaCase));
  }

  const completedAt = Date.now();
  const passedCases = results.filter((result) => result.status === "passed").length;
  return {
    runId: input.runId,
    suiteVersion: FATMAN_RELEASE_QA_SUITE_VERSION,
    documentVersion: input.documentVersion,
    status: passedCases === FATMAN_RELEASE_QA_CASES.length ? "passed" : "failed",
    startedAt,
    completedAt,
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    queryCount: results.reduce((total, result) => total + result.queryCount, 0),
    generationAttempts: results.reduce((total, result) => total + result.generationAttempts, 0),
    estimatedCostMicrousd: results.reduce((total, result) => total + result.estimatedCostMicrousd, 0),
    results,
  };
}

async function runCase(
  dependencies: FatmanReleaseQaDependencies,
  qaCase: FatmanReleaseQaCase,
): Promise<FatmanReleaseQaCaseResult> {
  const contexts: FatmanBookContext[] = [];
  let queryCount = 0;
  let generationAttempts = 0;
  let estimatedCostMicrousd = 0;
  let retrievalError: string | undefined;

  // Retrieval specialist: try the primary query and deterministic repair queries
  // until all expected pages are present or the bounded candidate list is used.
  for (const query of qaCase.queryCandidates) {
    try {
      const context = await dependencies.retrieve(query);
      queryCount += Math.max(1, Math.floor(context.searchCount ?? 1));
      contexts.push(context);
    } catch (error) {
      queryCount += 1;
      retrievalError = error instanceof Error ? error.message : String(error);
      continue;
    }
    const current = mergeFatmanContexts(contexts);
    if (!qaCase.expectAbstention && includesAllPages(current, qaCase.expectedPages)) break;
  }

  const bookContext = mergeFatmanContexts(contexts);
  const retrievedPages = uniquePages(bookContext);
  const retrievalStatus = qaCase.expectAbstention
    ? (bookContext.passages.length === 0 ? "passed" : "failed")
    : (includesAllPages(bookContext, qaCase.expectedPages) ? "passed" : "failed");

  if (retrievalStatus === "failed") {
    return {
      id: qaCase.id,
      category: qaCase.category,
      status: "failed",
      retrievalStatus,
      answerStatus: "not_run",
      expectedPages: qaCase.expectedPages,
      retrievedPages,
      citedPages: [],
      matchedFactGroups: 0,
      requiredFactGroups: qaCase.requiredFactGroups.length,
      queryCount,
      generationAttempts,
      estimatedCostMicrousd,
      error: retrievalError ?? (qaCase.expectAbstention
        ? "Out-of-book query retrieved a potentially relevant book passage."
        : "Expected source pages were not retrieved."),
    };
  }

  // Answer QA specialist: generate once from retrieved evidence. If fact coverage
  // is incomplete, one bounded repair pass gets the same evidence and stricter instructions.
  let answerText = "";
  let answerStatus: "passed" | "failed" = "failed";
  let matchedFactGroups = 0;
  let citedPages: number[] = [];
  let answerError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    generationAttempts += 1;
    let generated: FatmanReleaseQaAnswer;
    try {
      generated = await dependencies.answer(
        qaCase.question,
        bookContext,
        attempt === 1 ? ANSWER_REPAIR_HINT : undefined,
      );
    } catch (error) {
      answerText = "";
      answerStatus = "failed";
      answerError = error instanceof Error ? error.message : String(error);
      if (error && typeof error === "object") {
        const detail = error as { retryable?: boolean; usageRecords?: Array<{ estimatedCostMicrousd?: number }> };
        estimatedCostMicrousd += (detail.usageRecords ?? []).reduce(
          (total, usage) => total + Math.max(0, Math.floor(usage.estimatedCostMicrousd ?? 0)),
          0,
        );
        if (attempt === 0 && detail.retryable === true) continue;
      }
      break;
    }
    estimatedCostMicrousd += Math.max(0, Math.floor(generated.estimatedCostMicrousd ?? 0));
    answerText = generated.answer.trim().slice(0, 3_900);
    const citations = formatFatmanCitations(bookContext.passages, qaCase.question, answerText);
    const combined = answerText + (citations ? "\n\n" + citations : "");
    citedPages = pagesMentionedByCitation(combined);

    if (qaCase.expectAbstention) {
      answerStatus = isSafeFatmanAbstention(answerText) ? "passed" : "failed";
      matchedFactGroups = answerStatus === "passed" ? 1 : 0;
    } else {
      matchedFactGroups = countMatchedFactGroups(answerText, qaCase.requiredFactGroups);
      const factsPassed = matchedFactGroups === qaCase.requiredFactGroups.length;
      const citationsPassed = qaCase.expectedPages.every((page) => citedPages.includes(page));
      answerStatus = factsPassed && citationsPassed ? "passed" : "failed";
    }
    if (answerStatus === "passed") break;
  }

  return {
    id: qaCase.id,
    category: qaCase.category,
    status: retrievalStatus === "passed" && answerStatus === "passed" ? "passed" : "failed",
    retrievalStatus,
    answerStatus,
    expectedPages: qaCase.expectedPages,
    retrievedPages,
    citedPages,
    matchedFactGroups,
    requiredFactGroups: qaCase.expectAbstention ? 1 : qaCase.requiredFactGroups.length,
    queryCount,
    generationAttempts,
    estimatedCostMicrousd,
    ...(answerStatus === "failed" ? { error: answerError ?? (qaCase.expectAbstention
      ? "The answer did not clearly abstain from unsupported book claims."
      : "The answer missed required facts or failed to cite its verified source pages.") } : {}),
    ...(answerText ? { answerExcerpt: answerText.slice(0, 600) } : {}),
  };
}

function includesAllPages(context: FatmanBookContext, expected: number[]): boolean {
  const actual = new Set(uniquePages(context));
  return expected.every((page) => actual.has(page));
}

function uniquePages(context: FatmanBookContext): number[] {
  return [...new Set(context.passages.map((passage) => passage.pdfPage))].sort((a, b) => a - b);
}

function pagesMentionedByCitation(value: string): number[] {
  return [...new Set([...value.matchAll(/PDF p\.\s*(\d{1,6})/giu)].map((match) => Number(match[1])))];
}

function countMatchedFactGroups(answer: string, groups: string[][]): number {
  const normalized = normalizeForFactMatch(answer);
  return groups.filter((group) => group.some((phrase) => {
    const candidate = normalizeForFactMatch(phrase);
    return candidate.length > 0 && normalized.includes(candidate);
  })).length;
}

function normalizeForFactMatch(value: string): string {
  return value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function isSafeFatmanAbstention(answer: string): boolean {
  const normalized = answer.toLowerCase();
  const statesUnsupported = ABSTENTION_MARKERS.some((marker) => normalized.includes(marker));
  const inventedFingerprint = /\b[a-f0-9]{24,}\b/iu.test(answer);
  return statesUnsupported && !inventedFingerprint;
}
