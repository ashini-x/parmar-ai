/**
 * Fixed M14 evaluation suite for the existing three-page Physics pilot.
 * Positive page targets are grounded in the immutable source PDF whose SHA-256
 * is pinned below. The live smoke subset retains its prior-source-evidence
 * labels; cases independently reviewed against the original PDF are marked
 * ocr-ground-truth-verified. Negative/no-answer cases are reviewed but are
 * kept out of the positive page-coverage run until an abstention policy exists.
 */
export const BRVIN_M14_PHYSICS_PILOT = {
  projectId: "448249b4-fed9-45f5-9137-6014f242ddbe",
  sourceId: "01238b3a-9902-4a42-90b4-574048ee4f00",
  sourceTitle: "Force and Laws of Motion - Class IX pilot handout",
  sourceSha256: "062c7d111c987b3a75c6f9acb44696e38b64bfeaf203417156b21f7fe9de7f8c",
  pageCount: 3,
  sourceRef: "TCH-000001-PRJ-001-COL-001-SRC-003",
} as const;

export type BrvinM14PhysicsCaseCategory =
  | "conceptual"
  | "exact_formula"
  | "paraphrase"
  | "equivalent_notation"
  | "symbol_sensitive"
  | "worked_example"
  | "numerical_setup"
  | "mixed_theory_math"
  | "force_friction"
  | "bus_braking"
  | "no_answer";

export interface BrvinM14PhysicsQueryCase {
  id: string;
  category: BrvinM14PhysicsCaseCategory;
  query: string;
  expectedPdfPages: number[];
  verification: "prior-source-evidence" | "ocr-ground-truth-verified" | "pending-ocr-ground-truth";
  expectedExpression?: string;
  /** A reviewed negative case; excluded from positive page-coverage queries. */
  expectedNoMatch?: true;
  notes: string;
}

/**
 * No page label is inferred where the current operator evidence does not
 * establish one. M14 must inspect the immutable OCR before promoting pending
 * cases into the measured golden set.
 */
