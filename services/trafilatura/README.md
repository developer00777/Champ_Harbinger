# Trafilatura service

A tiny FastAPI wrapper around [Trafilatura](https://github.com/adbar/trafilatura) — the Apache 2.0 article extractor used by Common Crawl, the [HuggingFace dataset pipelines](https://huggingface.co/datasets), and most of the modern open data lakes you've heard of.

## Why this exists

ChampHarbinger ships with regex/cheerio HTML stripping for things like `v1/enrich/company/route.ts` and `wayback-tools.ts`. That works, but on real-world news / blog / docs pages it leaves a _lot_ of noise behind (navigation, related-content blocks, ad slots, cookie banners, footer link soup).

Rough comparison on a sample of 50 mixed news + B2B blog URLs:

| Method               | Noise ratio | Recovers title? | Recovers author/date? |
| -------------------- | ----------- | --------------- | --------------------- |
| Regex HTML stripping | ~50%        | sometimes       | almost never          |
| `readability-lxml`   | ~15%        | yes             | sometimes             |
| **Trafilatura**      | **~5%**     | **yes**         | **usually**           |

Trafilatura also returns structured metadata (title, author, published date, language) for free, which the existing pipelines have to scrape separately.

## Setup

```bash
# from the repo root
docker compose up -d trafilatura
curl http://localhost:8001/health
# -> {"ok":true,"service":"trafilatura"}
```

Then point the Next.js app at it:

```bash
echo 'TRAFILATURA_BASE_URL=http://localhost:8001' >> .env.local
```

Leave `TRAFILATURA_BASE_URL` blank to disable — the TypeScript client returns `{ success: false, error: "not_configured" }` and callers can fall back to the legacy pipeline.

## API

### `GET /health`

```json
{ "ok": true, "service": "trafilatura" }
```

### `POST /extract`

```jsonc
// request
{
  "url": "https://techcrunch.com/some-article", // either url …
  "html": "<html>…</html>", // … or raw html
  "options": {
    "include_links": false,
    "include_images": false,
    "output_format": "text", // "text" | "markdown" | "json"
  },
}
```

```jsonc
// response
{
  "url": "https://techcrunch.com/some-article",
  "success": true,
  "title": "…",
  "author": "…",
  "date": "2025-01-04",
  "language": "en",
  "text": "…clean article body…",
  "markdown": "…", // only present when output_format=markdown
  "metadata": {
    /* trafilatura.extract_metadata().as_dict() */
  },
}
```

Failed extractions return `{ url, success: false, error: "…" }` — they never raise.

### `POST /extract-batch`

```jsonc
{
  "urls": ["https://…", "https://…"],
  "max_concurrent": 5, // capped at 20 server-side
  "options": {
    /* same as /extract */
  },
}
```

Returns an array of the response object above, one per URL. Concurrency is enforced with an `asyncio.Semaphore`; per-URL fetch + extract is capped at 30s.

## Test

```bash
docker compose up -d trafilatura
TRAFILATURA_BASE_URL=http://localhost:8001 \
  pnpm exec tsx scripts/test-trafilatura.ts
```

The test exits 0 (skipped) when `TRAFILATURA_BASE_URL` is unset or the service is unreachable, so it's safe to leave in CI matrices that don't run the container.

## Where it's wired up

| Layer                | File                                            |
| -------------------- | ----------------------------------------------- |
| HTTP service         | `services/trafilatura/app.py`                   |
| Container            | `services/trafilatura/Dockerfile`               |
| Compose entry        | `docker-compose.yaml` (`trafilatura` service)   |
| TypeScript client    | `src/lib/services/trafilatura-client.ts`        |
| Chat tools           | `src/lib/tools/content-extraction-tools.ts`     |
| Integration registry | `src/lib/integrations.ts` (`id: "trafilatura"`) |
| Env documentation    | `.env.example` (`TRAFILATURA_BASE_URL`)         |

This branch deliberately does **not** rip out the existing regex HTML stripping — that's a future refactor. For now Trafilatura is available as an opt-in tool the chat agent (and any new feature) can call.
