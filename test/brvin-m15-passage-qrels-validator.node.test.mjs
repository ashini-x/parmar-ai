import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateM15PassageQrels } from "../scripts/validate-brvin-m15-passage-qrels.mjs";

const preparedPack = JSON.parse(
  await readFile(
    new URL(
      "./fixtures/brvin-m15-passage-qrels-review-pack.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function candidate(candidateId, provider, rank, grade) {
  const annotation = {
    grade,
    rationale: `Grade ${grade} is supported by the judged passage.`,
  };
  return {
    candidateId,
    provider,
    rank,
    reviewerA: { ...annotation },
    reviewerB: { ...annotation },
    adjudicatedGrade: grade,
  };
}

function completedPack() {
  const sha256 = "a".repeat(64);
  const reviewer = (reviewerId) => ({
    reviewerId,
    reviewerType: "independent-human",
    reviewedSourceSha256: sha256,
    submittedAt: "2026-11-14T10:00:00.000Z",
    submittedBlindlyBeforeComparison: true,
  });
  return {
    schemaVersion: 1,
    status: "adjudicated_independent_human_qrels_complete",
    source: { sha256 },
    candidateCount: 4,
    independentReviewRequirements: {
      reviewerCount: 2,
      reviewIndependently: true,
      noModelLabelsPrepopulated: true,
      resolveDisagreements: true,
    },
    reviewerAttestations: {
      reviewerA: reviewer("reviewer-a"),
      reviewerB: reviewer("reviewer-b"),
    },
    queries: [
      {
        queryId: "Q01",
        query: "Synthetic test question",
        providers: {
          "cloudflare-ai-search": [
            candidate("A1", "cloudflare-ai-search", 1, 3),
            candidate("A2", "cloudflare-ai-search", 2, 0),
          ],
          "qdrant-vertex": [
            candidate("Q1", "qdrant-vertex", 1, 0),
            candidate("Q2", "qdrant-vertex", 2, 3),
          ],
        },
      },
    ],
  };
}

describe("M15 passage qrels validator", () => {
  it("keeps the existing review pack valid but incomplete until independent annotations arrive", () => {
    const report = validateM15PassageQrels(preparedPack);

    expect(report.valid).toBe(true);
    expect(report.complete).toBe(false);
    expect(report.completion.queryCount).toBe(17);
    expect(report.completion.candidateCount).toBe(109);
    expect(report.completion.pendingReviewerAttestations).toBe(2);
    expect(report.completion.missing.reviewerAGrades).toBe(109);
    expect(report.completion.missing.reviewerBGrades).toBe(109);
    expect(report.completion.missing.adjudicatedGrades).toBe(109);
    expect(report.metrics).toBeNull();
  });

  it("scores completed independent annotations without a provider decision", () => {
    const report = validateM15PassageQrels(completedPack());

    expect(report.valid).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.metrics.scope).toContain("no full-corpus recall");
    expect(
      report.metrics.providers["cloudflare-ai-search"].ndcgAt5,
    ).toBeCloseTo(1);
    expect(report.metrics.providers["cloudflare-ai-search"].mrrAt5).toBe(1);
    expect(
      report.metrics.providers["cloudflare-ai-search"].precisionAt5,
    ).toBeCloseTo(0.2);
    expect(report.metrics.providers["qdrant-vertex"].ndcgAt5).toBeCloseTo(
      1 / Math.log2(3),
    );
    expect(report.metrics.providers["qdrant-vertex"].mrrAt5).toBe(0.5);
    expect(report.metrics.providers["qdrant-vertex"].precisionAt5).toBeCloseTo(
      0.2,
    );
  });

  it("requires separate reviewer identities and adjudication rationale for disagreements", () => {
    const pack = completedPack();
    pack.reviewerAttestations.reviewerB.reviewerId = "reviewer-a";
    const disputed = pack.queries[0].providers["qdrant-vertex"][1];
    disputed.reviewerB.grade = 2;
    disputed.reviewerB.rationale = "The passage is only partial support.";

    const report = validateM15PassageQrels(pack);

    expect(report.valid).toBe(false);
    expect(report.complete).toBe(false);
    expect(report.metrics).toBeNull();
    expect(report.errors).toContain(
      "reviewer attestations must use distinct pseudonymous reviewer IDs",
    );
    expect(report.completion.missing.adjudicationRationales).toBe(1);
  });

  it("rejects grades outside the declared 0-to-3 rubric", () => {
    const pack = completedPack();
    pack.queries[0].providers["cloudflare-ai-search"][0].reviewerA.grade = 4;

    const report = validateM15PassageQrels(pack);

    expect(report.valid).toBe(false);
    expect(
      report.errors.some((error) =>
        error.includes("reviewerA.grade must be an integer from 0 to 3"),
      ),
    ).toBe(true);
  });

  it("requires a timezone-bearing ISO submission timestamp", () => {
    const pack = completedPack();
    pack.reviewerAttestations.reviewerA.submittedAt = "tomorrow morning";

    const report = validateM15PassageQrels(pack);

    expect(report.valid).toBe(false);
    expect(report.complete).toBe(false);
    expect(report.completion.pendingReviewerAttestations).toBe(1);
  });

  it("rejects rank gaps that would distort top-five metrics", () => {
    const pack = completedPack();
    pack.queries[0].providers["cloudflare-ai-search"][1].rank = 3;

    const report = validateM15PassageQrels(pack);

    expect(report.valid).toBe(false);
    expect(
      report.errors.some((error) =>
        error.includes("candidate ranks must be contiguous from 1"),
      ),
    ).toBe(true);
  });
});
