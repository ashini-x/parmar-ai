import { describe, expect, it, vi } from "vitest";
import {
  FATMAN_RELEASE_QA_CASES,
  FATMAN_RELEASE_QA_SUITE_VERSION,
  runFatmanReleaseQa,
  type FatmanReleaseQaDependencies,
} from "../src/fatman/release-qa";
import type { FatmanBookContext } from "../src/fatman/retrieval";

function context(pages: number[]): FatmanBookContext {
  return {
    pageImages: [],
    passages: pages.map((page) => ({
      id: "page-" + page,
      pdfPage: page,
      text: "Fatman page " + page + " source material",
      score: 0.9,
    })),
  };
}

function answerFor(question: string): string {
  if (question.includes("Trace the relationship")) {
    return "The Battle of Plassey took place in 1757, the Battle of Buxar in 1764, and the Treaty of Allahabad in 1765. The treaty granted the East India Company Diwani revenue rights.";
  }
  if (question.includes("Battle of Plassey")) {
    return "The Battle of Plassey was fought by East India Company forces led by Robert Clive against Siraj-ud-Daulah, the Nawab of Bengal.";
  }
  if (question.includes("integral part of Parliament")) {
    return "The President is an integral part of Parliament because no Bill becomes law without the President's assent.";
  }
  if (question.includes("Compare Fundamental Rights")) {
    return "Fundamental Rights in Part III are justiciable and legally enforceable, promoting political democracy. Directive Principles in Part IV are non-justiciable and support social and economic democracy and a welfare state.";
  }
  if (question.includes("exact SHA-256")) {
    return "The exact SHA-256 fingerprint is not found in the retrieved Fatman pages, so I cannot confirm it.";
  }
  return "Robert Clive and Siraj-ud-Daulah were involved in the Battle of Plassey.";
}

function goodDependencies(): FatmanReleaseQaDependencies {
  return {
    retrieve: async (query) => {
      if (query.includes("SHA-256")) return context([]);
      if (query.includes("President")) return context([227]);
      if (query.includes("Fundamental Rights") && query.includes("Directive Principles")) return context([213, 218]);
      if (query.includes("Treaty") || query.includes("Buxar")) return context([168]);
      if (query.includes("Plassey") || query.includes("Robert Clive")) return context([168]);
      return context([]);
    },
    answer: async (question) => ({ answer: answerFor(question), estimatedCostMicrousd: 125 }),
  };
}

describe("Fatman real-user release QA", () => {
  it("contains all six user-facing QA categories", () => {
    expect(FATMAN_RELEASE_QA_SUITE_VERSION).toBe("fatman-real-user-qa-v1");
    expect(new Set(FATMAN_RELEASE_QA_CASES.map((item) => item.category))).toEqual(new Set([
      "exact_fact", "concept", "comparison", "page_reference", "out_of_book", "difficult",
    ]));
    expect(FATMAN_RELEASE_QA_CASES).toHaveLength(6);
  });

  it("passes exact facts, concepts, comparisons, page references, abstention and a multi-step question", async () => {
    const report = await runFatmanReleaseQa(goodDependencies(), {
      runId: "qa-test-0001",
      documentVersion: "fatman-test-v1",
    });
    expect(report.status).toBe("passed");
    expect(report.passedCases).toBe(6);
    expect(report.failedCases).toBe(0);
    expect(report.totalCases).toBe(6);
    expect(report.queryCount).toBeGreaterThanOrEqual(6);
    expect(report.estimatedCostMicrousd).toBeGreaterThan(0);
    expect(report.results.map((item) => item.id)).toEqual(FATMAN_RELEASE_QA_CASES.map((item) => item.id));
  });

  it("uses a bounded answer-repair pass when fact coverage is incomplete", async () => {
    const answer = vi.fn(async (question: string) => ({ answer: answerFor(question) }));
    answer.mockImplementationOnce(async () => ({ answer: "The Battle happened in Bengal." }));
    const retrieval = goodDependencies().retrieve;
    const report = await runFatmanReleaseQa({
      retrieve: retrieval,
      answer,
    }, { runId: "qa-test-0002", documentVersion: "fatman-test-v1" });
    const exact = report.results.find((item) => item.id === "exact-plassey-fact");
    expect(exact?.status).toBe("passed");
    expect(exact?.generationAttempts).toBe(2);
    expect(answer).toHaveBeenCalledTimes(7);
    expect(answer.mock.calls[1]?.[2]).toContain("QA REPAIR PASS");
  });

  it("fails closed when required source pages or fact groups are absent", async () => {
    const deps = {
      retrieve: async () => context([999]),
      answer: async () => ({ answer: "Unsupported answer" }),
    };
    const report = await runFatmanReleaseQa(deps, {
      runId: "qa-test-0003",
      documentVersion: "fatman-test-v1",
    });
    expect(report.status).toBe("failed");
    expect(report.failedCases).toBeGreaterThan(0);
    expect(report.results.every((item) => item.retrievalStatus === "failed")).toBe(true);
  });

  it("does not accept a made-up fingerprint as a valid out-of-book abstention", async () => {
    const deps = goodDependencies();
    deps.answer = async (question) => ({
      answer: question.includes("exact SHA-256")
        ? "The fingerprint is abcdef0123456789abcdef0123456789abcdef0123456789."
        : answerFor(question),
    });
    const report = await runFatmanReleaseQa(deps, {
      runId: "qa-test-0004",
      documentVersion: "fatman-test-v1",
    });
    const outOfBook = report.results.find((item) => item.id === "out-of-book-secret-fingerprint");
    expect(outOfBook?.status).toBe("failed");
    expect(outOfBook?.answerStatus).toBe("failed");
  });
});
