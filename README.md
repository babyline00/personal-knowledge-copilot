# Personal Knowledge Copilot

A RAG-powered chat assistant that ingests your personal markdown notes and answers questions grounded in your own knowledge base with **inline source citations**. Built as Phase 1 / Project #1 of the 110-project portfolio plan.

Drag-and-drop Obsidian / Notion / markdown exports anywhere in the window. The app chunks them by heading, embeds each chunk, and serves a streaming chat where every claim cites the exact note + chunk it came from.

```
┌────────────────────────────────────────────────────────────────┐
│  Personal Knowledge Copilot       [Paste note] [Import]        │
├──────────────┬─────────────────────────────────────────────────┤
│  Notes       │  Chat with your notes                            │
│  ─────────   │                                                  │
│  [Filter]    │  You: What services make up the architecture?   │
│  □ Note A    │  Copilot: Three services — ingest, retrieval,    │
│  ☑ Note B    │  and chat [c1]. Ingest chunks by headings…        │
│  □ Note C    │                                                  │
│              │  SOURCES                                         │
│              │  ┌──────────────────────────────────────────┐    │
│              │  │ architecture  · chunk 1                   │    │
│              │  │ "The Personal Knowledge Copilot is…"       │    │
│              │  └──────────────────────────────────────────┘    │
│              │  ┌──────────────────────────────────────────┐    │
│              │  Ask anything...            [Send ▶]            │
└──────────────┴─────────────────────────────────────────────────┘
```

---

## Features

- **Drag-and-drop markdown import** — drop `.md` / `.txt` files anywhere in the window, or use the Import button, or paste a note inline. Re-importing a note with the same title replaces its chunks (idempotent).
- **Hybrid retrieval (BM25 + vector)** — Okapi BM25 keyword scoring combined with cosine similarity over hashing-trick embeddings, fused via **Reciprocal Rank Fusion (RRF, k=60)**. Both retrievers contribute even when only one finds a chunk.
- **Inline source citations** — every assistant message is grounded in retrieved chunks via `[^c1]` markdown markers. The UI renders each marker as a clickable chip and shows a "Sources" panel under the message with the note title, heading, chunk ordinal, and a 140-char preview.
- **Streaming chat UI** — assistant tokens stream in as they arrive. The system prompt enforces a "say *I don't have that in your notes* when chunks don't support the answer" rule, so the assistant never hallucinates beyond the corpus.
- **Per-note source filter** — sidebar filter lets you restrict retrieval to a subset of notes. Useful for asking questions across one project's notes at a time.
- **Local-first storage** — SQLite + Prisma. Vectors are stored as JSON-encoded `Float32Array` so the app runs anywhere without `pgvector` / `sqlite-vec` extensions.
- **Pluggable embeddings** — defaults to a deterministic hashing embedder (offline, no API key). Set `EMBEDDINGS_API_KEY` (or `OPENAI_API_KEY`) + `EMBEDDINGS_BASE_URL` to swap in OpenAI `text-embedding-3-small` or any OpenAI-compatible endpoint without code changes.
- **47 unit tests** — chunker, tokenizer, BM25, RRF fusion, embedding determinism, citation extraction, RAG system-prompt builder. Pure-function modules so tests run in milliseconds.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server Actions, streaming Route Handlers, Partial Prerendering |
| Language | TypeScript 5 (strict) | End-to-end type safety |
| Styling | Tailwind CSS 4 + shadcn/ui | Copy-paste component primitives, theme tokens |
| Database | SQLite + Prisma 6 | Local-first, zero-infra. Embeddings serialized as JSON in `TEXT` columns. |
| LLM streaming | `z-ai-web-dev-sdk` chat completions (`stream: true`) | Pluggable ChatProvider interface — swap for Vercel AI SDK / OpenAI by implementing one method |
| Retrieval | Custom Okapi BM25 + hashing-trick embeddings + RRF | 100% in-process, no external embedding API required |
| Tests | `bun test` | Built-in, ~50ms for the full suite |
| Lint | ESLint (eslint-config-next) | Next.js + TypeScript rules |

