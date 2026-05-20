# GitHub engineering-momentum signals

Derived B2B prospect signals computed from a company's public GitHub
activity. Free to run; rate limit is **60 requests/min unauthenticated** or
**5000 requests/min with `GITHUB_TOKEN`** set in the environment.

## What it does

Four chat-callable tools, each backed by a service function in
`src/lib/services/github-signals.ts`:

| Tool                      | Service                                       | Question it answers               |
| ------------------------- | --------------------------------------------- | --------------------------------- |
| `getGitHubOrgStats`       | `getCompanyOrgStats(org)`                     | What does this company build?     |
| `getGitHubCommitVelocity` | `getCommitVelocity(org, repo, daysBack=90)`   | Is this team actively coding?     |
| `getGitHubReleaseCadence` | `getReleaseCadence(org, repo, monthsBack=12)` | Are they shipping product?        |
| `getGitHubStarTrend`      | `getStargazerTrend(org, repo, daysBack=30)`   | Is this product getting traction? |

The service is `import "server-only"` and uses `fetchWithTimeout` (10s
default) plus a `paginate<T>` helper that follows the RFC 5988
`Link: <...>; rel="next"` header.

## API endpoints used

- `GET /orgs/{org}` — org metadata, public repo count
- `GET /orgs/{org}/repos?type=public&sort=updated&per_page=100` — recent repos
- `GET /repos/{org}/{repo}/commits?since=...` — commit history (paginated)
- `GET /repos/{org}/{repo}/releases` — release history (paginated)
- `GET /repos/{org}/{repo}/stargazers` with `Accept: application/vnd.github.star+json` — starred_at timestamps

All requests carry `Authorization: Bearer ${GITHUB_TOKEN}` when the env
var is set, plus `X-GitHub-Api-Version: 2022-11-28` and a
`User-Agent: ChampHarbinger-Signals`.

## Example use cases

**"Is this team hiring engineers?"**
Run `getGitHubCommitVelocity` over 90 days, compare `uniqueAuthors`
against the same call a quarter ago. Rising contributor count + rising
weekly commits is a strong hiring signal.

**"Are they shipping product?"**
Run `getGitHubReleaseCadence` over 12 months. A repo that publishes a
release every month is actively delivering; a 3+ month gap suggests the
project is stalled or strategy has shifted.

**"Is this product trending?"**
Run `getGitHubStarTrend` with `daysBack=30`. A positive `delta` (stars
gained in the last month) is the cleanest dev-attention signal you can
get without paying for analytics. Compare against a 90-day window to
spot recent acceleration.

**"What does company X build?"**
Run `getGitHubOrgStats`. The `topLanguages` map shows their tech stack;
`topRepos` shows what the world cares about.

## Limitations

- **Unauthenticated quota is 60 rpm.** Set `GITHUB_TOKEN` (any classic or
  fine-grained PAT with public read access works) to lift this to 5000 rpm.
- **Private repos require a user token with `repo` scope.** Service-account
  tokens won't see internal projects.
- **Some orgs reject classic PATs at the API layer.** If you see 403s,
  re-run without auth or with a fine-grained PAT scoped to public repos.
- **Stargazer pagination is capped at 400 pages (~40k stars total).** Once
  a repo crosses 40k stars (e.g. `vercel/next.js` at ~140k), GitHub will
  not serve stars past page 400, which means stars beyond that point are
  effectively invisible to the REST API. `getStargazerTrend` returns
  `delta: 0` in that scenario; use `getCompanyOrgStats.totalStars` or the
  repo `stargazers_count` field for absolute counts on mega-popular repos.
  The trend signal is most useful for repos in the 100 – 40,000 star
  range. `getStargazerTrend` walks at most 10 recent pages from the tail
  of the list to keep request budgets bounded.
- **Commit `author` may be null** (vendored / merge commits). We fall back
  to `commit.author.email`, then `commit.author.name`, then "unknown" when
  computing unique-author counts.
- **`commitsByWeek` uses ISO weeks.** Time zones are normalised to UTC.

## Configuration

Already covered by the existing `github` entry in `src/lib/integrations.ts`
(env var: `GITHUB_TOKEN`). No new integration registry entry is needed.
