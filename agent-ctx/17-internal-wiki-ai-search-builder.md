# Project #17 — Internal Wiki AI Search (Builder Record)

**Agent**: main agent (single-pass, no subagents dispatched)
**Task ID**: 17-internal-wiki-ai-search
**Spec source**: 110-project portfolio plan, RAG Systems & Knowledge Bases category, Medium difficulty
**Location**: `/home/z/my-project/apps/17-internal-wiki-ai-search/`
**Commit**: NONE (per instructions — user commits)

## What was built

A 3-column enterprise wiki RAG app with:
- Header role-picker (chip group: engineering / finance / executive / all + custom-user dialog).
- Left panel: RBAC-filtered wiki page list with source badges (md / conf / notion / slack / drive), per-page access tags, "Add page" dialog (title + markdown + access tags), per-page delete.
- Center column: streaming chat with inline `[^c1]` citations, citations footer (source badge + page title + external URL + access tags + preview), amber "denied" bubble for safe-mode.
- Right panel: tabbed — Chat tips / Admin dashboard (corpus stats, per-tag distribution bar chart, last 10 audit log entries with denied flag).
- Backend routes:
  - `POST /api/wiki/import` (idempotent on `(source, title)`)
  - `GET  /api/wiki?userId=xxx` (RBAC-filtered)
  - `DELETE /api/wiki/[id]`
  - `POST /api/chat` (streaming RAG + RBAC + audit log + safe-mode short-circuit)
  - `GET /api/admin/stats`
  - `GET /api/users` (seeds 4 defaults), `POST /api/users`

## RBAC + safe-mode design

Per-chunk `accessTags` (denormalized from the parent page) intersected with `user.roles`.
Post-filter approach: rank full corpus with BM25+vector (RRF k=60), then drop chunks the user
can't see, then re-slice to topK. Over-fetch factor 4 to leave headroom.

Two-layer safe mode:
- Hard (0 chunks after filter): LLM not called, return canonical
  "I don't have access to anything relevant in your wiki. Contact your admin to request access."
- Soft (chunks retrieved but insufficient): system prompt instructs LLM to say
  "I don't have that in the wiki." rather than fabricate.

Every query writes an `AuditLog` row with `userId / query / chunksReturned / denied`.
Denied queries surface in the admin dashboard audit log with an amber flag.

## File count
55 files written (1 call each via Write — no incremental edits).

## Test count
89 tests across 8 files, all passing on first run (`bun test`).
Bun's module resolution picked up `@prisma/client` from the parent project's
`node_modules`, so the `ai.test.ts` (which transitively imports `@/lib/db`) ran
without needing a local `bun install`.

Test breakdown:
- tokenizer.test.ts — 9
- chunker.test.ts — 12
- embeddings.test.ts — 9
- bm25.test.ts — 7
- hybrid-search.test.ts — 8
- access-filter.test.ts — 21 (the RBAC core)
- audit.test.ts — 11
- ai.test.ts — 13 (RAG system prompt + citation map + ChatProvider mock)

## Files NOT done / limitations
- `bun install` was NOT run (per instructions). Tests pass because Bun resolves
  the parent's `@prisma/client` from `/home/z/my-project/node_modules`. The
  user should still run `bun install` before `bun run dev` (Next.js runtime
  will need `next`, `react`, `react-dom` in the local node_modules).
- `bun run db:push` was NOT run. The user must run it to create
  `./db/custom.db` before launching the app.
- `bun run lint` was NOT run (per instructions).
- `.env` was NOT created (only `.env.example`). The user copies it.
- No git operations performed.

## Push command for the user
```bash
gh repo create internal-wiki-ai-search --public --source=. --remote=origin --push
```

## Resume bullet (from the portfolio plan)
Built enterprise wiki AI search across 4 sources with SCIM/RBAC and safe-mode
fallback, deployed to 1,200 employees.
