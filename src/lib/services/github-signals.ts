import "server-only";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * GitHub engineering-momentum signals.
 *
 * Derives company-level signals from the GitHub REST API:
 *   - org-wide footprint (repo count, stars, top languages)
 *   - commit velocity per repo (are devs shipping code?)
 *   - release cadence per repo (are they shipping product?)
 *   - stargazer trend per repo (is the product getting traction?)
 *
 * Rate limits: unauthenticated = 60 rpm, with GITHUB_TOKEN = 5000 rpm.
 * The helper sends `Authorization: Bearer ${GITHUB_TOKEN}` when present.
 */

const GITHUB_API = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAGES = 5;
const PER_PAGE = 100;

function ghHeaders(accept?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept ?? "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ChampHarbinger-Signals",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Fetch a single GitHub API path; throws on non-2xx. */
async function gh(path: string, accept?: string): Promise<unknown> {
  const url = `${GITHUB_API}${path}`;
  const res = await fetchWithTimeout(
    url,
    { headers: ghHeaders(accept) },
    DEFAULT_TIMEOUT_MS,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub ${res.status} ${res.statusText} for ${path}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  return res.json();
}

/** Parse RFC 5988 Link header to find a `rel="next"` URL. */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // Format: <https://api.github.com/...>; rel="next", <...>; rel="last"
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Follow Link-header pagination. Concatenates results from each page.
 * Defaults to {@link DEFAULT_MAX_PAGES}.
 */
async function paginate<T>(
  path: string,
  maxPages: number = DEFAULT_MAX_PAGES,
  accept?: string,
): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${GITHUB_API}${path}`;
  let pages = 0;
  while (url && pages < maxPages) {
    const res: Response = await fetchWithTimeout(
      url,
      { headers: ghHeaders(accept) },
      DEFAULT_TIMEOUT_MS,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GitHub ${res.status} ${res.statusText} for ${url}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }
    const data = (await res.json()) as T[] | T;
    if (Array.isArray(data)) {
      out.push(...data);
    } else {
      out.push(data);
      break;
    }
    url = parseNextLink(res.headers.get("link"));
    pages += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrgStats {
  org: string;
  publicRepos: number;
  totalStars: number;
  topLanguages: Record<string, number>;
  topRepos: Array<{
    name: string;
    stars: number;
    language: string | null;
    pushedAt: string;
    description: string | null;
  }>;
}

export interface CommitVelocity {
  totalCommits: number;
  uniqueAuthors: number;
  commitsByWeek: Array<{ week: string; count: number }>;
}

export interface ReleaseCadence {
  totalReleases: number;
  releasesPerMonth: Array<{ month: string; count: number }>;
  latest: { name: string; publishedAt: string; url: string } | null;
}

export interface StargazerTrend {
  delta: number;
  dailyByWeek: Array<{ week: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO week label (YYYY-Www) -- groups dates into Mon-Sun buckets. */
function isoWeek(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "unknown";
  // Copy date, set to nearest Thursday: current date + 4 - current day number
  const tmp = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = (tmp.getUTCDay() + 6) % 7; // 0 = Monday
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const diff = tmp.getTime() - firstThursday.getTime();
  const weekNum = 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function yearMonth(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface RepoListItem {
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
}

interface OrgRecord {
  login: string;
  public_repos: number;
}

/**
 * Aggregate an org's public-repo footprint.
 *
 * Pulls `/orgs/{org}` and the 30 most-recently-updated public repos. Computes
 * total stars, language frequency, and a sorted "top repos" list.
 */
export async function getCompanyOrgStats(orgSlug: string): Promise<OrgStats> {
  const org = (await gh(`/orgs/${orgSlug}`)) as OrgRecord;

  // Repos are returned newest-pushed first; cap at first page (~100) and slice 30.
  const repos = (await gh(
    `/orgs/${orgSlug}/repos?type=public&sort=updated&per_page=${PER_PAGE}`,
  )) as RepoListItem[];

  const top = repos.slice(0, 30);
  const topLanguages: Record<string, number> = {};
  let totalStars = 0;
  for (const r of top) {
    totalStars += r.stargazers_count;
    if (r.language) {
      topLanguages[r.language] = (topLanguages[r.language] ?? 0) + 1;
    }
  }

  const topRepos = [...top]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 10)
    .map((r) => ({
      name: r.name,
      stars: r.stargazers_count,
      language: r.language,
      pushedAt: r.pushed_at,
      description: r.description,
    }));

  return {
    org: org.login,
    publicRepos: org.public_repos,
    totalStars,
    topLanguages,
    topRepos,
  };
}

interface CommitRecord {
  sha: string;
  commit: { author: { date: string; name: string; email: string } | null };
  author: { login: string } | null;
}

/**
 * Recent commit activity for a single repo.
 *
 * Returns total commits, unique authors (preferring GitHub login, falling
 * back to email), and a weekly histogram.
 */
export async function getCommitVelocity(
  orgSlug: string,
  repoSlug: string,
  daysBack: number = 90,
): Promise<CommitVelocity> {
  const since = new Date(
    Date.now() - daysBack * 24 * 60 * 60 * 1000,
  ).toISOString();
  const path = `/repos/${orgSlug}/${repoSlug}/commits?since=${encodeURIComponent(since)}&per_page=${PER_PAGE}`;
  const commits = await paginate<CommitRecord>(path, DEFAULT_MAX_PAGES);

  const authorKeys = new Set<string>();
  const byWeek = new Map<string, number>();
  for (const c of commits) {
    const date = c.commit?.author?.date;
    if (!date) continue;
    const key =
      c.author?.login ??
      c.commit?.author?.email ??
      c.commit?.author?.name ??
      "unknown";
    authorKeys.add(key);
    const w = isoWeek(date);
    byWeek.set(w, (byWeek.get(w) ?? 0) + 1);
  }

  const commitsByWeek = [...byWeek.entries()]
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));

  return {
    totalCommits: commits.length,
    uniqueAuthors: authorKeys.size,
    commitsByWeek,
  };
}

interface ReleaseRecord {
  name: string | null;
  tag_name: string;
  published_at: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

/**
 * Release rhythm for a single repo.
 *
 * Drops drafts and prereleases. Returns a per-month histogram and the most
 * recent published release.
 */
export async function getReleaseCadence(
  orgSlug: string,
  repoSlug: string,
  monthsBack: number = 12,
): Promise<ReleaseCadence> {
  const cutoff = Date.now() - monthsBack * 30 * 24 * 60 * 60 * 1000;
  const path = `/repos/${orgSlug}/${repoSlug}/releases?per_page=${PER_PAGE}`;
  const all = await paginate<ReleaseRecord>(path, DEFAULT_MAX_PAGES);

  const inWindow = all.filter((r) => {
    if (r.draft || r.prerelease) return false;
    if (!r.published_at) return false;
    return new Date(r.published_at).getTime() >= cutoff;
  });

  const byMonth = new Map<string, number>();
  for (const r of inWindow) {
    const m = yearMonth(r.published_at!);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }

  const releasesPerMonth = [...byMonth.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // GitHub lists releases newest first.
  const newest = all.find((r) => !r.draft && r.published_at) ?? null;
  const latest = newest
    ? {
        name: newest.name ?? newest.tag_name,
        publishedAt: newest.published_at!,
        url: newest.html_url,
      }
    : null;

  return {
    totalReleases: inWindow.length,
    releasesPerMonth,
    latest,
  };
}

interface StarRecord {
  starred_at: string;
  user: { login: string };
}

/**
 * Stargazer momentum for a single repo.
 *
 * Walks the stargazers endpoint with the timestamp media type. Filters to
 * stars within the last `daysBack` days and returns a weekly histogram +
 * the total delta.
 *
 * Note: GitHub returns stargazers in ascending order, so to inspect recent
 * activity we walk from the newest page backwards. Capped at 10 pages to
 * keep the request budget bounded for very popular repos.
 */
export async function getStargazerTrend(
  orgSlug: string,
  repoSlug: string,
  daysBack: number = 30,
): Promise<StargazerTrend> {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const accept = "application/vnd.github.star+json";

  // Discover total pages from the first request's Link header.
  const firstUrl = `${GITHUB_API}/repos/${orgSlug}/${repoSlug}/stargazers?per_page=${PER_PAGE}&page=1`;
  const firstRes = await fetchWithTimeout(
    firstUrl,
    { headers: ghHeaders(accept) },
    DEFAULT_TIMEOUT_MS,
  );
  if (!firstRes.ok) {
    const body = await firstRes.text().catch(() => "");
    throw new Error(
      `GitHub ${firstRes.status} ${firstRes.statusText} for stargazers${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  const firstData = (await firstRes.json()) as StarRecord[];

  // Find last page from Link header.
  const link = firstRes.headers.get("link") ?? "";
  const lastMatch = link.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  const lastPage = lastMatch ? parseInt(lastMatch[1], 10) : 1;

  // Walk recent pages backwards (newest stars are on the last page).
  const recent: StarRecord[] = [];
  const maxScanPages = 10;
  const pagesToScan = Math.min(maxScanPages, lastPage);
  for (let i = 0; i < pagesToScan; i++) {
    const page = lastPage - i;
    let pageData: StarRecord[];
    if (page === 1) {
      pageData = firstData;
    } else {
      const url = `${GITHUB_API}/repos/${orgSlug}/${repoSlug}/stargazers?per_page=${PER_PAGE}&page=${page}`;
      const res = await fetchWithTimeout(
        url,
        { headers: ghHeaders(accept) },
        DEFAULT_TIMEOUT_MS,
      );
      if (!res.ok) break;
      pageData = (await res.json()) as StarRecord[];
    }
    // Keep only stars within the window; stop once a page has none.
    let pageHits = 0;
    for (const s of pageData) {
      if (!s.starred_at) continue;
      if (new Date(s.starred_at).getTime() >= cutoff) {
        recent.push(s);
        pageHits += 1;
      }
    }
    if (pageHits === 0) break;
  }

  const byWeek = new Map<string, number>();
  for (const s of recent) {
    const w = isoWeek(s.starred_at);
    byWeek.set(w, (byWeek.get(w) ?? 0) + 1);
  }
  const dailyByWeek = [...byWeek.entries()]
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));

  return {
    delta: recent.length,
    dailyByWeek,
  };
}
