/**
 * DELETE /api/notes/[id] — remove a note + all its chunks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { invalidateCorpus } from '@/lib/retrieval'

export const runtime = 'nodejs'

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const note = await db.note.findUnique({ where: { id } })
    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }
    await db.note.delete({ where: { id } })
    invalidateCorpus()
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/notes/:id] delete error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
