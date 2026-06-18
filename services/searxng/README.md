# SearXNG for ChampHarbinger

[SearXNG](https://github.com/searxng/searxng) is a self-hosted, privacy-respecting **meta-search engine**. It queries Google, Bing, DuckDuckGo, Brave, Qwant, Startpage, and 70+ other engines in parallel and returns a unified, deduplicated result stream over a simple JSON API.

ChampHarbinger uses SearXNG as its general-purpose web search backend — replacing any third-party search API (Exa, SerpAPI, Brave Search API, etc.). It is **free**, runs locally in Docker, and has no per-query cost.

## Why SearXNG vs a hosted API

|                     | Hosted (Exa / SerpAPI / Brave) | SearXNG (self-hosted)          |
| ------------------- | ------------------------------ | ------------------------------ |
| Cost per 1k queries | $2–$10                         | $0                             |
| Engine coverage     | One backend                    | 70+ engines, aggregated        |
| Rate limits         | Per-plan                       | Whatever your infra tolerates  |
| Latency             | 200–800 ms                     | 600–1500 ms (parallel fan-out) |
| Privacy             | Vendor sees every query        | Stays inside your network      |
| Maintenance         | None                           | A container to keep up         |

The tradeoff is operational: you own uptime and the occasional engine-block. For ChampHarbinger's volume (research-grade, agent-driven queries), SearXNG is the right default.

## Setup

```bash
# from the repo root
docker compose up -d searxng
```

The first boot can take ~30 s while SearXNG warms up. Verify by opening:

```
http://localhost:8888
```

You should see the SearXNG search page with the instance name **ChampHarbinger**.

Then set the env var (already present in `.env.example`):

```
SEARXNG_BASE_URL=http://localhost:8888
```

## API contract

The TypeScript client (`src/lib/services/searxng-client.ts`) hits a single endpoint:

```
GET {SEARXNG_BASE_URL}/search?q=<query>&format=json&categories=<general|news|images>&time_range=<day|week|month|year>&language=en&safesearch=<0|1|2>
```

Responses are normalized to:

```ts
interface SearchResult {
  title: string;
  url: string;
  content: string; // snippet
  publishedDate?: string;
  engine: string;
  score: number;
}
```

Three high-level functions are exported:

- `webSearch(query, opts?)` — `categories=general`
- `newsSearch(query, opts?)` — `categories=news`
- `imageSearch(query, opts?)` — `categories=images`
- `checkSearXNGHealth()` — pings `/healthz` (falls back to a tiny search)

All requests use a 15 s `AbortSignal.timeout`.

## Chat tools

The client is exposed to the chat agent as two tools:

- `searchWeb` — general web research
- `searchNews` — news / time-sensitive events

Both gracefully return `{ ok: false, error: "not_configured" }` when `SEARXNG_BASE_URL` is unset.

## Testing

After starting the container:

```bash
pnpm exec tsx scripts/test-searxng.ts
```

The script checks the health endpoint, runs a web search for "OpenAI funding round 2024", runs a month-restricted news search for "Series A startup", and prints the top 3 results from each.

## Configuration

Settings live in [`settings.yml`](./settings.yml). The defaults that matter:

- `search.formats: [html, json]` — JSON API enabled
- `server.bind_address: 0.0.0.0` — reachable from other containers
- `server.secret_key` — **change this in production** (`openssl rand -hex 16`)
- `search.safe_search: 0` — no filtering for B2B research
- Engines: `google`, `bing`, `duckduckgo`, `brave`, `qwant`, `startpage`, `google_news`, `bing_news`, `duckduckgo` (news category)

Add or disable engines by editing the `engines:` block. Restart with:

```bash
docker compose restart searxng
```

## License note

SearXNG is **AGPL-3.0**. Self-hosting and using it inside ChampHarbinger (which is also AGPL-3.0) is fine. If you redistribute SearXNG, or modify the bundled image, the AGPL's network-use clause applies — you must offer source to your users. Do **not** bundle SearXNG into a proprietary, closed-source product without legal review.

Upstream: <https://github.com/searxng/searxng>
Docs: <https://docs.searxng.org/>
