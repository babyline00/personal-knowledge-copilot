import { test, expect, describe } from 'bun:test'
import { buildRagSystemPrompt, extractCitations, type ChatProvider, getChatProvider, __setChatProviderForTest } from '../ai'
import type { RetrievedChunk } from '../retrieval'

const retrieved: RetrievedChunk[] = [
  {
    chunkId: 'ck-aaa',
    noteId: 'note-1',
    noteTitle: 'Architecture Notes',
    ordinal: 1,
    heading: '## Components',
    content: 'The system is composed of three services: ingest, retrieval, and chat.',
    bm25Score: 4.2,
    vectorScore: 0.81,
    fusedScore: 0.016,
  },
  {
    chunkId: 'ck-bbb',
    noteId: 'note-2',
    noteTitle: 'Onboarding',
    ordinal: 3,
    heading: '',
    content: 'New users land on the dashboard after signup.',
    bm25Score: 2.1,
    vectorScore: 0.74,
    fusedScore: 0.012,
  },
]

describe('buildRagSystemPrompt', () => {
  test('includes all retrieved chunks', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt).toContain('three services')
    expect(systemPrompt).toContain('New users land')
  })
  test('includes the citation rules', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt.toLowerCase()).toContain('citation')
    expect(systemPrompt).toContain('[^c1]')
  })
  test('empty retrieved -> safe-mode prompt', () => {
    const { systemPrompt, citationMap } = buildRagSystemPrompt([])
    expect(systemPrompt.toLowerCase()).toContain('no notes')
    expect(Object.keys(citationMap)).toHaveLength(0)
  })
  test('citation map key is the chunkId', () => {
    const { citationMap } = buildRagSystemPrompt(retrieved)
    expect(citationMap['ck-aaa'].noteTitle).toBe('Architecture Notes')
    expect(citationMap['ck-bbb'].noteTitle).toBe('Onboarding')
  })
})

describe('extractCitations', () => {
  test('returns chunkIds in citation order', () => {
    const msg = 'The system has three services [^c1]. New users see the dashboard [^c2].'
    const ids = extractCitations(msg, retrieved)
    expect(ids).toEqual(['ck-aaa', 'ck-bbb'])
  })
  test('dedupes repeated citations', () => {
    const msg = 'A [^c1] then again [^c1].'
    const ids = extractCitations(msg, retrieved)
    expect(ids).toEqual(['ck-aaa'])
  })
  test('ignores out-of-range markers', () => {
    const msg = 'Bogus citation [^c99].'
    expect(extractCitations(msg, retrieved)).toEqual([])
  })
  test('no citations -> []', () => {
    expect(extractCitations('no markers here', retrieved)).toEqual([])
  })
})

describe('ChatProvider (mock)', () => {
  class MockChat implements ChatProvider {
    async *stream(args: { systemPrompt: string; messages: { role: string; content: string }[] }) {
      yield 'mocked response for: '
      yield args.messages[args.messages.length - 1].content
    }
  }
  test('streams concatenated deltas', async () => {
    __setChatProviderForTest(new MockChat())
    const provider = getChatProvider()
    const out: string[] = []
    for await (const d of provider.stream({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      out.push(d)
    }
    expect(out.join('')).toBe('mocked response for: hello')
    __setChatProviderForTest(null)
  })
})
