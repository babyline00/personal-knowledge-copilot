/**
 * Okapi BM25 implementation.
 *
 * Operates over a pre-tokenised corpus. We keep the corpus in memory for the
 * personal-notes use case (typical corpus size: 10^2-10^4 chunks, well within
 * memory for an in-process BM25 implementation). For larger corpora the
 * design fits a Postgres FTS / Tantivy backend with no API changes.
 */

import { tokenize, termFrequencies } from './tokenizer'

export interface BM25Doc {
  id: string
  tokens: string[]
}

export interface BM25ScoreResult {
  id: string
  score: number
}

const DEFAULT_K1 = 1.5
const DEFAULT_B = 0.75

export class BM25Index {
  private docs: BM25Doc[]
  private docFreq: Map<string, number> = new Map() // term -> # docs containing term
  private docLen: number[] = []
  private avgDl = 0
  private k1: number
  private b: number

  constructor(docs: BM25Doc[] = [], opts: { k1?: number; b?: number } = {}) {
    this.k1 = opts.k1 ?? DEFAULT_K1
    this.b = opts.b ?? DEFAULT_B
    this.docs = docs
    this.buildIndex()
  }

  private buildIndex() {
    let total = 0
    for (const doc of this.docs) {
      const seen = new Set<string>()
      for (const t of doc.tokens) seen.add(t)
      for (const t of seen) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1)
      this.docLen.push(doc.tokens.length)
      total += doc.tokens.length
    }
    this.avgDl = this.docs.length ? total / this.docs.length : 0
  }

  /**
   * Score all docs against the query. Returns ranked results (highest score first).
   * Pure function over the index — safe to call concurrently.
   */
  search(query: string, topK = 10): BM25ScoreResult[] {
    const queryTerms = tokenize(query)
    if (!queryTerms.length || !this.docs.length) return []
    const N = this.docs.length
    const scores: BM25ScoreResult[] = []

    for (let i = 0; i < this.docs.length; i++) {
      const doc = this.docs[i]
      const dl = this.docLen[i]
      const tfMap = termFrequencies(doc.tokens)
      let score = 0
      for (const term of queryTerms) {
        const tf = tfMap.get(term)
        if (!tf) continue
        const df = this.docFreq.get(term) ?? 0
        // BM25 IDF (with the +1 smoothing to keep it non-negative)
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
        const denom = tf + this.k1 * (1 - this.b + this.b * (dl / (this.avgDl || 1)))
        score += idf * (tf * (this.k1 + 1)) / denom
      }
      if (score > 0) scores.push({ id: doc.id, score })
    }
    scores.sort((a, b) => b.score - a.score)
    return scores.slice(0, topK)
  }

  get size() {
    return this.docs.length
  }
}
