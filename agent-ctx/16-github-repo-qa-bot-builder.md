# Project #16 — GitHub Repo Q&A Bot — Builder Agent Record

## Task
Build the GitHub Repo Q&A Bot from the 110-project portfolio plan as a
standalone Next.js 16 project in `/home/z/my-project/apps/16-github-repo-qa-bot/`
— separate from the parent `/home/z/my-project` (Project #1, already committed).

## Spec highlights
- Single public GitHub repo ingestion (unauthenticated API, 60 req/hr).
- AST-aware chunking via `tree-sitter` + `tree-sitter-typescript` for TS/JS.
- Regex 50-line chunker fallback for .py/.go/.rs/.md.
- Hybrid BM25 + hashing-embedding retrieval (RRF fusion).
- Streaming chat with `[^c1]` citations + `file:line` references + "Open on GitHub" deep links.
- Per-file filter sidebar (multi-select).
- "Where used" panel — whole-word substring lookup across all ingested files.
- 35+ tests; we delivered 144 tests across 9 files.

## Prisma isolation
- Subdirectory `.env` has absolute `DATABASE_URL=file:/home/z/my-project/apps/16-github-repo-qa-bot/db/custom.db`.
- `package.json` `db:push` / `db:generate` scripts inline `DATABASE_URL=$(pwd)/db/custom.db` so a missing `.env` doesn't fall through to the parent.
- `db:push` ran successfully; subdirectory `db/custom.db` is 61440 bytes.
- Parent `db/custom.db` (86016 bytes) and parent `prisma/schema.prisma` (with Note + NoteChunk + ChatSession + ChatMessage) are unchanged.

## Files
- 44 TypeScript/TSX source files (12 shadcn/ui components, 12 lib modules, 9 test files, 7 API routes, layout/page/globals).
- 144 tests pass (0 fail).
- `bun run lint` exits 0.

## AST chunker design notes
- Iterates top-level `program` named children only — does NOT recurse into function bodies so nested helpers stay part of their enclosing function.
- Handles `function_declaration`, `generator_function_declaration`, `class_declaration` (+ emits each `method_definition` as its own chunk), `lexical_declaration`/`variable_declaration` when the value is an `arrow_function` or `function_expression`, `export_statement` (unwraps the inner statement), `expression_statement` for top-level IIFEs (`(function(){...})()` — the function is wrapped in `parenthesized_expression`, so we walk one extra level).
- `import_statement`, `interface_declaration`, `type_alias_declaration`, bare constants are NOT chunked.
- Anonymous functions get `<anonymous-N>` as the symbolName.
- Bug found and fixed: tree-sitter's SyntaxNode uses `isNamed`, not `named`. Initial implementation skipped every node because the `.named` field was `undefined`.

## URL parser design notes
- Accepts: `https://github.com/owner/repo`, `https://github.com/owner/repo/tree/branch`, `https://github.com/owner/repo/blob/branch/file`, `git@github.com:owner/repo.git`, `owner/repo`, `github.com/owner/repo`, URLs with `.git` suffix, URLs with query strings.
- Rejects: gitlab/bitbucket URLs, single-segment paths (e.g. `github.com/trending`), bad SSH hosts, owners with invalid chars.
- The shorthand path was tricky — `vercel/next.js` has a dot in the repo name, and `new URL('vercel/next.js')` treats `vercel` as the host. Solution: short-circuit shorthand before URL parsing when there's no `://` and try a 2-segment OR 3-segment-with-github.com regex.

## Where-used design notes
- Whole-word, case-sensitive regex `\bSYMBOL\b`.
- Strips inline `//`, `#`, `--` comments (preserving `https://` inside strings).
- Whole-line comment markers (`//`, `#`, `--`, `/*`, `*` for JSDoc continuation, `<!--`) drop the line entirely.
- Dedupes `lineMatches` (line numbers) but keeps `matches` (per-occurrence with column).

## Tech stack
- Next.js 16 (App Router), TypeScript 5 (strict), Tailwind 4 + shadcn/ui (New York).
- Prisma 6 + SQLite (absolute DATABASE_URL).
- `tree-sitter` 0.25 + `tree-sitter-typescript` 0.23.
- `z-ai-web-dev-sdk` for LLM streaming (config at `/etc/.z-ai-config`).
- Default embeddings = deterministic 384-dim hashing embedder (no API key).
- `bun test` for unit tests; `eslint-config-next` for lint.

## Limitations / TODOs
- Unauthenticated GitHub API = 60 req/hr per IP — biggest user-visible constraint. Set `GITHUB_TOKEN` to lift to 5000/hr.
- Per-file size hard-cap at 250KB before chunking (truncated with a comment).
- AST chunker does not extract `interface_declaration` / `type_alias_declaration` as RAG chunks — those are intentionally left for "where used" lookup. A future version could chunk them too.
- The "where used" lookup uses a regex heuristic to skip comments; it does not skip symbol mentions inside string literals (e.g. `const s = "foo"` would match `foo`). A real version would track string ranges via tree-sitter.
- The retrieval cache is per-repo and in-memory. For > 10⁵ chunks per repo, swap in pgvector / Tantivy.
- Import is synchronous (10s for a small repo). A real version would use a job queue + WebSocket progress events.

## Parent DB verification
After running `bun run db:push` in the subdirectory, the parent DB was untouched:
```
bun -e 'import { db } from "/home/z/my-project/src/lib/db"; console.log(await db.note.findFirst({ select: { path: true, title: true } }))'
# -> {"path":null,"title":"architecture"}
```

## Commit
Single local commit in the subdirectory (no push). `feat: GitHub Repo Q&A Bot — Phase 2 Project #16`.
