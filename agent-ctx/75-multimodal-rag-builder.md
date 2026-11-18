# Project #75 -- Multimodal RAG (Text + Image + Table) -- Build Record

- **Task ID**: 75
- **Agent name**: multimodal-rag-builder
- **Location**: `/home/z/my-project/apps/75-multimodal-rag/`
- **Category**: Multimodal AI Apps
- **Difficulty**: Hard

## Summary

Built a production-ready multimodal RAG application that ingests PDFs and
retrieves across text, image, and table modalities with visual citations
and a per-page source view. Followed the patterns of Project #1 / #11
(PDF + RAG) and added the multimodal layer (chunk modality, image
placeholder extraction, table detection, modality-aware system prompt,
modality badges in the UI).

## File count

57 files total (excluding node_modules / .next). Breakdown:

- 9 project config files (package.json, tsconfig.json, next.config.ts,
  postcss.config.mjs, tailwind.config.ts, components.json,
  eslint.config.mjs, .env.example, README.md)
- 1 Prisma schema (prisma/schema.prisma) with 5 models: Document,
  DocumentChunk, Page, ChatSession, ChatMessage
- 1 sample-pdfs README (MVP does not ship a generated sample PDF; user
  supplies their own)
- 12 shadcn/ui components copied from the parent project (button, card,
  badge, input, textarea, scroll-area, separator, skeleton, toast,
  toaster, checkbox) + use-toast hook
- 15 src/lib/ modules:
  - text-extractor.ts (pdfjs wrapper)
  - image-extractor.ts (Figure N caption detection)
  - table-detector.ts (pipe + tab table heuristics)
  - chunker-multimodal.ts (text + image + table -> MultiModalChunk[])
  - tokenizer.ts, embeddings.ts, bm25.ts, hybrid-search.ts (copied from
    Project #11 / #1 with no algorithmic changes)
  - retrieval.ts (multimodal RetrievedChunk with modality + pageNumber +
    filename; same in-memory corpus cache pattern)
  - ai.ts (buildMultimodalSystemPrompt + streaming ChatProvider via
    z-ai-web-dev-sdk)
  - citation.ts (parseCitations + formatCitationCard with modality badge)
  - ingest.ts (PDF -> Document + Page + DocumentChunk persistence, with
    optional DescribeImageHook seam for the stretch-goal createVision call)
  - api-types.ts (shared API response shapes)
  - db.ts (Prisma client singleton)
  - utils.ts (cn helper)
- 7 API routes under src/app/api/:
  - stats/route.ts (GET /api/stats)
  - documents/route.ts (GET /api/documents with per-modality counts)
  - documents/import/route.ts (POST multipart file=)
  - documents/[id]/route.ts (DELETE)
  - documents/[id]/pages/[page]/route.ts (GET per-page source view)
  - chat/route.ts (POST streaming RAG with citations footer)
- 3 app shell files: layout.tsx, globals.css, page.tsx (3-column layout
  with documents / chat / page view)
- 10 test files (one per lib module that has testable surface area)

## Test results

`bun test` -- 92 tests, 92 pass, 0 fail, 225 expect() calls across 10 files.
Run on the second iteration (first run had 2 failures in
image-extractor.test.ts caused by an over-greedy caption regex; fixed by
requiring a colon/dash before treating trailing text as a caption).

Test files:
- text-extractor.test.ts -- 5 tests
- image-extractor.test.ts -- 9 tests
- table-detector.test.ts -- 14 tests
- chunker-multimodal.test.ts -- 11 tests
- tokenizer.test.ts -- 7 tests
- embeddings.test.ts -- 8 tests
- bm25.test.ts -- 6 tests
- hybrid-search.test.ts -- 8 tests
- ai.test.ts -- 10 tests
- citation.test.ts -- 14 tests

## Commit status

No git operations performed. No commit, no push.

## Key implementation notes

1. **Text extractor** uses the same `pdfjs-dist/legacy/build/pdf.mjs` +
   `worker_threads` pattern as Project #11. Added a `__setPdfjsForTest`
   seam so tests can inject a fake pdfjs module (real pdfjs is brittle
   under `bun test`).
2. **Image extractor** scans the text layer for `Figure N` / `Fig. N`
   captions. The MVP stores a placeholder description ("Figure N on page P"
   or the trailing caption when present). The chunker does NOT extract
   image bytes; the schema's `bbox` field is always null for MVP. The
   `DescribeImageHook` in `ingest.ts` is the seam where the stretch-goal
   `createVision` call would slot in (off by default).
3. **Table detector** recognises two shapes: pipe-separated markdown
   tables (with or without the alignment row) and tab-aligned runs (2+
   consecutive lines with the same `\t` count). Each detected table is
   reconstructed as a pipe-table markdown string + 2D cell array. Auto
   labels "Table 1", "Table 2" are assigned within a page unless an
   explicit "Table N" caption is found in the 3 preceding lines.
4. **Multimodal chunker** combines text + table + image per page (in
   that stable order) and continues the ordinal counter across pages so
   ordinals are dense + 1-indexed. Text chunks use the same
   splitBodyByTokens pattern as Project #11 (256-token target, 48-token
   overlap).
