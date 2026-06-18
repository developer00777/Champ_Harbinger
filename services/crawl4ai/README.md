# Crawl4AI microservice

Self-hosted Python crawler wrapped in a small FastAPI app. ChampHarbinger
uses it to do bulk page extraction (1M+ companies) without paying per-session
fees to Browserbase — bandwidth is the only cost.

Upstream: <https://github.com/unclecode/crawl4ai> (Apache 2.0).

## Why

Browserbase is excellent for one-off, complex flows that need a real
session. For batch crawling — pull markdown for 50k careers pages,
extract value props from 200k company sites — the per-session pricing
dominates. Crawl4AI runs a headless Chromium locally, produces clean
LLM-friendly markdown, and optionally drives an LLM extraction strategy
to return structured JSON.

## Run it

```bash
# From the repo root:
docker compose up -d crawl4ai

# Once running:
curl http://localhost:8000/health
# → { "ok": true, "service": "crawl4ai" }
```

The container exposes port `8000` on the host. The TypeScript client
(`src/lib/services/crawl4ai-client.ts`) reads `CRAWL4AI_BASE_URL` and
defaults to `http://localhost:8000`.

## API

### `GET /health`

Liveness probe. Returns `{ ok: true, service: "crawl4ai" }`.

### `POST /crawl`

Crawl a list of URLs and return markdown (or LLM-extracted JSON).

```jsonc
// Request
{
  "urls": ["https://example.com", "https://example.org"],
  "extract_strategy": "markdown",   // or "json"
  "query": null                      // required when extract_strategy = "json"
}

// Response
{
  "results": [
    {
      "url": "https://example.com",
      "success": true,
      "markdown": "# Example Domain ...",
      "status_code": 200,
      "data": null,
      "error": null
    }
  ]
}
```

When `extract_strategy = "json"`, the `query` field is passed to crawl4ai's
`LLMExtractionStrategy` as the instruction / target-schema description.
Provider + key come from `CRAWL4AI_LLM_PROVIDER` and `CRAWL4AI_LLM_API_KEY`
(falls back to `OPENAI_API_KEY`). If LLM extraction is unavailable the
service silently degrades to markdown and logs a warning.

### `POST /bulk-crawl`

Same response shape as `/crawl` but optimised for parallel batches. Capped
at 100 URLs per request and accepts `max_concurrent` (1–20, default 5).

```jsonc
{
  "urls": ["https://acme.com", "https://contoso.com"],
  "max_concurrent": 5,
}
```

## Per-URL behaviour

- 30-second hard timeout per URL — a stuck page can never wedge the worker.
- Per-URL errors are returned inside the `results` array; the HTTP request
  itself never raises.

## Testing

From the repo root:

```bash
# 1. Start the service
docker compose up -d crawl4ai

# 2. Run the smoke test (health + single + bulk crawl)
pnpm exec tsx scripts/test-crawl4ai.ts
```

The test exercises `/health`, `crawlPages(["https://example.com"])`, and a
3-URL `bulkCrawl`. It exits non-zero on any failure.

## Chat-tool surface

Two AI SDK tools are wired up in `src/lib/tools/bulk-crawl-tools.ts`:

- `bulkCrawlDomains` — input `{ domains: string[] (max 50) }`, returns
  per-domain markdown. Use for "scrape these 50 companies and extract their
  value props".
- `crawlPageWithLLM` — input `{ url, query }`, returns JSON extracted via
  the LLM extraction strategy. Use for "pull every job listing from this
  careers page".

Both fail gracefully when `CRAWL4AI_BASE_URL` is unset or the service is
unreachable — the tools return `success: false` per URL with an `error`
message rather than throwing.
