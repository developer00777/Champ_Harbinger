# RSS / Atom News Monitor

Self-hosted RSS/Atom feed monitor for ChampHarbinger. Tracks 1000s of company
blogs, newsrooms, and changelogs without paying Exa's per-company keyword
monitoring fees.

## Why

Exa's keyword monitoring product bills per company per month. Almost every
company that matters already publishes an RSS or Atom feed (blog, news,
changelog, press releases). This integration polls those feeds on a cron,
dedups by `guid`, and stores items in Postgres — zero external dependencies,
zero per-feed cost.

## Schema

```
monitored_feeds
├─ id            uuid PK
├─ clerk_user_id text       — owner
├─ clerk_org_id  text       — optional org scope
├─ organization_id uuid     — optional link to organizations table
├─ feed_url      text       — absolute URL of the feed
├─ feed_type     text       — "rss" | "atom"
├─ title         text       — cached feed title
├─ last_checked_at  timestamptz
├─ last_success_at  timestamptz
├─ error_count   int        — consecutive failures (reset to 0 on success)
├─ enabled       bool       — toggle polling
└─ (created_at, updated_at)
unique (clerk_user_id, feed_url)

feed_items
├─ id            uuid PK
├─ feed_id       uuid FK → monitored_feeds.id (on delete cascade)
├─ guid          text       — feed-supplied guid, falls back to link or title hash
├─ title         text
├─ link          text
├─ published_at  timestamptz
├─ summary       text       — contentSnippet from rss-parser
├─ content       text       — full HTML when present
├─ processed     bool       — for downstream pipelines
└─ (created_at, updated_at)
unique (feed_id, guid)
```

## Chat tools

All four tools live in `src/lib/tools/rss-tools.ts` and are exported via
`src/lib/tools/index.ts`.

| Tool                | Input                                                                 | Behavior                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addFeedMonitor`    | `{ feedUrl, organizationId?, title? }`                                | Validates the feed by fetching it, inserts a `monitored_feeds` row (idempotent per user+url), and seeds known items via an initial `checkFeed`.                           |
| `listMyFeeds`       | _none_                                                                | Returns the caller's feeds with `lastCheckedAt`, `lastSuccessAt`, `errorCount`, `enabled`.                                                                                |
| `getRecentFeedItems`| `{ feedId?, limit? = 25, sinceHours? }`                               | Joins `feed_items` to `monitored_feeds` filtered to the caller, ordered by `published_at` desc (falls back to `created_at`).                                              |
| `checkAllMyFeeds`   | `{ maxConcurrent? = 5 }`                                              | Polls every enabled feed for the caller with bounded concurrency; aggregates new-item counts and errors.                                                                  |

## Service API

`src/lib/services/rss-monitor.ts` (server-only) exports:

- `fetchFeed(url)` — parse a feed with a 15s timeout; returns `{ title, items[] }`.
- `checkFeed(feedId)` — fetch + dedup-insert + bookkeeping; never throws.
- `checkAllFeeds(clerkUserId, maxConcurrent?)` — bulk poll all enabled feeds for one user.
- `checkAllEnabledFeeds(maxConcurrent?)` — bulk poll every enabled feed system-wide (used by cron).

## Cron / manual trigger endpoint

`POST /api/rss/check` — authenticated by `chh_` API key (header
`Authorization: Bearer chh_...`), same as `/api/v1/*`. The middleware in
`src/proxy.ts` already lists `/api/rss/(.*)` as a public (non-Clerk) route.

| Body                       | Scope                                  |
| -------------------------- | -------------------------------------- |
| `{ "feedId": "..." }`      | Just that feed                         |
| `{ "userId": "user_..." }` | Every enabled feed for that user       |
| `{}` (or empty)            | Every enabled feed system-wide (cron)  |

### QStash / cron setup

Schedule `POST https://<your-host>/api/rss/check` to run hourly:

```bash
curl -X POST https://qstash.upstash.io/v2/schedules/your-deploy.example.com/api/rss/check \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: 0 * * * *" \
  -H "Upstash-Forward-Authorization: Bearer $CHH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Adjust the cron to your scale; hourly is a reasonable default for "newsy"
feeds. The endpoint's `maxDuration` is 60s — for very large user bases, shard
by user: have your scheduler call `{ "userId": "user_..." }` per tenant.

## Test command

```bash
DATABASE_URL=postgres://... pnpm exec tsx scripts/test-rss-monitor.ts
```

The test inserts a temporary `monitored_feeds` row pointing at
`https://techcrunch.com/feed/`, asserts that the first `checkFeed` ingests
items, asserts the second `checkFeed` ingests zero (dedup works), then cleans
up the test rows.

Run the full Vitest suite + typecheck:

```bash
pnpm exec tsc --noEmit
pnpm test --run
```