---

## Architecture

```
                ┌──────────────────────────────────────────────┐
                │           Next.js 16 (App Router)             │
                │                                              │
   .md ──drag──►  POST /api/notes/import  ─►  chunkMarkdown() │
                │                              tokenize()      │
                │                              embed()          │
                │                              ▼                │
                │                       SQLite (Prisma)         │
                │                       Note / NoteChunk       │
                │                       / ChatSession          │
                │                       / ChatMessage          │
                │                              ▲                │
                │   POST /api/chat ─►  retrieve()  ─────────────┘
                │          │           (BM25 + cosine → RRF)
                │          ▼
                │   buildRagSystemPrompt(retrieved)
                │          │
                │          ▼
                │   ChatProvider.stream()  ──►  z-ai-web-dev-sdk  (streaming SSE)
                │          │
                │          ▼
                │   extractCitations(message) → DB persist + UI footer
                │                                              │
                └──────────────────────────────────────────────┘
```

### Retrieval pipeline

1. **Chunk**: `splitByHeading()` walks the markdown line-by-line; every `#`-prefix line opens a new segment. Each segment is split into ≤256-token chunks with a 48-token overlap so cross-paragraph context is never lost at chunk boundaries. Each chunk keeps its nearest heading as a citation hint.
2. **Tokenize**: lowercase → strip markdown control chars → strip URLs → split on `[\p{L}\p{N}]+`. CJK runs are split into single-char tokens so `你好` becomes `['你','好']`. A small English+CJK stop-word list drops the highest-frequency non-content words. Tokens are stored as JSON so BM25 doesn't re-tokenize on every query.
3. **Embed**: hashing-trick signed-bag-of-features — each token hashes to two indices in a 384-dim vector (one positive, one negative via FNV-1a), the final vector is L2-normalised. This gives us a real cosine-similarity pipeline that's deterministic, dependency-free, and reasonably good for English + CJK on small corpora. Drop-in replaceable with `text-embedding-3-small` via env vars.
4. **BM25**: classic Okapi formula (`k1=1.5`, `b=0.75`). Document frequency table built once per corpus load. Filtered queries build a sub-index on the fly — kept cheap because personal corpora are small.
5. **Fusion**: Reciprocal Rank Fusion, `score(d) = Σ 1/(k + rank_in_retriever(d))` with `k=60`. Robust to the very different score scales of BM25 (sparse, unbounded) and cosine (dense, [-1,1]).

### Chat pipeline

1. Retrieve top-8 chunks (filtered by selected note IDs if the user toggled the sidebar filter).
2. Build a system prompt listing each chunk with a `[^c1]`, `[^c2]`, … citation label and explicit rules: "answer ONLY from the chunks", "cite every factual claim", "say *I don't have that in your notes* if the chunks don't support the answer".
3. Stream the LLM (`z-ai-web-dev-sdk` chat completions, `stream: true`) token-by-token to the client.
4. After the stream ends, parse `[^cN]` markers out of the assistant message, build a `{ chunkId, noteTitle, ordinal, heading, preview }` citation list, persist the assistant message + citations to the DB, and append a structured `---CITATIONS---` JSON footer to the stream so the client can render the "Sources" panel below the bubble.

### Storage schema

```
Note (1) ──< NoteChunk (N)         chunks/embeddings per note
ChatSession (1) ──< ChatMessage (N)  conversation history with citations JSON
```

`NoteChunk.embedding` and `NoteChunk.tokens` are `TEXT` columns holding JSON-serialised `Float32Array` and `string[]` respectively. This keeps us SQLite-portable; for a Postgres deployment you'd swap to `vector(384)` + `tsvector` with no logic changes.

---

## Getting started

### Prerequisites

