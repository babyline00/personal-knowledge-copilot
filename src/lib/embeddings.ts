/**
 * Pluggable embedding provider.
 *
 * Default: a deterministic hashing-embedding that maps each token of a chunk
 * into a 384-dim vector via a stable hash, with positional averaging so
 * cosine similarity reflects term overlap. This keeps the app 100% runnable
 * in the sandbox without any external API key while preserving a real
 * "vector search" pipeline.
 *
 * Optional: when `OPENAI_API_KEY` (or compatible `EMBEDDINGS_API_KEY`) is set,
 * we call out to the configured embeddings endpoint and fall back to the
 * hashing embedder only if the network call fails. This is the production
 * path described in the README ("plug OpenAI text-embedding-3-small in for
 * real semantic embeddings").
 *
 * Both providers return Float32Array so the rest of the app does not care
 * which one produced the vector.
 */

import { tokenize } from './tokenizer'

export const EMBED_DIM = 384

/**
 * FNV-1a hash — stable across runs and platforms (no Murmurhash endianness issues).
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    // 32-bit multiply by FNV prime
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

/**
 * Deterministic hashing embedding.
 *
 * Each token hashes to two indices (one for the "positive" feature, one for
 * the "negative" feature — a.k.a. the hashing-trick signed-bag pattern). The
 * final vector is the average of per-token signed indicator vectors, then
 * L2-normalised. Cosine similarity then = inner product of two normalised
 * vectors = a fair approximation of token-Jaccard weighted by term frequency.
 */
export function hashingEmbed(text: string): Float32Array {
  const vec = new Float32Array(EMBED_DIM)
  const tokens = tokenize(text)
  if (tokens.length === 0) return vec
  for (const tok of tokens) {
    const h1 = fnv1a(tok) % EMBED_DIM
    const h2 = fnv1a(`neg:${tok}`) % EMBED_DIM
    vec[h1] += 1
    vec[h2] -= 1
  }
  // L2 normalise
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm
  }
  return vec
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`vector dim mismatch: ${a.length} vs ${b.length}`)
  }
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot // vectors are already L2-normalised
}

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>
}

class HashingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<Float32Array> {
    return hashingEmbed(text)
  }
}

/**
 * OpenAI-compatible embeddings provider. Reads base URL + API key from env so
 * the same code works against OpenAI, Azure OpenAI, or any OpenRouter-style
 * gateway by changing `EMBEDDINGS_BASE_URL` / `EMBEDDINGS_API_KEY` /
 * `EMBEDDINGS_MODEL`.
 */
class OpenAICompatProvider implements EmbeddingProvider {
  private baseUrl: string
  private apiKey: string
  private model: string

  constructor() {
    this.baseUrl = (process.env.EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    this.apiKey = process.env.EMBEDDINGS_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
    this.model = process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small'
    if (!this.apiKey) throw new Error('OpenAICompatProvider configured but no API key present in env')
  }

  async embed(text: string): Promise<Float32Array> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    })
    if (!res.ok) {
      throw new Error(`embeddings HTTP ${res.status}: ${await res.text()}`)
    }
    const json = await res.json()
    const arr: number[] = json.data?.[0]?.embedding ?? []
    if (!arr.length) throw new Error('embeddings response had no vector')
    return Float32Array.from(arr)
  }
}

let cachedProvider: EmbeddingProvider | null = null

/**
 * Returns the active embedding provider. Selection is done once per process:
 *  - if `EMBEDDINGS_API_KEY` or `OPENAI_API_KEY` is set in env, use the
 *    OpenAI-compatible provider
 *  - otherwise use the deterministic hashing embedder (default in the
 *    sandbox and for tests)
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cachedProvider) return cachedProvider
  const hasKey =
    !!process.env.EMBEDDINGS_API_KEY || !!process.env.OPENAI_API_KEY
  if (hasKey) {
    try {
      cachedProvider = new OpenAICompatProvider()
      return cachedProvider
    } catch (e) {
      console.warn('[embeddings] OpenAI provider init failed, falling back to hashing:', (e as Error).message)
    }
  }
  cachedProvider = new HashingProvider()
  return cachedProvider
}

/** Test-only: force a specific provider (used by unit tests). */
export function __setEmbeddingProviderForTest(p: EmbeddingProvider | null) {
  cachedProvider = p
}

/** Convenience: serialise a vector to JSON for DB storage. */
export function serializeVector(v: Float32Array): string {
  return JSON.stringify(Array.from(v))
}

/** Convenience: deserialize a vector from DB storage. */
export function deserializeVector(s: string): Float32Array {
  const arr = JSON.parse(s) as number[]
  return Float32Array.from(arr)
}
