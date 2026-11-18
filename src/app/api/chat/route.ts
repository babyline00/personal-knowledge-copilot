/**
 * POST /api/chat
 *
 * Body: { message: string, sessionId?: string, filterNoteIds?: string[] }
 *
 * Response: text/plain; charset=utf-8 — a server-streamed concatenation of
 * LLM tokens. After the stream finishes, a final `\n---CITATIONS---\n<json>`
 * footer is appended so the client can render the citation chips for any
 * [^c1] markers that appeared in the assistant message.
 *
 * The streaming protocol is intentionally simple (not SSE / OpenAI shape) so
 * a fetch() + ReadableStream reader is enough on the client side.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { retrieve, type RetrievedChunk } from '@/lib/retrieval'
import {
  getChatProvider,
  buildRagSystemPrompt,
  extractCitations,
} from '@/lib/ai'

export const runtime = 'nodejs'

interface ChatRequestBody {
  message: string
  sessionId?: string
  filterNoteIds?: string[]
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const message = (body.message ?? '').trim()
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  // 1. Retrieve grounded chunks (optionally filtered by selected note IDs).
  const retrieved: RetrievedChunk[] = await retrieve(message, {
    filterNoteIds: body.filterNoteIds,
    topK: 8,
  })

  // 2. Get or create a chat session so we can persist the conversation.
  let sessionId = body.sessionId
  if (!sessionId) {
    const title = message.slice(0, 60) + (message.length > 60 ? '…' : '')
    const session = await db.chatSession.create({ data: { title } })
    sessionId = session.id
  }

  // 3. Load prior messages in this session for the LLM context window.
  const priorMessages = await db.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  })
  // Recent window: last 8 user/assistant turns to keep context small.
  const recent = priorMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

  // 4. Persist the user message immediately so it isn't lost on disconnect.
  await db.chatMessage.create({
    data: { sessionId, role: 'user', content: message },
  })

  // 5. Build the system prompt + citation map.
  const { systemPrompt, citationMap } = buildRagSystemPrompt(retrieved)

  // 6. Stream the assistant response, buffering the full message so we can
  //    persist it after the stream completes.
  const provider = getChatProvider()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullMessage = ''
      try {
        for await (const delta of provider.stream({
          systemPrompt,
          messages: [...recent, { role: 'user', content: message }],
        })) {
          fullMessage += delta
          controller.enqueue(encoder.encode(delta))
        }
      } catch (e) {
        const err = `⚠️ [stream error] ${(e as Error).message}`
        fullMessage += err
        controller.enqueue(encoder.encode(err))
      }

      // 7. Resolve cited chunk IDs from [^c1] markers and build the citation footer.
      const citedChunkIds = extractCitations(fullMessage, retrieved)
      const citations = citedChunkIds
        .map((cid) => {
          const meta = citationMap[cid]
          if (!meta) return null
          const chunk = retrieved.find((r) => r.chunkId === cid)!
          return {
            chunkId: cid,
            noteId: chunk.noteId,
            noteTitle: meta.noteTitle,
            ordinal: meta.ordinal,
            heading: meta.heading,
            preview: meta.preview,
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)

      // 8. Persist the assistant message with citations.
      await db.chatMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: fullMessage,
          citations: JSON.stringify(citations),
        },
      })
      await db.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })

      // 9. Emit the structured footer for the client.
      const footer =
        '\n\n---CITATIONS---\n' +
        JSON.stringify({ sessionId, citations })
      controller.enqueue(encoder.encode(footer))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
      // Echo the session id back so a brand-new session can be tracked by the client.
      'X-Session-Id': sessionId,
    },
  })
}
