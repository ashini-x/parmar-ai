import { describe, expect, it } from "vitest";
// The Vitest/Workers test runtime bundles JSON fixtures; Node fs is unavailable
// inside the isolated Worker test module.
// @ts-expect-error JSON fixture import is handled by the Vite test transformer.
import assessmentJson from "./fixtures/brvin-m15-owner-waived-ai-passage-assessment.json";

type Candidate = {
  reviewerA: { grade: number | null; rationale: string | null };
  reviewerB: { grade: number | null; rationale: string | null };
  adjudicatedGrade: number | null;
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
    expect(assessment.aiAssessment.status).toBe(assessment.status);
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
