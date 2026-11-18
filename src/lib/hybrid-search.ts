/**
 * Hybrid retrieval: combine BM25 keyword scores with vector cosine scores
 * using Reciprocal Rank Fusion (RRF).
 *
 * RRF is a parameter-light fusion method that is robust to score-scale
 * differences between sparse (BM25) and dense (vector) retrievers. It has
 * only one tunable parameter `k` (a smoothing constant) and is the de-facto
 * default for hybrid RAG systems (Tantivy + dense, Elasticsearch ESQL, etc.).
 *
 *  score(d) = sum over retrievers of 1 / (k + rank_in_retriever(d))
 *
 * Because both retrievers return top-K only, documents that don't appear in
 * a retriever's top-K simply contribute nothing for that retriever — same
 * behaviour as RRF on a fully-materialised ranking.
 */

export interface RankedHit {
  id: string
  score: number
}

const DEFAULT_RRF_K = 60

export function reciprocalRankFusion(
  rankings: RankedHit[][],
  opts: { k?: number; topK?: number } = {},
): RankedHit[] {
  const k = opts.k ?? DEFAULT_RRF_K
  const topK = opts.topK ?? 10
  const fused = new Map<string, number>()

  for (const ranking of rankings) {
    ranking.forEach((hit, rank) => {
      // rank is 0-indexed; RRF formula uses 1-indexed rank
      fused.set(hit.id, (fused.get(hit.id) ?? 0) + 1 / (k + rank + 1))
    })
  }

  const results: RankedHit[] = Array.from(fused.entries()).map(([id, score]) => ({
    id,
    score,
  }))
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topK)
}

export interface SearchHit {
  id: string
  bm25Score: number
  vectorScore: number
  fusedScore: number
}

/**
 * Convenience wrapper: given BM25 and vector rankings for the same query,
 * returns merged hits with both raw scores plus the fused score.
 */
export function fuseHits(
  bm25Hits: RankedHit[],
  vectorHits: RankedHit[],
  opts: { k?: number; topK?: number } = {},
): SearchHit[] {
  const fused = reciprocalRankFusion([bm25Hits, vectorHits], opts)
  const bm25Map = new Map(bm25Hits.map((h) => [h.id, h.score]))
  const vectorMap = new Map(vectorHits.map((h) => [h.id, h.score]))
  return fused.map((f) => ({
    id: f.id,
    bm25Score: bm25Map.get(f.id) ?? 0,
    vectorScore: vectorMap.get(f.id) ?? 0,
    fusedScore: f.score,
  }))
}
