'use client'

import * as React from 'react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  FileText,
  Upload,
  Trash2,
  Send,
  Loader2,
  BookOpen,
  Sparkles,
  Filter,
  X,
  CornerDownLeft,
} from 'lucide-react'

// ---------- types ----------
interface Note {
  id: string
  title: string
  source: string
  wordCount: number
  createdAt: string
  updatedAt: string
  _count: { chunks: number }
}
interface Citation {
  chunkId: string
  noteId: string
  noteTitle: string
  ordinal: number
  heading: string
  preview: string
}
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
  pending?: boolean
}

// ---------- helpers ----------
function renderCitationsInline(content: string): React.ReactNode[] {
  // Replace [^c1] markers with clickable chips linked to the citation block.
  const parts: React.ReactNode[] = []
  const re = /\[\^(c\d+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      parts.push(<React.Fragment key={`t-${last}`}>{content.slice(last, m.index)}</React.Fragment>)
    }
    const id = m[1]
    parts.push(
      <a
        key={`c-${m.index}`}
        href={`#cite-${id}`}
        className="text-primary text-xs align-super mx-0.5 px-1 rounded bg-primary/10 hover:bg-primary/20 no-underline"
      >
        [{id}]
      </a>,
    )
    last = m.index + m[0].length
  }
  if (last < content.length) {
    parts.push(<React.Fragment key={`t-${last}`}>{content.slice(last)}</React.Fragment>)
  }
  return parts
}

