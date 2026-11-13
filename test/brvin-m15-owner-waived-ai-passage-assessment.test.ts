import { describe, expect, it } from "vitest";
// The Vitest/Workers test runtime bundles JSON fixtures; Node fs is unavailable
// inside the isolated Worker test module.
import assessmentJson from "./fixtures/brvin-m15-owner-waived-ai-passage-assessment.json";

type Candidate = {
  reviewerA: { grade: number | null; rationale: string | null };
  reviewerB: { grade: number | null; rationale: string | null };
  adjudicatedGrade: number | null;
  score?: number;
  text?: string;
  ownerApprovedAiAssessment?: {
    grade: number;
    rationale: string;
    evaluator: string;
    assessmentType: string;
  };
};
type Query = {
  queryId: string;
  category: string;
  query: string;
  providers: Record<string, Candidate[]>;
};
type Assessment = {
  status: string;
  candidateCount: number;
  queries: Query[];
  aiAssessment: {
    status: string;
    assessedCandidateCount: number;
    providerMetrics: Record<string, {
      positiveQueryCount: number;
      positiveQueriesWithGrade2PlusInTop5: number;
      positiveReturnedCandidateCount: number;
      positiveGrade2PlusCandidateCount: number;
      positivePrecisionAmongReturnedCandidates: number | null;
      positivePrecisionAtFixedK5: number;
      meanNdcgAt5: number;
      meanReciprocalRankGrade2Plus: number;
      outOfCorpusReturnedCandidateCount: number;
      outOfCorpusGrade2PlusCandidateCount: number;
    }>;
  };
};

const assessment = assessmentJson as unknown as Assessment;

const dcg = (grades: number[]): number =>
  grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);

describe("M15 owner-waived AI passage assessment", () => {
  it("assesses every saved candidate while leaving the independent reviewer fields untouched", () => {
    let count = 0;
    for (const query of assessment.queries) {
      for (const candidates of Object.values(query.providers)) {
        for (const candidate of candidates) {
          count += 1;
          expect(candidate.ownerApprovedAiAssessment).toBeDefined();
          expect(candidate.ownerApprovedAiAssessment?.grade).toBeGreaterThanOrEqual(0);
          expect(candidate.ownerApprovedAiAssessment?.grade).toBeLessThanOrEqual(3);
          expect(candidate.ownerApprovedAiAssessment?.rationale.length).toBeGreaterThan(10);
          expect(candidate.reviewerA).toEqual({ grade: null, rationale: null });
          expect(candidate.reviewerB).toEqual({ grade: null, rationale: null });
          expect(candidate.adjudicatedGrade).toBeNull();
        }
      }
    }
    expect(count).toBe(109);
    expect(assessment.candidateCount).toBe(109);
    expect(assessment.aiAssessment.assessedCandidateCount).toBe(109);
    expect(assessment.status).toBe("owner_waived_ai_assessment_complete_not_independent_human_qrels");
    expect(assessment.aiAssessment.status).toBe("owner_approved_ai_assessment_complete_not_independent_human_qrels");
  });

  it("reproduces the positive-query precision, nDCG and MRR summaries from the stored labels", () => {
    for (const provider of ["cloudflare-ai-search", "qdrant-vertex"]) {
      const queries = assessment.queries.filter((query) => query.category === "positive");
      const perQuery = queries.map((query) =>
        (query.providers[provider] ?? []).map((candidate) => candidate.ownerApprovedAiAssessment!.grade),
      );
      const flattened = perQuery.flat();
      const relevant = flattened.filter((grade) => grade >= 2).length;
      const returned = flattened.length;
      const hits = perQuery.filter((grades) => grades.some((grade) => grade >= 2)).length;
      const ndcgValues = perQuery.map((grades) => {
        const ideal = [...grades].sort((a, b) => b - a);
        const denominator = dcg(ideal);
        return denominator === 0 ? 0 : dcg(grades) / denominator;
      });
      const reciprocalRanks = perQuery.map((grades) => {
        const index = grades.findIndex((grade) => grade >= 2);
        return index < 0 ? 0 : 1 / (index + 1);
      });
      const stored = assessment.aiAssessment.providerMetrics[provider];

      expect(stored.positiveQueryCount).toBe(12);
      expect(stored.positiveQueriesWithGrade2PlusInTop5).toBe(hits);
      expect(stored.positiveReturnedCandidateCount).toBe(returned);
      expect(stored.positiveGrade2PlusCandidateCount).toBe(relevant);
      expect(stored.positivePrecisionAmongReturnedCandidates).toBeCloseTo(relevant / returned, 10);
      expect(stored.positivePrecisionAtFixedK5).toBeCloseTo(relevant / 60, 10);
      expect(stored.meanNdcgAt5).toBeCloseTo(ndcgValues.reduce((a, b) => a + b, 0) / 12, 10);
      expect(stored.meanReciprocalRankGrade2Plus).toBeCloseTo(reciprocalRanks.reduce((a, b) => a + b, 0) / 12, 10);
    }
  });
});

