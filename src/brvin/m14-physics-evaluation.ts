/**
 * Fixed M14 evaluation suite for the existing three-page Physics pilot.
 * Known page labels below come from the previously verified AI Search/consumer
 * checks. Remaining math-specific cases are deliberately marked pending until
 * the OCR text is replayed and the Qdrant pilot is run against that corpus.
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
  verification: "prior-source-evidence" | "pending-ocr-ground-truth";
  expectedExpression?: string;
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
    verification: "pending-ocr-ground-truth",
    expectedExpression: "F = ma",
    notes: "Validate the exact OCR expression and symbols before scoring formula fidelity.",
  },
  {
    id: "net-force-paraphrase",
    category: "paraphrase",
    query: "How does an unbalanced force change the motion of an object?",
    expectedPdfPages: [2],
    verification: "pending-ocr-ground-truth",
    notes: "Paraphrase target for the same conceptual passage; expected page must be confirmed from OCR.",
  },
  {
    id: "force-mass-acceleration-equivalent-notation",
    category: "equivalent_notation",
    query: "State that resultant force is mass multiplied by acceleration.",
    expectedPdfPages: [2],
    verification: "pending-ocr-ground-truth",
    expectedExpression: "F = ma",
    notes: "Equivalent-language retrieval; do not rewrite source notation or claim algebraic equivalence from BM25 alone.",
  },
  {
    id: "uppercase-force-symbol",
    category: "symbol_sensitive",
    query: "Find the source expression containing uppercase F in the second-law formula.",
    expectedPdfPages: [2],
    verification: "pending-ocr-ground-truth",
    expectedExpression: "F",
    notes: "Uppercase and lowercase variables must remain distinct in lexical/sparse features.",
  },
  {
    id: "lowercase-force-symbol-hard-negative",
    category: "symbol_sensitive",
    query: "Find a source expression containing lowercase f = ma, not uppercase F = ma.",
    expectedPdfPages: [],
    verification: "pending-ocr-ground-truth",
    expectedExpression: "f = ma",
    notes: "Hard negative: a one-character case difference must not be treated as exact symbol identity.",
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
    verification: "pending-ocr-ground-truth",
    notes: "The exact acceleration, units and calculation must be transcribed from source OCR before scoring.",
  },
  {
    id: "theory-plus-formula",
    category: "mixed_theory_math",
    query: "Explain how net force affects acceleration for a fixed mass and cite the governing equation.",
    expectedPdfPages: [2],
    verification: "pending-ocr-ground-truth",
    expectedExpression: "F = ma",
    notes: "One unified query must retrieve both explanatory and formula evidence rather than routing to separate indexes.",
  },
  {
    id: "friction-and-net-force",
    category: "force_friction",
    query: "How does friction affect the net force and motion of an object?",
    expectedPdfPages: [],
    verification: "pending-ocr-ground-truth",
    notes: "Confirm exact supporting page(s) from the original OCR before adding a relevance assertion.",
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
    verification: "pending-ocr-ground-truth",
    notes: "Validate that the three-page source does not contain this information before treating it as a no-answer golden case.",
  },
] as const;
