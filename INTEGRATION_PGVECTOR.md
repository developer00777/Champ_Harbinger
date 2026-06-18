# pgvector + Local Embeddings Integration

This integration gives ChampHarbinger a semantic-search index over the
`organizations` table that scales to millions of rows with **zero per-query
LLM cost**. It is the open-source equivalent of Exa's vector index and pairs
with the LakeB2B discovery tool to let agents do fast, intent-based retrieval
over already-known companies before falling back to a paid pool query.

## What it does

- **Embedding model**: `Xenova/all-MiniLM-L6-v2` runs locally in-process via
  `@huggingface/transformers`. 384-dim vectors, mean-pooled and L2-normalized.
- **Storage**: `organizations.embedding vector(384)` (pgvector extension).
- **Index**: HNSW over `vector_cosine_ops` for sub-linear nearest-neighbor
  search at million-row scale.
- **Tool**: `semanticSearchCompanies` — registered alongside
  `discoverWithLakeB2B`. Embeds the user's natural-language query at call
  time and returns the top-K closest organizations by cosine distance.

## Setup

```bash
# 1. Start Postgres with the pgvector image (replaces postgres:16-alpine)
docker compose up -d postgres

# 2. Generate has already been run — apply the new migration
pnpm db:migrate

# 3. Embed every org row that currently has NULL embedding
pnpm exec tsx scripts/index-organizations.ts
#    (use `--all` to force a full re-index)
```

The first run of any script that uses the embedding service will download
the model (~90 MB) into the `@huggingface/transformers` cache. Subsequent
runs reuse the cached copy.

## How to test

```bash
pnpm exec tsx scripts/test-pgvector-search.ts
```

Inserts 5 sample orgs across distinct industries (SaaS, Healthcare, Fintech,
Manufacturing, E-commerce), embeds them, runs three semantic queries, asserts
the top match has the expected industry, then cleans up. Exits non-zero on
failure.

You can also use the tool directly from the chat agent — it's wired into
`src/lib/tools/index.ts` and will be exposed to the model on the next reload.

## Cost analysis

| Path                                         | Per-query embedding cost | Notes                        |
| -------------------------------------------- | ------------------------ | ---------------------------- |
| OpenRouter / OpenAI `text-embedding-3-small` | ~$0.02 / 1M tokens       | Network round-trip per query |
| OpenAI `text-embedding-3-large`              | ~$0.13 / 1M tokens       | Higher quality, still paid   |
| **This integration (local MiniLM)**          | **$0.00**                | One-time CPU + ~90 MB disk   |

At 1M companies indexed and 10K agent queries/day, the savings vs. a paid
embedding API are real money. Quality is lower than `text-embedding-3-large`
but is more than sufficient for industry/intent-style retrieval, which is
the use case we care about.

Indexing throughput on a laptop CPU lands around 50–200 rows/sec depending
on description length. For multi-million-row backfills, run the indexer on
a beefier worker (or shard `--all` across multiple processes by id range).

## Known limitations

- **Cold start**: the first call into the embedding service downloads and
  loads the model. Expect ~30s on first run (mostly the ~90 MB model
  download). Subsequent calls reuse the in-memory pipeline instance.
- **CPU-only**: no GPU acceleration in the default Node ONNX runtime.
  Throughput is bounded by single-process CPU; parallelize via worker
  processes if you need more.
- **Quality**: MiniLM is small. For nuanced semantic queries (long compound
  intents, multi-language input) you'll get better recall from a larger
  model. Swap `MODEL_ID` in `src/lib/services/embedding-service.ts` and bump
  the `vector(N)` dimension in `db/schema.ts` if you want to upgrade.
- **Index freshness**: the HNSW index is updated incrementally by pgvector,
  but the bulk indexer doesn't watch for schema changes. Re-run after
  ingestion batches, or wire it into your enrichment pipeline.

## Files added / modified

- `docker-compose.yaml` — Postgres image swapped to `pgvector/pgvector:pg16`
- `db/schema.ts` — adds `embedding vector(384)` + HNSW index on `organizations`
- `db/migrations/0004_modern_tigra.sql` — `CREATE EXTENSION vector`
  - column + HNSW index
- `src/lib/services/embedding-service.ts` — local embedding pipeline
- `src/lib/tools/semantic-search-tools.ts` — `semanticSearchCompanies` tool
- `src/lib/tools/index.ts` — registers the new tool
- `scripts/index-organizations.ts` — bulk indexer
- `scripts/test-pgvector-search.ts` — smoke test
