export interface AiSearchPageResponse<T> {
  result?: T[];
  result_info?: {
    per_page?: number;
    total_count?: number;
  };
}

/**
 * Cloudflare AI Search v3 returns total_count (not total_pages) in result_info.
 * If metadata is omitted by a binding version, a full page is the safe signal
 * to request the next page.
 */
export function nextAiSearchPage<T>(
  response: AiSearchPageResponse<T>,
  currentPage: number,
  requestedPageSize: number,
): number | null {
  const totalCount = Number(response.result_info?.total_count);
  const reportedPageSize = Number(response.result_info?.per_page);
  const pageSize = Number.isFinite(reportedPageSize) && reportedPageSize > 0
    ? reportedPageSize
    : requestedPageSize;

  if (Number.isFinite(totalCount) && totalCount >= 0) {
    return currentPage * pageSize < totalCount ? currentPage + 1 : null;
  }

  return (response.result?.length ?? 0) >= requestedPageSize
    ? currentPage + 1
    : null;
}
