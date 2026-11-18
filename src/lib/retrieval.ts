/**
 * Retrieval service: given a user query and (optionally) a filtered set of
 * note IDs, returns the top-K most relevant chunks via hybrid retrieval.
 *
 * This is the seam between the storage layer (Prisma) and the chat API.
 * It loads the corpus into memory on first use and rebuilds when notes are
 * added/removed. For the personal-notes scale (10^2-10^4 chunks) in-memory
 * is the right choice; for larger corpora this is where you would swap in
 * pgvector / Tantivy / a hosted retrieval service.
 */

import { db } from '@/lib/db'
import { tokenize } from '@/lib/tokenizer'
import { BM25Index } from '@/lib/bm25'
import {
  getEmbeddingProvider,
  cosine,
  deserializeVector,
  type EmbeddingProvider,
} from '@/lib/embeddings'
import { fuseHits, type SearchHit } from '@/lib/hybrid-search'

export interface RetrievedChunk {
  chunkId: string
  noteId: string
  noteTitle: string
  ordinal: number
  heading: string
  content: string
  bm25Score: number
  vectorScore: number
  fusedScore: number
}

const TOP_K = 8

interface CorpusState {
  // Flat arrays of chunk metadata + tokens + vectors. We keep these in
  // parallel arrays so the BM25 / vector loops are tight and cache-friendly.
  chunkIds: string[]
  noteIds: string[]
  noteTitles: string[]
  ordinals: number[]
  headings: string[]
  contents: string[]
  tokens: string[][]
  vectors: Float32Array[]
  bm25: BM25Index
  signature: string // hash of chunk IDs to detect stale state
}

let corpusState: CorpusState | null = null

async function computeCorpusSignature(): Promise<string> {
  const count = await db.noteChunk.count()
  // Cheap signature: max createdAt + count — invalidates whenever we add/remove chunks
  const latest = await db.noteChunk.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } })
  return `${count}:${latest?.id ?? ''}`
}

async function loadCorpus(provider: EmbeddingProvider): Promise<CorpusState> {
  const chunks = await db.noteChunk.findMany({
    include: { note: { select: { title: true } } },
    orderBy: { ordinal: 'asc' },
  })

  const chunkIds: string[] = []
  const noteIds: string[] = []
  const noteTitles: string[] = []
  const ordinals: number[] = []
  const headings: string[] = []
  const contents: string[] = []
  const tokens: string[] = []
  const vectors: Float32Array[] = []

  for (const c of chunks) {
    chunkIds.push(c.id)
    noteIds.push(c.noteId)
    noteTitles.push(c.note.title)
    ordinals.push(c.ordinal)
    headings.push(c.heading)
    contents.push(c.content)
    try {
      tokens.push(JSON.parse(c.tokens) as string[])
    } catch {
      // Fallback: re-tokenize if the stored tokens were corrupted (e.g. older schema)
      tokens.push(tokenize(c.content))
    }
    try {
      vectors.push(deserializeVector(c.embedding))
    } catch {
      vectors.push(await provider.embed(c.content))
    }
  }

  return {
    chunkIds,
    noteIds,
    noteTitles,
    ordinals,
    headings,
    contents,
    tokens,
    vectors,
    bm25: new BM25Index(tokens.map((t, i) => ({ id: chunkIds[i], tokens: t }))),
    signature: await computeCorpusSignature(),
  }
}

async function getCorpus(): Promise<CorpusState> {
  const sig = await computeCorpusSignature()
  if (corpusState && corpusState.signature === sig) {
    return corpusState
  }
  const provider = getEmbeddingProvider()
  corpusState = await loadCorpus(provider)
  return corpusState
}

/** Force a reload on next access — used by the import API after adding notes. */
export function invalidateCorpus() {
  corpusState = null
}

export interface RetrieveOptions {
  /** When set, only chunks from these note IDs are searched. */
  filterNoteIds?: string[]
  topK?: number
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? TOP_K
  const corpus = await getCorpus()
  if (!corpus.chunkIds.length) return []

  // Build filtered index arrays
  const filter = opts.filterNoteIds && opts.filterNoteIds.length > 0
    ? new Set(opts.filterNoteIds)
    : null

  // Filtered BM25 (we rebuild a slim index when a filter is applied — for an
  // unfiltered corpus we use the precomputed index for speed)
  const filteredIdx: number[] = []
  for (let i = 0; i < corpus.chunkIds.length; i++) {
    if (filter && !filter.has(corpus.noteIds[i])) continue
    filteredIdx.push(i)
  }
  if (!filteredIdx.length) return []

  const bm25Hits = (() => {
    if (!filter) {
      // Fast path: use the corpus-level BM25 index directly
      return corpus.bm25.search(query, topK * 2)
    }
    // Slow path: filtered — build a tiny BM25 index from the slice
    const filteredDocs = filteredIdx.map((i) => ({
      id: corpus.chunkIds[i],
      tokens: corpus.tokens[i],
    }))
    const sub = new BM25Index(filteredDocs)
    return sub.search(query, topK * 2)
  })()

  const provider = getEmbeddingProvider()
  const qVec = await provider.embed(query)

  // Vector similarity over the filtered slice
  const vecHits = filteredIdx
    .map((i) => ({
      id: corpus.chunkIds[i],
      score: cosine(qVec, corpus.vectors[i]),
      idx: i,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2)

  const fused = fuseHits(
    bm25Hits.map((h) => ({ id: h.id, score: h.score })),
    vecHits.map((h) => ({ id: h.id, score: h.score })),
    { topK },
  )

  const idToIdx = new Map(corpus.chunkIds.map((id, i) => [id, i]))
  return fused.map((f): RetrievedChunk => {
    const i = idToIdx.get(f.id)!
    return {
      chunkId: corpus.chunkIds[i],
      noteId: corpus.noteIds[i],
      noteTitle: corpus.noteTitles[i],
      ordinal: corpus.ordinals[i],
      heading: corpus.headings[i],
      content: corpus.contents[i],
      bm25Score: f.bm25Score,
      vectorScore: f.vectorScore,
      fusedScore: f.fusedScore,
    }
  })
}

/** Total chunk count — used by the UI to show "X notes / Y chunks indexed". */
export async function corpusStats(): Promise<{ notes: number; chunks: number }> {
  const notes = await db.note.count()
  const chunks = await db.noteChunk.count()
  return { notes, chunks }
}
