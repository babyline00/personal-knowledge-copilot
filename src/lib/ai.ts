/**
 * Streaming RAG chat. Wraps the z-ai-web-dev-sdk chat completion endpoint with
 * a retrieval-augmented system prompt that instructs the model to ground each
 * claim in a retrieved chunk via inline `[^chunkId]` markers. The caller
 * (Next.js Route Handler) is responsible for turning the SDK response into a
 * streaming `ReadableStream` for the frontend.
 *
 * We deliberately avoid the OpenAI-specific SDK shape so the AI layer is
 * pluggable. The interface `ChatProvider` has a single method that returns
 * a string stream; `ZaiProvider` implements it using the SDK available in
 * the sandbox.
 */

import type { RetrievedChunk } from '@/lib/retrieval'

export interface ChatProvider {
  /** Returns an async generator of text deltas. */
  stream(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): AsyncGenerator<string, void, unknown>
}

let cachedProvider: ChatProvider | null = null

class ZaiProvider implements ChatProvider {
  async *stream(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): AsyncGenerator<string, void, unknown> {
    // Dynamic import so a missing config in unit-test envs doesn't crash the
    // module-level evaluation.
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const messages = [
      { role: 'system' as const, content: args.systemPrompt },
      ...args.messages,
    ]
    const completion = await zai.chat.completions.create({
      messages,
      stream: true,
      thinking: { type: 'disabled' },
    })

    // The SDK returns either a string, a ReadableStream<Uint8Array> (when
    // stream:true and the server responds with text/event-stream or
    // text/plain), or a non-streaming JSON object. Handle all three.
    if (typeof completion === 'string') {
      yield completion
      return
    }
    let body: ReadableStream<Uint8Array> | undefined
    if (completion && typeof (completion as any).getReader === 'function') {
      // completion IS the ReadableStream (this is what the SDK returns when streaming)
      body = completion as ReadableStream<Uint8Array>
    } else {
      body = (completion as any)?.body ?? (completion as any)?._body
    }
    if (!body) {
      // Non-streaming completion object — extract a single delta
      const content = (completion as any)?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.length > 0) yield content
      return
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          return
        }
        try {
          const obj = JSON.parse(payload)
          const delta = obj?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta
          }
        } catch {
          // ignore partial JSON
        }
      }
    }
  }
}

class MockProvider implements ChatProvider {
  async *stream(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): AsyncGenerator<string, void, unknown> {
    // Deterministic mock that echoes the retrieved context. Used by tests and
    // when the SDK config is unavailable so the UI stays demoable offline.
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    const text = lastUser?.content ?? ''
    yield `**[mock assistant]** You asked: "${text.slice(0, 120)}". ` +
      `(No live LLM configured — set EMBEDDINGS_API_KEY and the SDK config to enable real streaming.)`
  }
}

export function getChatProvider(): ChatProvider {
  if (cachedProvider) return cachedProvider
  if (process.env.PKC_DISABLE_LLM === '1') {
    cachedProvider = new MockProvider()
    return cachedProvider
  }
  try {
    cachedProvider = new ZaiProvider()
  } catch (e) {
    console.warn('[chat] ZaiProvider unavailable, using MockProvider:', (e as Error).message)
    cachedProvider = new MockProvider()
  }
  return cachedProvider
}

/** Test-only. */
export function __setChatProviderForTest(p: ChatProvider | null) {
  cachedProvider = p
}

/**
 * Build the system prompt that grounds the assistant in retrieved chunks and
 * instructs it to cite chunks inline using the `[^chunkId]` markdown marker
 * (a footnote-style citation that renders naturally in the chat UI).
 *
 * Returns the system prompt and a map from chunkId -> { noteTitle, ordinal,
 * heading, preview } so the UI can render a "citations" footer underneath
 * each assistant message.
 */
export function buildRagSystemPrompt(retrieved: RetrievedChunk[]): {
  systemPrompt: string
  citationMap: Record<string, { noteTitle: string; ordinal: number; heading: string; preview: string }>
} {
  if (!retrieved.length) {
    return {
      systemPrompt:
        'You are Personal Knowledge Copilot. No notes have been uploaded yet. ' +
        'Answer the user\'s question briefly and tell them to drag-and-drop markdown notes to enable grounded answers.',
      citationMap: {},
    }
  }
  const chunkLines: string[] = []
  const citationMap: Record<string, { noteTitle: string; ordinal: number; heading: string; preview: string }> = {}
  retrieved.forEach((c, i) => {
    // Use a stable short id (1..n) for citations — the raw chunk id is used as the lookup key
    const shortId = `c${i + 1}`
    chunkLines.push(
      `[^${shortId}]: (chunkId=${c.chunkId}) ` +
      `Source: "${c.noteTitle}"${c.heading ? ` › ${c.heading}` : ''} (chunk ${c.ordinal})\n` +
      c.content,
    )
    citationMap[c.chunkId] = {
      noteTitle: c.noteTitle,
      ordinal: c.ordinal,
      heading: c.heading,
      preview: c.content.slice(0, 140).replace(/\s+/g, ' ').trim(),
    }
  })
  const systemPrompt = [
    'You are Personal Knowledge Copilot — a RAG assistant that answers questions strictly grounded in the user\'s uploaded personal notes.',
    'Below are the most relevant chunks retrieved from their knowledge base.',
    'Rules:',
    '1. Answer ONLY using the information present in the provided chunks. If the answer is not in the chunks, say "I don\'t have that in your notes."',
    '2. Every factual claim MUST be followed by an inline citation in the form [^c1], [^c2], etc. — the marker MUST match the chunkId label.',
    '3. Do not fabricate sources. Do not invent quotes. Do not paraphrase beyond what the chunks support.',
    '4. Use markdown for structure (lists, code blocks, emphasis) where it improves readability.',
    '',
    'Retrieved chunks:',
    chunkLines.join('\n\n---\n\n'),
  ].join('\n')
  return { systemPrompt, citationMap }
}

/**
 * Map short citation markers like [^c1] in the assistant message back to
 * chunk IDs from the citation map. Returns an ordered list of unique
 * chunkIds actually cited in the message.
 */
export function extractCitations(message: string, retrieved: RetrievedChunk[]): string[] {
  const seen = new Set<string>()
  const re = /\[\^(c\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const idx = parseInt(m[1].slice(1), 10) - 1
    if (idx >= 0 && idx < retrieved.length) {
      seen.add(retrieved[idx].chunkId)
    }
  }
  return Array.from(seen)
}
