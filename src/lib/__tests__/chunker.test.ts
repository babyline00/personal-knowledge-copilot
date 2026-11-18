/**
 * Bun-native unit tests for the chunker.
 * Run: `bun test`
 */
import { test, expect, describe } from 'bun:test'
import {
  chunkMarkdown,
  splitByHeading,
  splitBodyByTokens,
  estimateTokens,
} from '../chunker'

describe('estimateTokens', () => {
  test('empty -> 0', () => {
    expect(estimateTokens('')).toBe(0)
  })
  test('approx char/4', () => {
    expect(estimateTokens('hello world')).toBe(3) // 11 chars -> ceil(11/4)=3
  })
})

describe('splitByHeading', () => {
  test('single heading + body', () => {
    const md = '# Title\nBody line 1\nBody line 2'
    const segs = splitByHeading(md)
    expect(segs.length).toBe(1)
    expect(segs[0].heading).toBe('# Title')
    expect(segs[0].body).toContain('Body line 1')
  })
  test('multiple headings create separate segments', () => {
    const md = '# A\nfoo\n# B\nbar\n## C\nbaz'
    const segs = splitByHeading(md)
    expect(segs.length).toBe(3)
    expect(segs[0].heading).toBe('# A')
    expect(segs[1].heading).toBe('# B')
    expect(segs[2].heading).toBe('## C')
  })
  test('content before first heading is its own segment with empty heading', () => {
    const md = 'preface\n# A\nbody'
    const segs = splitByHeading(md)
    expect(segs.length).toBe(2)
    expect(segs[0].heading).toBe('')
    expect(segs[0].body).toContain('preface')
  })
})

describe('splitBodyByTokens', () => {
  test('short body stays single chunk', () => {
    const chunks = splitBodyByTokens('short body', 256, 48)
    expect(chunks.length).toBe(1)
  })
  test('large body splits into multiple chunks', () => {
    const para = 'This is a paragraph. ' .repeat(60) // ~1200 chars -> ~300 tokens
    const chunks = splitBodyByTokens(para, 100, 0)
    expect(chunks.length).toBeGreaterThan(1)
  })
  test('overlap is applied between consecutive chunks', () => {
    const para = (i: number) => `Paragraph ${i} sentence one. Sentence two. `
    const body = Array.from({ length: 30 }, (_, i) => para(i)).join('\n\n')
    const chunks = splitBodyByTokens(body, 100, 20)
    expect(chunks.length).toBeGreaterThan(1)
    // Last 80 chars (20 tokens * 4) of chunks[0] should appear near the start of chunks[1]
    const tail = chunks[0].slice(-80)
    expect(chunks[1].startsWith(tail)).toBe(true)
  })
})

describe('chunkMarkdown (integration)', () => {
  test('returns chunks with ordinals starting at 1', () => {
    const md = '# Architecture\nA paragraph here.\n\nAnother paragraph.\n# API\nA third paragraph.'
    const chunks = chunkMarkdown(md)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i + 1))
  })
  test('every chunk carries its nearest heading', () => {
    const md = '# A\nfoo\n# B\nbar'
    const chunks = chunkMarkdown(md)
    expect(chunks[0].heading).toBe('# A')
    expect(chunks[1].heading).toBe('# B')
  })
  test('empty input -> empty array', () => {
    expect(chunkMarkdown('')).toEqual([])
  })
})
