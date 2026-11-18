# Task 13 — YouTube Transcript RAG (Builder Work Record)

**Task ID:** 13
**Agent name:** youtube-transcript-rag-builder
**Project location:** `/home/z/my-project/apps/13-youtube-transcript-rag/`
**Status:** Complete (all 116 tests pass, lint clean, git commit `925fdc3`)

## What was built

Project #13 — **YouTube Transcript RAG** — built as a separate Next.js 16
subdirectory inside the parent portfolio. The app lets you paste a YouTube
URL, ingest the transcript, and ask questions across videos with
timestamp-anchored citations that jump to the moment in an embedded
YouTube IFrame player.

### Files written (55 tracked by git)

- **Config (10):** `package.json`, `tsconfig.json`, `next.config.ts`,
  `postcss.config.mjs`, `tailwind.config.ts`, `components.json`,
  `eslint.config.mjs`, `.env.example`, `.gitignore`, `LICENSE`
- **Prisma (1):** `prisma/schema.prisma` (Video / Chapter / VideoChunk /
  ChatSession / ChatMessage)
- **Local env (NOT tracked):** `.env` and `.env.local` with the absolute
  `DATABASE_URL` pointing at MY subdirectory's `db/custom.db`
- **App routes (8):** `src/app/layout.tsx`, `src/app/globals.css`,
  `src/app/page.tsx` (the only user-visible route — 3-column layout),
  `src/app/api/videos/route.ts` (GET list),
  `src/app/api/videos/import/route.ts` (POST URL → transcript → chunks),
  `src/app/api/videos/[id]/route.ts` (GET with chapters + DELETE),
  `src/app/api/chat/route.ts` (POST streaming RAG),
  `src/app/api/stats/route.ts`
- **UI components (11):** button, card, input, textarea, badge,
  scroll-area, separator, skeleton, toast, toaster, checkbox (copied
  from Project #11 — same shadcn/ui New York style)
- **Hooks (1):** `use-toast.ts`
- **Lib (13):** utils, db (Prisma singleton), tokenizer, embeddings
  (hashing + OpenAI-compat incl. Ollama), bm25, hybrid-search (RRF),
  retrieval (video-aware corpus cache), ai (ChatProvider + RAG prompt
  builder with timestamp mentions), chunker (timestamped windows +
  overlap), url-parser (11-char ID extraction from any URL shape),
  chapter-detector (gap + cosine-distance split + LLM title prompt),
  timestamp-format (`mm:ss` / `h:mm:ss`), youtube (transcript fetch
  with timedtext fallback), youtube-meta (watch-page HTML scrape)
- **Tests (9 files, 116 tests):** url-parser (28 tests), timestamp-format
  (14), chunker (12), chapter-detector (20), tokenizer (7), embeddings
  (8), bm25 (6), hybrid-search (8), ai (11)

### Decisions made

1. **Single-video ingestion only for MVP.** Channel ingestion was
   documented as a stretch goal in the README. The MVP focus is the
   timestamp-anchored citation UX.
2. **30-second chunk windows with 5-second overlap.** Matches the spec.
   The chunker is pure (no IO), so the 12 chunker tests run in <2ms.
3. **Heuristic + LLM chapter titles.** Heuristic = "first 6 words,
   stripped of markdown control chars". LLM call is one batched
   `complete()` per video; on failure or malformed JSON, heuristic
   stands.
4. **`youtube-nocookie.com` embed with `enablejsapi=1`.** Citation chips
   and chapter clicks `postMessage` `{seekTo, playVideo}` commands to
   the iframe. When the cited video is different from the active one,
   the iframe's React `key={youtubeId-startSec}` forces a remount with
   the new `start` URL param.
5. **Chat footer carries `activeVideoId` + `activeStartSec`.** The
   client auto-focuses the player on the FIRST cited video before the
   user clicks any chip — so the moment the answer streams in, the
   player is already cued.
6. **`db:push` script uses inline `DATABASE_URL="$(pwd)/db/custom.db"`.**
   This is the Prisma CLI footgun the brief warned about — without an
   absolute path, `prisma db push` walks up the tree and can mutate the
   parent's database schema. Verified parent DB schema is unchanged:
   `Note.path` column still present, 3 Notes, 10 NoteChunks intact.

### Verification

- `bun test` → 116 pass, 0 fail, 195 expect() calls, ~33ms
- `bun run lint` → 0 errors, 0 warnings (exit 0)
- Parent DB schema check:
  `bun -e 'import { db } from "/home/z/my-project/src/lib/db"; console.log(await db.note.findFirst({ select: { path: true } }))'`
  → `{"path":null,"title":"architecture"}` — Note table with `path`
  column is intact. Parent DB has 3 Notes and 10 NoteChunks (unchanged).
- My DB at `/home/z/my-project/apps/13-youtube-transcript-rag/db/custom.db`
  has the correct schema (Video, Chapter, VideoChunk, ChatSession,
  ChatMessage). Verified by `strings db/custom.db | grep CREATE TABLE`.
- Git commit: `925fdc3b8020ee79fc2fd5a73779de0c993ec842` with full
  descriptive body (first line: "feat: YouTube Transcript RAG — Phase 1
  Project #13"). 55 files tracked.

### Gotchas / lessons learned

- **Prisma CLI loaded the parent's `.env`** in the sandbox because
  bun's process inherits the parent's `DATABASE_URL` from the shell
  environment. The `bun -e` queries were connecting to the parent's db
  until I set `DATABASE_URL` explicitly on the command line. The Next.js
  dev server would load `.env.local` correctly (Next.js looks in the
  app directory), so the actual app works. The `package.json` `db:*`
  scripts use inline `DATABASE_URL="$(pwd)/db/custom.db"` to be
  bulletproof even when the shell env is wrong.
- **`prisma db push` reports "already in sync"** even when the actual
  tables don't match the schema, because it relies on the `_prisma_migrations`
  shadow table. Using `--force-reset` was needed once to actually wipe
  and recreate the schema. After that, the regular `db:push` keeps it
  in sync.
- **Chunker overlap logic.** The first version of the chunker had a
  bug where the overlap region was computed as `windowStart + overlapSec`
  (cutoff AFTER the window start) instead of `windowEnd - overlapSec`
  (the last `overlapSec` of the window). This meant with `overlapSec=0`,
  every caption in the window was carried forward to the next window,
  producing infinite chunks. Rewrote to compute the next window's
  start as `windowEnd - overlapSec` (the last `overlapSec` becomes the
  first `overlapSec` of the next window).
- **`heuristicChapterTitle` regex.** The first version didn't strip
  hyphens, so `Intro - the *basics* of _RAG_` produced
  `Intro - the basics of RAG` (with the dash). I kept the dash in the
  output (it's meaningful in titles) and adjusted the test expectation
  accordingly.

### What's NOT done

- Channel ingestion (documented as stretch goal in README)
- Push to GitHub (per spec — left as a `gh repo create` instruction in
  the README)
- Live `next dev` run (per spec — not run by the builder)
- End-to-end browser testing (would need a live dev server, which the
  spec forbids)

### User push command

```bash
gh repo create youtube-transcript-rag --public --source=. --remote=origin --push
```
