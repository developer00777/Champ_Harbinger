# Wayback Machine integration

Free historical-page snapshot source backed by the Internet Archive. Powers
ChampHarbinger's "what changed on this page since last month?" capability —
the same kind of analysis Exa Research charges for.

## What it does

- Look up every archived snapshot of any public URL (700B+ snapshots).
- Fetch the HTML of any specific snapshot.
- Diff two snapshots (or the latest vs ~30 days ago) and report added /
  removed / modified text lines.

## Cost

**$0.** The Wayback Machine CDX and availability APIs are free and require
no API key, no signup, and no auth headers.

## API endpoints used

| Endpoint                                    | Purpose                          |
| ------------------------------------------- | -------------------------------- |
| `https://archive.org/wayback/available`     | Closest snapshot to a date       |
| `http://web.archive.org/cdx/search/cdx`     | List snapshots in a range        |
| `https://web.archive.org/web/{ts}id_/{url}` | Raw archived HTML (un-rewritten) |

All requests use a 15-second timeout via `AbortSignal.timeout`.

## Files

- `src/lib/services/wayback-client.ts` — low-level Wayback client.
- `src/lib/services/page-differ.ts` — HTML→text + LCS line diff (no deps).
- `src/lib/tools/wayback-tools.ts` — three chat tools.
- `src/lib/integrations.ts` — registry entry (`id: "wayback"`).
- `scripts/test-wayback.ts` — end-to-end smoke test.

## Chat tools

| Tool                  | Use case                                                   |
| --------------------- | ---------------------------------------------------------- |
| `getPageHistory`      | "How often is acme.com/pricing archived?"                  |
| `comparePageVersions` | "What changed between Jan and June on stripe.com/pricing?" |
| `detectRecentChanges` | "Did vercel.com/pricing change in the last 30 days?"       |

## Example use cases

- **Pricing changes**: `detectRecentChanges` on `/pricing` to flag when a
  competitor swaps their published plan or price.
- **Leadership swaps**: `comparePageVersions` on `/about` or `/team` to
  detect when execs change.
- **Feature launches**: diff a product page month-over-month to catch new
  feature copy that landed without a press release.
- **Stack changes**: detect when a careers page lists a new technology.

## Limitations

- Not every URL is archived — popular sites have weekly snapshots, niche
  sites may only have a few per year.
- Archive freshness varies: a site might not have been re-archived in 2-3
  weeks even if it's popular.
- Snapshot HTML can leak some Wayback toolbar chrome; we strip the obvious
  injected scripts / banners before diffing.
- CDX requests for very busy URLs can be slow — the 15s timeout will bail.

## Test command

```bash
pnpm exec tsx scripts/test-wayback.ts
```

Runs against `https://stripe.com/pricing`. No env vars required.
