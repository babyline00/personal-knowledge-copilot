/**
 * POST /api/notes/import
 *  - multipart/form-data: `files` = one or more .md / .txt files
 *  - application/json:   { items: [{ title, content, source?, path? }] }
 *
 * Idempotent on (title): re-importing a note with the same title replaces its
 * chunks. This makes drag-and-drop re-uploads safe.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chunkMarkdown } from '@/lib/chunker'
import { tokenize } from '@/lib/tokenizer'
import { getEmbeddingProvider, serializeVector } from '@/lib/embeddings'
import { invalidateCorpus } from '@/lib/retrieval'

export const runtime = 'nodejs'

interface ImportItem {
  title: string
  content: string
  source: string
  path?: string
}

async function ingestItems(items: ImportItem[]) {
  const provider = getEmbeddingProvider()
  let totalChunks = 0
  const results: { id: string; title: string; chunks: number }[] = []

  for (const item of items) {
    const title = item.title.trim() || 'Untitled note'
    const content = item.content
    const chunks = chunkMarkdown(content)
    const wordCount = content.split(/\s+/).filter(Boolean).length

    // Idempotent on title: replace if exists.
    const existing = await db.note.findFirst({ where: { title } })
    if (existing) {
      await db.noteChunk.deleteMany({ where: { noteId: existing.id } })
      await db.note.delete({ where: { id: existing.id } })
    }

    const note = await db.note.create({
      data: {
        title,
        source: item.source,
        path: item.path ?? null,
        content,
        wordCount,
      },
    })

    for (const chunk of chunks) {
      const tokens = tokenize(chunk.content)
      const vec = await provider.embed(chunk.content)
      await db.noteChunk.create({
        data: {
          noteId: note.id,
          ordinal: chunk.ordinal,
          heading: chunk.heading,
          content: chunk.content,
          tokens: JSON.stringify(tokens),
          embedding: serializeVector(vec),
        },
      })
      totalChunks += 1
    }

    results.push({ id: note.id, title: note.title, chunks: chunks.length })
  }

  invalidateCorpus()
  return { results, totalChunks }
}

export async function POST(req: NextRequest) {
  try {
    let items: ImportItem[]
    const contentType = req.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const files = form.getAll('files')
      const fromPaste = form.get('paste') as string | null
      const parsedItems: ImportItem[] = []
      for (const f of files) {
        if (!(f instanceof File)) continue
        const text = await f.text()
        parsedItems.push({
          title: f.name.replace(/\.(md|markdown|txt)$/i, ''),
          content: text,
          source: 'upload',
          path: f.name,
        })
      }
      if (fromPaste) {
        try {
          const parsed = JSON.parse(fromPaste) as { title?: string; content?: string }
          if (parsed.content) {
            parsedItems.push({
              title: parsed.title || `Pasted note ${new Date().toISOString().slice(0, 16)}`,
              content: parsed.content,
              source: 'paste',
            })
          }
        } catch {
          // ignore malformed paste payload
        }
      }
      items = parsedItems
    } else if (contentType.includes('application/json')) {
      const body = await req.json()
      const raw: ImportItem[] = body.items ?? (body.title && body.content ? [body] : [])
      items = raw.map((r) => ({
        title: r.title,
        content: r.content,
        source: r.source ?? 'paste',
        path: r.path,
      }))
    } else {
      return NextResponse.json({ error: 'Unsupported content-type' }, { status: 415 })
    }

    if (!items.length) {
      return NextResponse.json({ error: 'No items to import' }, { status: 400 })
    }

    const result = await ingestItems(items)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[api/notes/import] error:', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Internal Server Error' },
      { status: 500 },
    )
  }
}

export async function GET() {
  const notes = await db.note.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      source: true,
      wordCount: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { chunks: true } },
    },
  })
  return NextResponse.json({ notes })
}