type GateFeature = (query: Query, candidate: Candidate) => number;
const GATE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "calculate", "does", "do",
  "for", "from", "how", "if", "in", "is", "it", "its", "may", "of", "on", "or",
  "show", "that", "the", "their", "then", "this", "to", "use", "what", "when",
  "which", "with", "would", "explain", "describe", "compare", "difference", "between",
  "into", "through", "about", "has", "have", "not", "only", "same", "one", "each",
]);
function qdrantCandidates(query: Query): Candidate[] { return query.providers["qdrant-vertex"] ?? []; }
function assessedGrade(candidate: Candidate): number { return candidate.ownerApprovedAiAssessment?.grade ?? -1; }
function queryTerms(value: string): string[] {
  const tokens = value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?|[0-9]+(?:\.[0-9]+)?/gu) ?? [];
  return [...new Set(tokens)].filter((term) => term.length > 1 && !GATE_STOP_WORDS.has(term));
}
const rrfScoreFeature: GateFeature = (_query, candidate) => candidate.score ?? 0;
const lexicalCoverageFeature: GateFeature = (query, candidate) => {
  const terms = queryTerms(query.query);
  if (!terms.length || !candidate.text) return 0;
  const passageTerms = new Set(queryTerms(candidate.text));
  return terms.filter((term) => passageTerms.has(term)).length / terms.length;
};
function fitExploratoryThreshold(training: Query[], feature: GateFeature): number {
  const positives = training.filter((query) => query.category === "positive");
  const negatives = training.filter((query) => query.category === "out-of-corpus");
  const thresholds = [...new Set([0, ...training.flatMap((query) =>
    qdrantCandidates(query).map((candidate) => feature(query, candidate))
  )])].filter(Number.isFinite).sort((a, b) => a - b);
  const feasible = thresholds.filter((threshold) => positives.every((query) =>
    qdrantCandidates(query).some((candidate) => assessedGrade(candidate) >= 2 && feature(query, candidate) >= threshold)
  ));
  if (!feasible.length) throw new Error("No threshold preserves every training positive.");
  let best: number | null = null, bestCleared = -1;
  for (const threshold of feasible) {
    const cleared = negatives.filter((query) =>
      qdrantCandidates(query).every((candidate) => feature(query, candidate) < threshold)
    ).length;
    if (cleared > bestCleared || (cleared === bestCleared && threshold > (best ?? -Infinity))) {
      best = threshold; bestCleared = cleared;
    }
  }
  if (best === null) throw new Error("The exploratory threshold could not be selected.");
  return best;
}
function leaveOneQueryOut(queries: Query[], feature: GateFeature) {
  return queries.map((held) => {
    const threshold = fitExploratoryThreshold(queries.filter((query) => query.queryId !== held.queryId), feature);
    const kept = qdrantCandidates(held).filter((candidate) => feature(held, candidate) >= threshold);
    return {
      queryId: held.queryId, category: held.category,
      keptGrade2Plus: kept.some((candidate) => assessedGrade(candidate) >= 2),
      candidateCount: kept.length,
    };
  });
}
describe("M15 exploratory relevance-gate feasibility (offline only)", () => {
  const queries = assessment.queries;
  const summarize = (threshold: number) => ({
    positiveKept: queries.filter((query) => query.category === "positive" &&
      qdrantCandidates(query).some((candidate) => assessedGrade(candidate) >= 2 && (candidate.score ?? 0) >= threshold)
    ).length,
    negativesCleared: queries.filter((query) => query.category === "out-of-corpus" &&
      qdrantCandidates(query).every((candidate) => (candidate.score ?? 0) < threshold)
    ).length,
    h01Kept: qdrantCandidates(queries.find((query) => query.category === "exact-symbol-near-miss")!)
      .some((candidate) => assessedGrade(candidate) >= 2 && (candidate.score ?? 0) >= threshold),
  });
  it("shows a fixed RRF cutoff trades positive recall against no-match noise", () => {
    expect(summarize(0.38)).toEqual({ positiveKept: 12, negativesCleared: 3, h01Kept: true });
    expect(summarize(0.42)).toEqual({ positiveKept: 11, negativesCleared: 4, h01Kept: true });
  });
  it("rejects single-feature gates under leave-one-query-out calibration", () => {
    const score = leaveOneQueryOut(queries, rrfScoreFeature);
    const lexical = leaveOneQueryOut(queries, lexicalCoverageFeature);
    const summary = (rows: typeof score) => ({
      positiveKept: rows.filter((row) => row.category === "positive" && row.keptGrade2Plus).length,
      negativesCleared: rows.filter((row) => row.category === "out-of-corpus" && row.candidateCount === 0).length,
      h01Kept: rows.find((row) => row.category === "exact-symbol-near-miss")?.keptGrade2Plus,
      falseAbstentions: rows.filter((row) => row.category === "positive" && !row.keptGrade2Plus).map((row) => row.queryId),
    });
    expect(summary(score)).toEqual({
      positiveKept: 11, negativesCleared: 3, h01Kept: true, falseAbstentions: ["P02"],
    });
    expect(summary(lexical)).toEqual({
      positiveKept: 11, negativesCleared: 4, h01Kept: true, falseAbstentions: ["P06"],
    });
  });
  it("keeps owner-waived AI grades distinct from independent human qrels", () => {
    expect(assessment.status).toBe("owner_waived_ai_assessment_complete_not_independent_human_qrels");
    expect(queries.flatMap((query) => qdrantCandidates(query)).every((candidate) =>
      candidate.reviewerA.grade === null && candidate.reviewerB.grade === null && candidate.adjudicatedGrade === null
    )).toBe(true);
  });
});