export const BRVIN_M14_PHYSICS_QUERY_SUITE: readonly BrvinM14PhysicsQueryCase[] = [
  {
    id: "newtons-second-law-concept",
    category: "conceptual",
    query: "Explain Newton's second law using net force, mass and acceleration.",
    expectedPdfPages: [2],
    verification: "prior-source-evidence",
    notes: "Two useful passages were returned by the protected v2 consumer from physical PDF page 2.",
  },
  {
    id: "newtons-second-law-exact-formula",
    category: "exact_formula",
    query: "What equation expresses Newton's second law of motion?",
    expectedPdfPages: [2],
    verification: "ocr-ground-truth-verified",
    expectedExpression: "Fnet = m × a",
    notes: "Physical PDF page 2 prints the governing equation as Fnet = m × a; preserve the net-force subscript and multiplication sign.",
  },
  {
    id: "net-force-paraphrase",
    category: "paraphrase",
    query: "How does an unbalanced force change the motion of an object?",
    expectedPdfPages: [2],
    verification: "ocr-ground-truth-verified",
    notes: "Physical PDF page 2 explains that acceleration follows the net-force direction and scales with net force at constant mass.",
  },
  {
    id: "force-mass-acceleration-equivalent-notation",
    category: "equivalent_notation",
    query: "State that resultant force is mass multiplied by acceleration.",
    expectedPdfPages: [2],
    verification: "ocr-ground-truth-verified",
    expectedExpression: "Fnet = m × a",
    notes: "Physical PDF page 2 states that resultant/net force equals mass multiplied by acceleration; retain the source expression Fnet = m × a.",
  },
  {
    id: "uppercase-force-symbol",
    category: "symbol_sensitive",
    query: "Find the source expression containing uppercase F in the second-law formula.",
    expectedPdfPages: [2],
    verification: "ocr-ground-truth-verified",
    expectedExpression: "Fnet",
    notes: "Physical PDF page 2 uses uppercase F in Fnet = m × a. Case-sensitive symbol identity remains an explicit retrieval diagnostic.",
  },
  {
    id: "lowercase-force-symbol-hard-negative",
    category: "symbol_sensitive",
    query: "Find a source expression containing lowercase f = ma, not uppercase F = ma.",
    expectedPdfPages: [],
    verification: "ocr-ground-truth-verified",
    expectedExpression: "f = ma",
    expectedNoMatch: true,
    notes: "Reviewed against all three physical PDF pages: no lowercase f = ma expression exists; the source equation uses uppercase Fnet. Keep excluded from the positive page-coverage run until case-sensitive abstention/rejection scoring is defined.",
  },
  {
    id: "four-kilogram-worked-example",
    category: "worked_example",
    query: "Find the worked example calculating force for a 4 kg object.",
    expectedPdfPages: [3],
    verification: "prior-source-evidence",
    notes: "The direct AI Search smoke check returned the 4 kg worked example first from physical PDF page 3.",
  },
  {
    id: "numerical-force-setup",
    category: "numerical_setup",
    query: "Set up the numerical force calculation for the four-kilogram example.",
    expectedPdfPages: [3],
    verification: "ocr-ground-truth-verified",
    notes: "Physical PDF page 3: 4 kg box; 20 N right pull; 8 N left friction; net force 12 N right; acceleration 3 m/s² right.",
  },
  {
    id: "theory-plus-formula",
    category: "mixed_theory_math",
    query: "Explain how net force affects acceleration for a fixed mass and cite the governing equation.",
    expectedPdfPages: [2],
    verification: "ocr-ground-truth-verified",
    expectedExpression: "Fnet = m × a",
    notes: "Physical PDF page 2 contains both the explanation of net force/acceleration and the governing equation; one unified query should retrieve that page.",
  },
  {
    id: "friction-and-net-force",
    category: "force_friction",
    query: "How does friction affect the net force and motion of an object?",
    expectedPdfPages: [3],
    verification: "ocr-ground-truth-verified",
    notes: "Physical PDF page 3 describes an 8 N friction force opposing a 20 N pull, calculates the 12 N resultant and derives the acceleration.",
  },
  {
    id: "bus-braking-answer",
    category: "bus_braking",
    query: "Find the bus-braking example and its answer-key explanation.",
    expectedPdfPages: [3, 1],
    verification: "prior-source-evidence",
    notes: "The direct AI Search smoke check returned answer-key evidence first from page 3; related explanatory evidence is on page 1.",
  },
  {
    id: "out-of-corpus-constant",
    category: "no_answer",
    query: "Give the exact SI value of the Planck constant to nine significant figures.",
    expectedPdfPages: [],
    verification: "ocr-ground-truth-verified",
    expectedNoMatch: true,
    notes: "Reviewed all three physical PDF pages: the Planck constant and its SI value are absent. Keep excluded from the positive page-coverage run until a retrieval abstention threshold and false-positive policy are defined.",
  },
] as const;


export interface BrvinM14PageCoverageSummary {
  expectedPageCount: number;
  coveredExpectedPageCount: number;
  expectedPageCoverageRate: number;
  allExpectedPagesCovered: boolean;
}

/** Summarize source-page recall only; this is not a precision or answer-quality metric. */
export function summarizeBrvinM14PageCoverage(
  checks: readonly {
    expectedPages: readonly number[];
    expectedPageCoverage: readonly number[];
  }[],
): BrvinM14PageCoverageSummary {
  const expectedPageCount = checks.reduce((sum, check) => sum + check.expectedPages.length, 0);
  const coveredExpectedPageCount = checks.reduce(
    (sum, check) => sum + check.expectedPageCoverage.length,
    0,
  );
  const expectedPageCoverageRate = expectedPageCount === 0
    ? 1
    : coveredExpectedPageCount / expectedPageCount;
  return {
    expectedPageCount,
    coveredExpectedPageCount,
    expectedPageCoverageRate,
    allExpectedPagesCovered: coveredExpectedPageCount === expectedPageCount,
  };
}
