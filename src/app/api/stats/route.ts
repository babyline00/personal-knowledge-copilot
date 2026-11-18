/**
 * GET /api/stats — corpus size summary (used by the UI header).
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  const notes = await db.note.count()
  const chunks = await db.noteChunk.count()
  return NextResponse.json({ notes, chunks })
}