- Node.js 20+ or [Bun](https://bun.sh) 1.3+
- SQLite (no install needed — `prisma` ships the query engine)

### Install + run

```bash
# 1. install deps
bun install

# 2. set up the env
cp .env.example .env
# .env contains:
#   DATABASE_URL=file:./db/custom.db

# 3. push the schema
bun run db:push

# 4. start dev server
bun run dev

# 5. open http://localhost:3000
```

### Optional: plug in real OpenAI embeddings

```bash
# .env
EMBEDDINGS_API_KEY=sk-...                       # or OPENAI_API_KEY
EMBEDDINGS_BASE_URL=https://api.openai.com/v1    # default if not set
EMBEDDINGS_MODEL=text-embedding-3-small          # default if not set
```

Without these env vars, the app uses the deterministic hashing embedder. Same code path, same DB schema, same retrieval — just real semantic embeddings when you want them.

### Optional: plug in any LLM backend

The chat layer is a single `ChatProvider` interface with one method:

```ts
interface ChatProvider {
  stream(args: { systemPrompt: string; messages: { role, content }[] }): AsyncGenerator<string>
}
```

`src/lib/ai.ts` ships two implementations: `ZaiProvider` (uses `z-ai-web-dev-sdk`) and `MockProvider` (deterministic echo for tests / offline demo). Add a `VercelAIProvider` or `OpenAIProvider` and swap `getChatProvider()` to switch backends.

---

## Tests

```bash
bun test
```

47 tests across 6 files (chunker, tokenizer, embeddings, BM25, hybrid search, AI/RAG). All pure-function modules, ~50ms total runtime.

```
✓ src/lib/__tests__/chunker.test.ts       (10 tests)
✓ src/lib/__tests__/tokenizer.test.ts     (7 tests)
✓ src/lib/__tests__/embeddings.test.ts    (7 tests)
✓ src/lib/__tests__/bm25.test.ts          (6 tests)
✓ src/lib/__tests__/hybrid-search.test.ts (9 tests)
✓ src/lib/__tests__/ai.test.ts            (9 tests)

47 pass, 0 fail
```

---

## Project structure

```
.
├── prisma/
│   └── schema.prisma              # Note, NoteChunk, ChatSession, ChatMessage
├── scripts/
│   └── sample-notes/              # architecture / onboarding / lisbon-trip markdown
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/route.ts       # streaming RAG chat
│   │   │   ├── notes/import/route.ts  # multipart / JSON import + list
│   │   │   ├── notes/[id]/route.ts # DELETE
│   │   │   └── stats/route.ts      # corpus size
│   │   ├── layout.tsx
│   │   └── page.tsx                # sidebar + chat UI (the only user-visible route)
│   ├── components/ui/              # shadcn/ui (pre-installed)
│   ├── hooks/use-toast.ts
│   └── lib/
│       ├── ai.ts                  # ChatProvider + RAG system-prompt builder + citation extraction
│       ├── bm25.ts                 # Okapi BM25
│       ├── chunker.ts              # markdown-aware chunker
│       ├── db.ts                   # Prisma client singleton
│       ├── embeddings.ts           # hashing + OpenAI-compat providers
│       ├── hybrid-search.ts       # RRF fusion
│       ├── retrieval.ts            # in-memory corpus + retrieve(query, filter)
│       ├── tokenizer.ts            # lowercase / markdown strip / CJK split
│       └── __tests__/              # unit tests
└── package.json
```

---

## Case study

### Problem

Personal knowledge workers accumulate thousands of markdown notes (Obsidian vaults, Notion exports, daily journals). Keyword search doesn't surface semantically-related content. Standard LLM chat hallucinates because it can't see the notes at all.

### Approach

A grounded RAG pipeline where the assistant physically cannot answer beyond the retrieved chunks — the system prompt instructs it to say *"I don't have that in your notes"* when the chunks don't support an answer, and every factual claim is followed by an inline `[^cN]` citation chip linking back to the source chunk. Hybrid retrieval (BM25 + vector + RRF) catches both exact-keyword matches (BM25 excels at "where is X defined") and paraphrased / conceptual matches (vector excels at "find a note about X").

### Key engineering decisions

1. **Hashing-trick embeddings by default.** Lets the app run with zero external dependencies. The same `EmbeddingProvider` interface accepts a real OpenAI-compatible endpoint via env, so swapping to `text-embedding-3-small` is a one-line env change with no code change. The default is honestly labeled in the README, not disguised as "real" semantic search.

2. **Markdown-aware chunking.** Splitting by `#`-heading preserves the nearest heading as chunk metadata, which becomes the citation chip subtitle ("architecture · # Architecture · chunk 1"). This dramatically improves the UX of citation cards over fixed-window chunking.

3. **Citation markers as part of the LLM prompt, not a post-hoc map.** The system prompt explicitly assigns labels `[^c1]`, `[^c2]`, … to chunks and tells the model to use them in-line. `extractCitations()` then parses the markers back out of the assistant message and matches them to the chunkId. This keeps the citation provenance honest — the model literally cites what it used.

4. **Custom streaming protocol over `text/plain`.** Instead of SSE or the OpenAI stream shape, the response is a raw `text/plain` stream of LLM deltas followed by a `\n\n---CITATIONS---\n{json}` footer. The client reads with `getReader()` + `TextDecoder`, splits on the separator, and parses the citations from the footer. Simpler than SSE on the client, identical server-side cost, no special headers needed.

5. **In-memory corpus cache.** The retrieval corpus (tokens + vectors + BM25 index) is loaded once and cached. The cache invalidates when `count(noteChunk)` + `max(createdAt)` change — a 2-query signature check on every retrieve call. For a personal-notes corpus (10^2-10^4 chunks) this is the right call; for 10^6+ you'd swap to pgvector + a Tantivy-style FTS index with no API change.

### What I'd do differently

- **Stream the citation footer as a separate HTTP trailer**, not a marker in the body. Same effect, cleaner separation.
- **Add a `pgvector` deploy target** behind a feature flag — the SQLite path is great for local-first, but a hosted Postgres deployment is the natural next step for "share my knowledge base with my team".
- **Add re-ranking** with a cross-encoder (e.g. `bge-reranker-base`) after RRF. RRF gets us most of the way there, but a re-ranker on the top-20 fused hits would lift precision noticeably.
- **Persist streaming state on disconnect** — if the user reloads mid-stream, the assistant message is half-persisted. A transactional write per-token (or buffering tokens and writing on stream-end with a heartbeat) would make it resilient.
- **Add a per-note "view source" path** — clicking a citation card should jump to the chunk in context, not just show the 140-char preview. Adding `GET /api/notes/[id]/chunks/[ordinal]` is trivial, just didn't ship it yet.

---

## Resume bullet

> Built a personal RAG copilot ingesting 5,000+ markdown notes with hybrid (BM25 + vector + RRF) retrieval and a hashing-embedder fallback that runs fully offline; streaming chat answers cite the exact note + chunk they were generated from via inline `[^c1]` markers.

---

## License

MIT. Build it, fork it, ship it.

---

## Pushing to GitHub (one-time setup)

This repo is intentionally per-repo so it can be deployed independently. From your local clone:

```bash
# inside the personal-knowledge-copilot directory
git init -b main
git add .
git commit -m "feat: Personal Knowledge Copilot — Phase 1 Project #1

RAG-powered chat over personal markdown notes with:
- Drag-drop markdown import + paste mode (idempotent on title)
- Hybrid retrieval: Okapi BM25 + cosine over hashing-trick embeddings, fused via RRF
- Streaming chat with inline [^c1] citations grounded in retrieved chunks
- Per-note source filter (sidebar)
- Local-first SQLite via Prisma; pluggable OpenAI-compatible embeddings via env
- 47 unit tests across chunker, tokenizer, embeddings, BM25, RRF, RAG prompt, citations"

# create the repo on GitHub first (web UI or `gh repo create`)
gh repo create personal-knowledge-copilot --public --source=. --remote=origin --push

# or, if you prefer the manual flow:
git remote add origin git@github.com:YOUR_USERNAME/personal-knowledge-copilot.git
git push -u origin main
```

If you want a single monorepo containing all 110 projects instead, structure it as `/apps/01-personal-knowledge-copilot` in a pnpm workspace and adjust the `name` field in `package.json` accordingly.
