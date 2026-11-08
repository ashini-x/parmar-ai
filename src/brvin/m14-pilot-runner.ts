import type {
  BrvinCorpusPageManifest,
  BrvinCorpusSourceManifest,
} from "./corpus";
import type { BrvinQdrantHybridPilot } from "./qdrant-hybrid-pilot";

export interface BrvinM14CorpusGeneration {
  sourceManifest: BrvinCorpusSourceManifest;
  pageManifests: BrvinCorpusPageManifest[];
  chunkCount: number;
}

/**
 * Replay an already-persisted OCR corpus into Qdrant. This function accepts
 * manifests only; it has no PDF, Vision OCR or temporary-output dependency.
 * Page writes are deliberately sequential to bound Vertex/Qdrant pilot load.
 */
export async function indexBrvinCorpusGeneration(
  pilot: Pick<BrvinQdrantHybridPilot, "upsertPageChunks">,
  projectId: string,
  corpus: BrvinM14CorpusGeneration,
): Promise<{
  sourceId: string;
  generationId: string;
  pageCount: number;
  chunkCount: number;
  pointCount: number;
  pointIds: string[];
  embeddingModelIds: string[];
  embeddingModelVersions: string[];
}> {
  const source = corpus.sourceManifest;
  if (!projectId.trim() || !source.sourceId || !source.generationId ||
      !Number.isSafeInteger(source.pageCount) || source.pageCount < 1 ||
      corpus.pageManifests.length !== source.pageCount) {
    throw new Error("M14 corpus replay requires one complete source manifest and every physical page manifest.");
  }

  const seenPages = new Set<number>();
  const pointIds: string[] = [];
  const modelIds = new Set<string>();
  const modelVersions = new Set<string>();
  let pointCount = 0;

  for (const page of [...corpus.pageManifests].sort((left, right) => left.pdfPage - right.pdfPage)) {
    if (page.sourceId !== source.sourceId || page.generationId !== source.generationId ||
        page.sourcePdfSha256 !== source.sourcePdfSha256 || page.ocrOperationId !== source.ocrOperationId ||
        !Number.isSafeInteger(page.pdfPage) || page.pdfPage < 1 || page.pdfPage > source.pageCount ||
        seenPages.has(page.pdfPage)) {
      throw new Error("M14 corpus replay rejected a page with mismatched source, generation or duplicate page provenance.");
    }
    seenPages.add(page.pdfPage);

    const result = await pilot.upsertPageChunks({
      projectId,
      sourceId: source.sourceId,
      itemKey: page.stableItemKey,
      pdfPage: page.pdfPage,
      generationId: source.generationId,
      chunks: page.chunks.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        normalizedText: chunk.normalizedText,
        contentSha256: chunk.contentSha256,
        contentTypes: chunk.contentTypes,
        formulaCandidates: chunk.formulaCandidates.map((formula) => ({
          originalExpression: formula.originalExpression,
          normalizedSearchExpression: formula.normalizedSearchExpression,
          confidence: formula.confidence,
        })),
      })),
    });
    if (result.pointCount !== page.chunks.length || result.ids.length !== page.chunks.length) {
      throw new Error("Qdrant did not confirm every deterministic corpus chunk during M14 replay.");
    }
    pointCount += result.pointCount;
    pointIds.push(...result.ids);
    modelIds.add(result.modelId);
    modelVersions.add(result.modelVersion);
  }

  if (seenPages.size !== source.pageCount || pointCount !== corpus.chunkCount ||
      new Set(pointIds).size !== pointIds.length) {
    throw new Error("M14 corpus replay did not preserve complete page/chunk coverage or unique deterministic point IDs.");
  }
  return {
    sourceId: source.sourceId,
    generationId: source.generationId,
    pageCount: seenPages.size,
    chunkCount: corpus.chunkCount,
    pointCount,
    pointIds,
    embeddingModelIds: [...modelIds],
    embeddingModelVersions: [...modelVersions],
  };
}
