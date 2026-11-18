# Architecture

The Personal Knowledge Copilot is composed of three services: ingest, retrieval, and chat.

- Ingest: chunk markdown by headings, embed each chunk, store tokens + vector.
- Retrieval: BM25 over tokens + cosine over embeddings, fused via Reciprocal Rank Fusion (RRF).
- Chat: stream the LLM with a system prompt containing the retrieved chunks and citation rules.

## Tech choices

We use SQLite + Prisma for local-first storage. Vectors are stored as JSON-encoded Float32Array in a TEXT column so the app runs anywhere without pgvector / sqlite-vec extensions.

# Edge cases

Long paragraphs are split by sentence when they exceed the chunk target. Overlap of 48 tokens is applied between adjacent chunks so retrieval does not miss cross-paragraph context.