5. **Retrieval** loads all DocumentChunk rows into an in-memory corpus
   (parallel arrays for cache-friendly BM25 + cosine loops), builds a
   BM25Index once, and recomputes the corpus on signature-change. The
   signature is `count:max(createdAt)` so adding/removing any chunk
   invalidates the cache.
6. **Multimodal system prompt** explicitly mentions each chunk's
   modality + page number + filename and gives modality-aware citation
   rules ("For image chunks: mention the figure label and the page it
   appears on. Do NOT describe the image's visual content unless the
   chunk's content already contains that description.").
7. **Chat API** uses the same streaming protocol as Project #11
   (text/plain stream + `\n---CITATIONS---\n<json>` footer). The citation
   JSON shape is `{ sessionId, citations: CitationPayload[] }` where
   CitationPayload = `{ chunkId, documentId, filename, pageNumber,
   modality, heading, preview }`.
8. **Per-page source view** reads the raw page text from a separate
   `Page` model (chunks collapse whitespace, so they are not a faithful
   view of the page layout). Images and tables are reconstructed from
   the chunks where pageNumber=N and modality is image/table.
9. **UI** is a 3-column layout (responsive: collapses to 2 columns on
   md, 1 column on mobile). Citations render as clickable cards with
   modality badges (TEXT/IMAGE/TABLE colored emerald/amber/rose), and
   clicking opens the page view in the right panel. The chat supports
   per-document scope filtering via a checkbox on each document card.

## Stretch goals (documented in README, NOT built)

- Real CLIP image embeddings (download/run CLIP locally or via an API)
- ColPali document page retrieval (deep model for PDF page embeddings)
- Real image extraction (extract actual image bytes + display in the UI)
- Chart understanding (parse bar/line charts)
- Multi-doc comparison (side-by-side retrieval across two corpora)

## Limitations / TODOs

- Only text-layer PDFs are supported (scanned image PDFs return empty
  pages; an OCR step like Tesseract / Ollama could lift this).
- Image chunks are placeholders; the chunk content is either
  "Figure N on page P" (default) or the trailing caption text. Set
  `MM_RAG_VISION_DESCRIBE=1` and wire `createVision` in `ingest.ts` to
  enable LLM-generated image descriptions (stretch goal).
- Table detection is a text-layer heuristic; complex tables with merged
  cells, multi-row headers, or non-`\t` alignment are not detected.
- `bbox` is always null in the MVP -- image chunks point at a page
  number only, no on-page coordinates.

## Parent DB verification

The parent project at `/home/z/my-project` was NOT modified. The parent
Prisma schema at `/home/z/my-project/prisma/schema.prisma` still has its
original Personal Knowledge Copilot shape (Note / NoteChunk / ChatSession /
ChatMessage / NoteLink models). The new project uses its own SQLite
database at `/home/z/my-project/apps/75-multimodal-rag/db/custom.db` (per
`.env.example`), fully isolated from the parent's DB. No `prisma db push`
was run, so no DB files were created or migrated.

## Sibling Project #11 verification

Project #11 at `/home/z/my-project/apps/11-personal-notes-rag/` was only
read for reference (its `pdf.ts`, `chunker.ts`, `tokenizer.ts`,
`embeddings.ts`, `bm25.ts`, `hybrid-search.ts`, `ai.ts`, `retrieval.ts`,
`db.ts`, page.tsx UI patterns, package.json, prisma schema, configs).
No files in that project were modified.