function fmtDate(s: string): string {
  const d = new Date(s)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ---------- main ----------
export default function Home() {
  const { toast } = useToast()
  const [notes, setNotes] = React.useState<Note[]>([])
  const [loadingNotes, setLoadingNotes] = React.useState(true)
  const [stats, setStats] = React.useState<{ notes: number; chunks: number }>({ notes: 0, chunks: 0 })
  const [filterNoteIds, setFilterNoteIds] = React.useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [dragActive, setDragActive] = React.useState(false)

  const [pasteMode, setPasteMode] = React.useState(false)
  const [pasteTitle, setPasteTitle] = React.useState('')
  const [pasteContent, setPasteContent] = React.useState('')
  const [importing, setImporting] = React.useState(false)

  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const refreshNotes = React.useCallback(async () => {
    setLoadingNotes(true)
    try {
      const res = await fetch('/api/notes/import', { cache: 'no-store' })
      const json = await res.json()
      setNotes(json.notes ?? [])
      const sres = await fetch('/api/stats', { cache: 'no-store' })
      setStats(await sres.json())
    } catch (e) {
      toast({ title: 'Failed to load notes', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoadingNotes(false)
    }
  }, [toast])

  React.useEffect(() => {
    refreshNotes()
  }, [refreshNotes])

  // ---------- import handlers ----------
  async function ingestFiles(files: FileList | File[]) {
    setImporting(true)
    try {
      const fd = new FormData()
      const arr = Array.from(files)
      let validCount = 0
      for (const f of arr) {
        if (!/\.(md|markdown|txt)$/i.test(f.name)) {
          toast({ title: 'Skipped non-markdown file', description: f.name, variant: 'destructive' })
          continue
        }
        fd.append('files', f)
        validCount += 1
      }
      if (!validCount) {
        toast({ title: 'No .md / .txt files dropped', variant: 'destructive' })
        return
      }
      const res = await fetch('/api/notes/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast({
        title: `Imported ${json.results.length} note${json.results.length === 1 ? '' : 's'}`,
        description: `Indexed ${json.totalChunks} chunks.`,
      })
      await refreshNotes()
    } catch (e) {
      toast({ title: 'Import failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  async function ingestPaste() {
    if (!pasteContent.trim()) {
      toast({ title: 'Paste content is empty', variant: 'destructive' })
      return
    }
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('paste', JSON.stringify({
        title: pasteTitle.trim() || `Pasted note ${new Date().toISOString().slice(0, 16)}`,
        content: pasteContent,
      }))
      const res = await fetch('/api/notes/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast({ title: 'Note pasted', description: `Indexed ${json.totalChunks} chunks.` })
      setPasteTitle('')
      setPasteContent('')
      setPasteMode(false)
      await refreshNotes()
    } catch (e) {
      toast({ title: 'Paste failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  async function deleteNote(id: string, title: string) {
    if (!confirm(`Delete note "${title}"? Its chunks will be unindexed.`)) return
    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast({ title: 'Note deleted' })
      setFilterNoteIds((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
      await refreshNotes()
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  // ---------- drag & drop ----------
  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer?.files?.length) {
      await ingestFiles(e.dataTransfer.files)
    }
  }

  // ---------- chat ----------
  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text, citations: [] }
    const pendingMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '', citations: [], pending: true }
    setMessages((m) => [...m, userMsg, pendingMsg])
    setStreaming(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sessionId,
          filterNoteIds: filterNoteIds.size ? Array.from(filterNoteIds) : undefined,
        }),
      })
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => 'request failed')
        throw new Error(errText)
      }
      // Update session id from response header (first message in a new session).
      const sid = res.headers.get('X-Session-Id')
      if (sid) setSessionId(sid)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''
      let footerParsed: { sessionId?: string; citations: Citation[] } | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Look for the citation footer.
        const sepIdx = buffer.indexOf('\n\n---CITATIONS---\n')
        let body = buffer
        if (sepIdx !== -1) {
          body = buffer.slice(0, sepIdx)
          const footerRaw = buffer.slice(sepIdx + '\n\n---CITATIONS---\n'.length)
          try {
            footerParsed = JSON.parse(footerRaw)
            if (footerParsed?.sessionId) setSessionId(footerParsed.sessionId)
          } catch {
            footerParsed = { citations: [] }
          }
        }
        if (body !== assistantText) {
          assistantText = body
          setMessages((m) =>
            m.map((msg) => (msg.id === pendingMsg.id ? { ...msg, content: assistantText } : msg))
          )
        }
      }
      // Finalize: strip the footer text if it leaked into the body buffer
      // (in case the separator split mid-chunk).
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingMsg.id
            ? {
                ...msg,
                pending: false,
                content: assistantText,
                citations: footerParsed?.citations ?? [],
              }
            : msg
        )
      )
    } catch (e) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingMsg.id
            ? { ...msg, pending: false, content: `⚠️ ${(e as Error).message}` }
            : msg
        )
      )
      toast({ title: 'Chat error', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setStreaming(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const activeFilterCount = filterNoteIds.size

  return (
    <div
      className="min-h-screen flex flex-col bg-background text-foreground"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 gap-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary/10 grid place-items-center">
              <BookOpen className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Personal Knowledge Copilot</h1>
              <p className="text-xs text-muted-foreground">
                {stats.notes} notes · {stats.chunks} chunks indexed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPasteMode((v) => !v)}
            >
              <FileText className="size-4 mr-1.5" />
              Paste note
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Upload className="size-4 mr-1.5" />}
              Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) ingestFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        </div>
        {dragActive && (
          <div className="absolute inset-0 bg-primary/5 border-2 border-dashed border-primary/40 grid place-items-center pointer-events-none">
            <div className="flex items-center gap-2 text-primary font-medium">
              <Upload className="size-5" />
              Drop markdown files to import
            </div>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-0">
        {/* Sidebar */}
        <aside className="border-r bg-muted/30 md:sticky md:top-[57px] md:h-[calc(100vh-57px)] md:overflow-hidden flex flex-col">
          <div className="p-4 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Notes</h2>
            <Button
              variant={filterOpen ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilterOpen((v) => !v)}
              disabled={!notes.length}
            >
              <Filter className="size-3.5 mr-1" />
              Filter
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{activeFilterCount}</Badge>
              )}
            </Button>
          </div>
          <Separator />
          {filterOpen && notes.length > 0 && (
            <div className="p-3 border-b bg-background">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Limit search to:</span>
                {activeFilterCount > 0 && (
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => setFilterNoteIds(new Set())}
                  >
                    Clear ({activeFilterCount})
                  </button>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {notes.map((n) => (
                  <label key={n.id} className="flex items-start gap-2 text-xs cursor-pointer hover:bg-muted/40 rounded p-1">
                    <Checkbox
                      checked={filterNoteIds.has(n.id)}
                      onCheckedChange={(checked) => {
                        setFilterNoteIds((prev) => {
                          const next = new Set(prev)
                          if (checked) next.add(n.id)
                          else next.delete(n.id)
                          return next
                        })
                      }}
                      className="mt-0.5"
                    />
                    <span className="line-clamp-2">{n.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {loadingNotes ? (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </>
              ) : notes.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No notes yet. Drag-and-drop <code>.md</code> files anywhere in this window, or click <strong>Import</strong>.
                </div>
              ) : (
                notes.map((n) => (
                  <Card key={n.id} className="p-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium line-clamp-2">{n.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {n._count.chunks} chunks · {n.wordCount} words
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {fmtDate(n.updatedAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 -mr-1 -mt-1 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteNote(n.id, n.title)}
                        aria-label={`Delete ${n.title}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Chat column */}
        <section className="flex flex-col min-h-[60vh] md:h-[calc(100vh-57px)]">
          {/* Paste modal */}
          {pasteMode && (
            <div className="border-b p-4 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Paste a markdown note</h3>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setPasteMode(false)}>
                  <X className="size-4" />
                </Button>
              </div>
              <Input
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                placeholder="Note title (optional)"
                className="mb-2"
              />
              <Textarea
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                placeholder="Paste markdown here. Headings (#) create chunk boundaries."
                className="min-h-[120px] font-mono text-xs"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPasteMode(false)}>Cancel</Button>
                <Button size="sm" onClick={ingestPaste} disabled={importing}>
                  {importing ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Upload className="size-4 mr-1.5" />}
                  Save & index
                </Button>
              </div>
            </div>
          )}

          {/* Messages */}
          <ScrollArea className="flex-1">
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
              {messages.length === 0 ? (
                <EmptyState hasNotes={notes.length > 0} />
              ) : (
                messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))
              )}
            </div>
          </ScrollArea>

          {/* Composer */}
          <div className="border-t bg-background/95 backdrop-blur p-3">
            <div className="max-w-3xl mx-auto">
              {activeFilterCount > 0 && (
                <div className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <Filter className="size-3" />
                  Searching only in {activeFilterCount} selected note{activeFilterCount === 1 ? '' : 's'}.
                  <button className="text-primary hover:underline" onClick={() => setFilterNoteIds(new Set())}>
                    Clear
                  </button>
                </div>
              )}
              <div className="relative">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask anything about your notes… (Enter to send, Shift+Enter for newline)"
                  className="pr-12 min-h-[44px] max-h-44 resize-y"
                  disabled={streaming}
                />
                <Button
                  size="icon"
                  className="absolute right-1.5 bottom-1.5 size-8"
                  onClick={sendMessage}
                  disabled={streaming || !input.trim()}
                  aria-label="Send message"
                >
                  {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground/70 mt-1 flex items-center gap-1">
                <CornerDownLeft className="size-3" /> to send
                <span className="mx-1">·</span>
                <Sparkles className="size-3" /> RAG with inline [^c1] citations
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

// ---------- sub-components ----------
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] ${isUser ? 'order-2' : ''}`}>
        <div
          className={
            isUser
              ? 'rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap'
              : 'rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap'
          }
        >
          {isUser ? message.content : renderCitationsInline(message.content)}
          {message.pending && (
            <span className="inline-flex items-center gap-1 ml-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
            </span>
          )}
        </div>
        {!isUser && message.citations.length > 0 && !message.pending && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Sources</p>
            {message.citations.map((c, i) => (
              <a
                key={c.chunkId}
                id={`cite-c${i + 1}`}
                href="#"
                className="block text-xs bg-background border rounded-md p-2 hover:border-primary/40 transition-colors no-underline"
                onClick={(e) => e.preventDefault()}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground line-clamp-1">{c.noteTitle}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0">c{i + 1}</Badge>
                </div>
                {c.heading && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{c.heading} · chunk {c.ordinal}</p>
                )}
                <p className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-2">{c.preview}</p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ hasNotes }: { hasNotes: boolean }) {
  return (
    <div className="py-16 text-center max-w-md mx-auto">
      <div className="size-14 rounded-full bg-primary/10 grid place-items-center mx-auto mb-4">
        <Sparkles className="size-7 text-primary" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Chat with your notes</h2>
      <p className="text-sm text-muted-foreground">
        {hasNotes
          ? 'Ask a question — answers are grounded in your imported notes with inline citations.'
          : 'Import markdown notes (drag-and-drop .md files anywhere, or use the Import button) to start chatting.'}
      </p>
    </div>
  )
}
