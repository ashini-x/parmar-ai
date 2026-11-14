import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const VALID_GRADES = new Set([0, 1, 2, 3]);
const REVIEWERS = ["reviewerA", "reviewerB"];
const COMPLETED_STATUS = "adjudicated_independent_human_qrels_complete";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value) {
  return (
    nonEmptyString(value) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function candidateList(pack) {
  const candidates = [];
  for (const query of Array.isArray(pack?.queries) ? pack.queries : []) {
    if (!isRecord(query?.providers)) continue;
    for (const [provider, providerCandidates] of Object.entries(
      query.providers,
    )) {
      if (!Array.isArray(providerCandidates)) continue;
      for (const candidate of providerCandidates) {
        candidates.push({ queryId: query.queryId, provider, candidate });
      }
    }
  }
  return candidates;
}

function reviewerAttestationStatus(pack, reviewer) {
  const value = pack?.reviewerAttestations?.[reviewer];
  const expectedSource = pack?.source?.sha256;
  if (!isRecord(value)) return { complete: false, invalid: false };

  const supplied = [
    value.reviewerId,
    value.reviewerType,
    value.reviewedSourceSha256,
    value.submittedAt,
    value.submittedBlindlyBeforeComparison,
  ].some((field) => field !== null && field !== undefined && field !== "");
  if (!supplied) return { complete: false, invalid: false };

  const valid =
    nonEmptyString(value.reviewerId) &&
    value.reviewerType === "independent-human" &&
    value.reviewedSourceSha256 === expectedSource &&
    isIsoTimestamp(value.submittedAt) &&
    value.submittedBlindlyBeforeComparison === true;
  return { complete: valid, invalid: !valid };
}

function dcgAt5(grades) {
  return grades.slice(0, 5).reduce((sum, grade, index) => {
    const gain = 2 ** grade - 1;
    return sum + gain / Math.log2(index + 2);
  }, 0);
}

function summarizeProvider(pack, providerName) {
  const rows = [];
  for (const query of pack.queries) {
    const candidates = [...(query.providers[providerName] ?? [])].sort(
      (left, right) => left.rank - right.rank,
    );
    const grades = candidates.map((candidate) => candidate.adjudicatedGrade);
    const idealGrades = [...grades].sort((left, right) => right - left);
    const ideal = dcgAt5(idealGrades);
    const actual = dcgAt5(grades);
    const topFive = grades.slice(0, 5);
    const firstUseful = topFive.findIndex((grade) => grade >= 2);
    rows.push({
      ndcgAt5: ideal === 0 ? 0 : actual / ideal,
      mrrAt5: firstUseful < 0 ? 0 : 1 / (firstUseful + 1),
      precisionAt5: topFive.filter((grade) => grade >= 2).length / 5,
    });
  }

  const mean = (field) =>
    rows.length === 0
      ? 0
      : rows.reduce((total, row) => total + row[field], 0) / rows.length;
  return {
    queryCount: rows.length,
    ndcgAt5: mean("ndcgAt5"),
    mrrAt5: mean("mrrAt5"),
    precisionAt5: mean("precisionAt5"),
  };
}

/**
 * Validate recorded independent-human attestations without returning query or passage text.
 * Scores are provider-local over returned candidates; they do not estimate corpus
 * recall and are not a provider-selection or production-acceptance decision.
 */
export function validateM15PassageQrels(pack) {
  const errors = [];
  const missing = {
    reviewerAGrades: 0,
    reviewerARationales: 0,
    reviewerBGrades: 0,
    reviewerBRationales: 0,
    adjudicatedGrades: 0,
    adjudicationRationales: 0,
  };
  const candidates = candidateList(pack);

  if (!isRecord(pack)) errors.push("root must be an object");
  if (pack?.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (
    !isRecord(pack?.source) ||
    !/^[0-9a-f]{64}$/i.test(pack.source.sha256 ?? "")
  ) {
    errors.push("source.sha256 must be a 64-character hexadecimal fingerprint");
  }
  if (!Array.isArray(pack?.queries) || pack.queries.length === 0) {
    errors.push("queries must be a non-empty array");
  }
  if (
    pack?.independentReviewRequirements?.reviewerCount !== 2 ||
    pack.independentReviewRequirements.reviewIndependently !== true ||
    pack.independentReviewRequirements.noModelLabelsPrepopulated !== true ||
    pack.independentReviewRequirements.resolveDisagreements !== true
  ) {
    errors.push(
      "independent-review requirements must preserve two blind human reviewers, no model labels and adjudication",
    );
  }
  if (pack?.candidateCount !== candidates.length) {
    errors.push("candidateCount does not match the candidate inventory");
  }

  const queryIds = new Set();
  const candidateIds = new Set();
  for (const [queryIndex, query] of (Array.isArray(pack?.queries)
    ? pack.queries
    : []
  ).entries()) {
    const queryId = nonEmptyString(query?.queryId)
      ? query.queryId
      : `query-${queryIndex + 1}`;
    if (!nonEmptyString(query?.queryId))
      errors.push(`${queryId}: queryId is required`);
    if (queryIds.has(queryId)) errors.push(`${queryId}: duplicate queryId`);
    queryIds.add(queryId);
    if (!nonEmptyString(query?.query))
      errors.push(`${queryId}: query text is required in the source pack`);
    if (
      !isRecord(query?.providers) ||
      Object.keys(query.providers).length === 0
    ) {
      errors.push(`${queryId}: provider candidate lists are required`);
      continue;
    }

    for (const [providerName, providerCandidates] of Object.entries(
      query.providers,
    )) {
      if (!Array.isArray(providerCandidates)) {
        errors.push(`${queryId}/${providerName}: candidates must be an array`);
        continue;
      }
      const ranks = new Set();
      for (const [candidateIndex, candidate] of providerCandidates.entries()) {
        const candidateId = nonEmptyString(candidate?.candidateId)
          ? candidate.candidateId
          : `${queryId}/${providerName}/candidate-${candidateIndex + 1}`;
        const location = `${queryId}/${providerName}/${candidateId}`;
        if (!isRecord(candidate)) {
          errors.push(`${location}: candidate must be an object`);
          continue;
        }
        if (candidateIds.has(candidateId))
          errors.push(`${location}: duplicate candidateId`);
        candidateIds.add(candidateId);
        if (candidate.provider !== providerName)
          errors.push(`${location}: provider field does not match its list`);
        if (
          !Number.isSafeInteger(candidate.rank) ||
          candidate.rank < 1 ||
          ranks.has(candidate.rank)
        ) {
          errors.push(
            `${location}: rank must be a unique positive integer within this provider list`,
          );
        }
        ranks.add(candidate.rank);

        for (const reviewer of REVIEWERS) {
          const annotation = candidate[reviewer];
          if (!isRecord(annotation)) {
            errors.push(
              `${location}: ${reviewer} annotation must be an object`,
            );
            continue;
          }
          const gradeKey = reviewer + "Grades";
          const rationaleKey = reviewer + "Rationales";
          if (
            annotation.grade === null ||
            annotation.grade === undefined ||
            annotation.grade === ""
          ) {
            missing[gradeKey]++;
          } else if (!VALID_GRADES.has(annotation.grade)) {
            errors.push(
              `${location}: ${reviewer}.grade must be an integer from 0 to 3`,
            );
          }
          if (!nonEmptyString(annotation.rationale)) {
            missing[rationaleKey]++;
          }
        }

        const gradeA = candidate.reviewerA?.grade;
        const gradeB = candidate.reviewerB?.grade;
        const bothGradesValid =
          VALID_GRADES.has(gradeA) && VALID_GRADES.has(gradeB);
        if (
          candidate.adjudicatedGrade === null ||
          candidate.adjudicatedGrade === undefined ||
          candidate.adjudicatedGrade === ""
        ) {
          missing.adjudicatedGrades++;
        } else if (!VALID_GRADES.has(candidate.adjudicatedGrade)) {
          errors.push(
            `${location}: adjudicatedGrade must be an integer from 0 to 3`,
          );
        } else if (
          bothGradesValid &&
          gradeA === gradeB &&
          candidate.adjudicatedGrade !== gradeA
        ) {
          errors.push(
            `${location}: adjudicatedGrade must preserve matching independent grades`,
          );
        }
        if (
          bothGradesValid &&
          gradeA !== gradeB &&
          !nonEmptyString(candidate.adjudicationRationale)
        ) {
          missing.adjudicationRationales++;
        }
      }
      const sortedCandidates = [...providerCandidates].sort(
        (left, right) => (left?.rank ?? 0) - (right?.rank ?? 0),
      );
      sortedCandidates.forEach((candidate, index) => {
        if (candidate?.rank !== index + 1) {
          errors.push(
            `${queryId}/${providerName}: candidate ranks must be contiguous from 1`,
          );
        }
      });
    }
  }

  const attestationStates = Object.fromEntries(
    REVIEWERS.map((reviewer) => [
      reviewer,
      reviewerAttestationStatus(pack, reviewer),
    ]),
  );
  for (const reviewer of REVIEWERS) {
    if (attestationStates[reviewer].invalid) {
      errors.push(
        `${reviewer}: human, independent, source-fingerprint and blind-submission attestation is invalid`,
      );
    }
  }
  const reviewerIds = REVIEWERS.map(
    (reviewer) => pack?.reviewerAttestations?.[reviewer]?.reviewerId,
  );
  if (reviewerIds.every(nonEmptyString) && reviewerIds[0] === reviewerIds[1]) {
    errors.push(
      "reviewer attestations must use distinct pseudonymous reviewer IDs",
    );
  }

  const reviewerMetadataComplete = REVIEWERS.every(
    (reviewer) => attestationStates[reviewer].complete,
  );
  const annotationsComplete = Object.values(missing).every(
    (count) => count === 0,
  );
  const adjudicator = pack?.adjudication;
  const hasDisagreement = candidates.some(
    ({ candidate }) =>
      VALID_GRADES.has(candidate?.reviewerA?.grade) &&
      VALID_GRADES.has(candidate?.reviewerB?.grade) &&
      candidate.reviewerA.grade !== candidate.reviewerB.grade,
  );
  const adjudicationComplete =
    !hasDisagreement ||
    (isRecord(adjudicator) &&
      nonEmptyString(adjudicator.reviewerId) &&
      isIsoTimestamp(adjudicator.completedAt));
  if (hasDisagreement && !adjudicationComplete)
    errors.push(
      "adjudication reviewer and completion timestamp are required when reviewers disagree",
    );

  const valid = errors.length === 0;
  const complete =
    valid &&
    reviewerMetadataComplete &&
    annotationsComplete &&
    adjudicationComplete &&
    pack.status === COMPLETED_STATUS;
  const providerNames = new Set();
  for (const query of Array.isArray(pack?.queries) ? pack.queries : []) {
    if (isRecord(query?.providers))
      Object.keys(query.providers).forEach((name) => providerNames.add(name));
  }

  return {
    valid,
    complete,
    errors,
    completion: {
      queryCount: Array.isArray(pack?.queries) ? pack.queries.length : 0,
      candidateCount: candidates.length,
      pendingReviewerAttestations: REVIEWERS.filter(
        (reviewer) => !attestationStates[reviewer].complete,
      ).length,
      missing,
      requiredCompletedStatus: COMPLETED_STATUS,
    },
    metrics: complete
      ? {
          scope:
            "Provider-local ranked lists over returned judged candidates; no full-corpus recall or production decision.",
          providers: Object.fromEntries(
            [...providerNames]
              .sort()
              .map((provider) => [provider, summarizeProvider(pack, provider)]),
          ),
        }
      : null,
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write(
      "Usage: node scripts/validate-brvin-m15-passage-qrels.mjs <review-pack.json>\n",
    );
    process.exitCode = 2;
    return;
  }

  try {
    const pack = JSON.parse(await readFile(inputPath, "utf8"));
    const report = validateM15PassageQrels(pack);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (!report.valid) process.exitCode = 1;
  } catch {
    process.stderr.write(
      "Could not read or parse the qrels review pack. No source text was emitted.\n",
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
