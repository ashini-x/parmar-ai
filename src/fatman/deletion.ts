export const BRVIN_DELETION_SEARCH_PAGE_SIZE = 50;

export type BrvinDeletionProgressPhase =
  | "inventory"
  | "search"
  | "search_verify"
  | "source_storage"
  | "ocr_storage"
  | "registry"
  | "complete";

const DELETION_PROGRESS_RANGES: Record<BrvinDeletionProgressPhase, readonly [number, number]> = {
  inventory: [0, 5],
  search: [5, 60],
  search_verify: [60, 65],
  source_storage: [65, 80],
  ocr_storage: [80, 95],
  registry: [95, 99],
  complete: [100, 100],
};

export function brvinDeletionSearchPageRequest(page: number): {
  page: number;
  per_page: number;
  source: "builtin";
} {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("AI Search deletion page must be a positive integer.");
  }
  return { page, per_page: BRVIN_DELETION_SEARCH_PAGE_SIZE, source: "builtin" };
}

export function brvinDeletionProgressPercent(
  phase: BrvinDeletionProgressPhase,
  completed = 0,
  total = 0,
): number {
  const [start, end] = DELETION_PROGRESS_RANGES[phase];
  if (phase === "complete") return 100;
  const ratio = total <= 0 ? 1 : Math.max(0, Math.min(1, completed / total));
  return Math.max(start, Math.min(end, Math.floor(start + (end - start) * ratio)));
}
