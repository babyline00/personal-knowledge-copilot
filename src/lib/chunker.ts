/**
 * Markdown-aware chunker.
 *
 * Splits a markdown note into chunks that respect heading boundaries so each
 * chunk carries a clear semantic context (the nearest preceding heading) and
 * stays inside a configurable token budget. Adjacent chunks overlap by a
 * sliding window so retrieval does not miss cross-paragraph context.
 *
 * This module is PURE (no IO, no globals) so it can be unit-tested in
 * isolation.
 */

export interface NoteChunkData {
  /** 1-indexed position within the note. */
  ordinal: number
  /** Nearest preceding markdown heading (e.g. "## Architecture"). Empty string for content above the first heading. */
  heading: string
  /** Chunk text. */
  content: string
}

const DEFAULT_TARGET_TOKENS = 256
const DEFAULT_OVERLAP_TOKENS = 48

/**
 * Rough-but-stable token estimator. We approximate "tokens" by characters / 4
 * which is the standard rule-of-thumb for English text against BPE tokenizers.
 * It is intentionally cheap — the chunker only needs an approximate budget.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Split markdown into structural segments. A segment is the heading line itself
 * plus every line until the next heading. We preserve the heading prefix
 * (`#`, `##`, ...) so the caller can render citations like "## Architecture".
 */
export function splitByHeading(markdown: string): { heading: string; body: string }[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const segments: { heading: string; body: string }[] = []
  let current: { heading: string; body: string } = { heading: '', body: '' }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      // Start a new segment. Preserve the full heading line (prefix + text).
      if (current.body.trim().length > 0) {
        segments.push(current)
      }
      current = { heading: line.trim(), body: '' }
    } else {
      current.body += (current.body ? '\n' : '') + line
    }
  }
  if (current.body.trim().length > 0 || current.heading) {
    segments.push(current)
  }
  return segments.filter((s) => s.body.trim().length > 0)
}

/**
 * Greedy word-based splitter that keeps paragraphs intact where possible.
 * Returns one or more chunks each <= `targetTokens` tokens (approx).
 */
export function splitBodyByTokens(
  body: string,
  targetTokens: number = DEFAULT_TARGET_TOKENS,
  overlapTokens: number = DEFAULT_OVERLAP_TOKENS,
): string[] {
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0)
  const chunks: string[] = []
  let buffer = ''
  let bufferTokens = 0

  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim())
    buffer = ''
    bufferTokens = 0
  }

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para)
    if (bufferTokens + paraTokens > targetTokens && bufferTokens > 0) {
      flush()
    }
    // If a single paragraph is itself larger than the target, hard-split it by sentences.
    if (paraTokens > targetTokens) {
      const sentences = para.split(/(?<=[.!?])\s+/)
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence)
        if (bufferTokens + sentenceTokens > targetTokens && bufferTokens > 0) {
          flush()
        }
        buffer += (buffer ? ' ' : '') + sentence
        bufferTokens += sentenceTokens
      }
    } else {
      buffer += (buffer ? '\n\n' : '') + para
      bufferTokens += paraTokens
    }
  }
  flush()

  if (overlapTokens > 0 && chunks.length > 1) {
    const overlapChars = overlapTokens * 4
    const overlapped: string[] = [chunks[0]]
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].slice(-overlapChars)
      overlapped.push(`${prevTail}\n\n${chunks[i]}`.trim())
    }
    return overlapped
  }
  return chunks
}

/**
 * Top-level entry: split a markdown note into chunk records.
 */
export function chunkMarkdown(
  markdown: string,
  opts: { targetTokens?: number; overlapTokens?: number } = {},
): NoteChunkData[] {
  const targetTokens = opts.targetTokens ?? DEFAULT_TARGET_TOKENS
  const overlapTokens = opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS
  const segments = splitByHeading(markdown)
  const out: NoteChunkData[] = []
  let ordinal = 0

  for (const segment of segments) {
    const bodies = splitBodyByTokens(segment.body, targetTokens, overlapTokens)
    for (const body of bodies) {
      ordinal += 1
      out.push({
        ordinal,
        heading: segment.heading,
        content: body,
      })
    }
  }
  return out
}
