import "server-only";

/**
 * SearXNG client — talks to a locally hosted SearXNG instance over its JSON
 * API. SearXNG aggregates 70+ search engines (Google, Bing, DuckDuckGo,
 * Brave, Qwant, Startpage, etc.) and exposes a single normalized result
 * stream. This is ChampHarbinger's free, self-hosted alternative to paid
 * meta-search APIs like Exa or SerpAPI.
 *
 * Setup: `docker compose up -d searxng` (see services/searxng/README.md).
 * Configure via SEARXNG_URL (shared with public-web discovery). Falls back to
 * the legacy SEARXNG_BASE_URL, then the local-dev default (host port 8090).
 */

const DEFAULT_BASE_URL = "http://localhost:8090";
const REQUEST_TIMEOUT_MS = 15_000;

function getBaseUrl(): string {
  return (
    process.env.SEARXNG_URL ||
    process.env.SEARXNG_BASE_URL ||
    DEFAULT_BASE_URL
  ).replace(/\/$/, "");
}

export interface SearchResult {
  title: string;
  url: string;
  /** Snippet / description / body excerpt returned by the upstream engine. */
  content: string;
  /** ISO timestamp if the upstream engine provided one. */
  publishedDate?: string;
  /** The SearXNG-side engine name (e.g. "google", "bing news"). */
  engine: string;
  /** SearXNG's confidence score (higher = better consensus across engines). */
  score: number;
}

export interface WebSearchOptions {
  /** Cap the number of results returned. Default: 10. */
  limit?: number;
  /** Two-letter language hint, e.g. "en", "fr". */
  language?: string;
  /**
   * Restrict results to a recency window. SearXNG accepts:
   *   "day" | "week" | "month" | "year"
   */
  timeRange?: "day" | "week" | "month" | "year";
  /** SearXNG safe-search level. 0 = off, 1 = moderate, 2 = strict. */
  safeSearch?: 0 | 1 | 2;
}

export interface NewsSearchOptions {
  limit?: number;
  language?: string;
  timeRange?: "day" | "week" | "month" | "year";
}

export interface ImageSearchOptions {
  limit?: number;
  language?: string;
  safeSearch?: 0 | 1 | 2;
}

interface RawSearXNGResult {
  title?: string;
  url?: string;
  content?: string;
  publishedDate?: string;
  pubdate?: string;
  engine?: string;
  score?: number;
  img_src?: string;
  thumbnail?: string;
}

interface RawSearXNGResponse {
  results?: RawSearXNGResult[];
  query?: string;
  number_of_results?: number;
}

export class SearXNGError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SearXNGError";
  }
}

function buildSearchParams(
  query: string,
  opts: {
    categories?: string;
    language?: string;
    timeRange?: string;
    safeSearch?: number;
  },
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("format", "json");
  if (opts.categories) params.set("categories", opts.categories);
  if (opts.language) params.set("language", opts.language);
  if (opts.timeRange) params.set("time_range", opts.timeRange);
  if (typeof opts.safeSearch === "number") {
    params.set("safesearch", String(opts.safeSearch));
  }
  return params;
}

function normalizeResult(raw: RawSearXNGResult): SearchResult {
  return {
    title: raw.title ?? "",
    url: raw.url ?? "",
    content: raw.content ?? "",
    publishedDate: raw.publishedDate ?? raw.pubdate ?? undefined,
    engine: raw.engine ?? "unknown",
    score: typeof raw.score === "number" ? raw.score : 0,
  };
}

async function searxngGet(
  path: string,
  params: URLSearchParams,
): Promise<RawSearXNGResponse> {
  const base = getBaseUrl();
  const url = `${base}${path}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "ChampHarbinger/1.0 (+searxng-client)",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new SearXNGError(
      `SearXNG request failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  if (!response.ok) {
    throw new SearXNGError(
      `SearXNG returned HTTP ${response.status} ${response.statusText}`,
    );
  }

  try {
    return (await response.json()) as RawSearXNGResponse;
  } catch (err) {
    throw new SearXNGError(
      `Failed to parse SearXNG JSON response: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

/**
 * General web search across enabled engines (Google, Bing, DDG, etc.).
 */
export async function webSearch(
  query: string,
  options: WebSearchOptions = {},
): Promise<SearchResult[]> {
  const params = buildSearchParams(query, {
    categories: "general",
    language: options.language,
    timeRange: options.timeRange,
    safeSearch: options.safeSearch,
  });
  const data = await searxngGet("/search", params);
  const limit = options.limit ?? 10;
  return (data.results ?? []).slice(0, limit).map(normalizeResult);
}

/**
 * News-focused search across news engines (Google News, Bing News, DDG News).
 */
export async function newsSearch(
  query: string,
  options: NewsSearchOptions = {},
): Promise<SearchResult[]> {
  const params = buildSearchParams(query, {
    categories: "news",
    language: options.language,
    timeRange: options.timeRange,
  });
  const data = await searxngGet("/search", params);
  const limit = options.limit ?? 10;
  return (data.results ?? []).slice(0, limit).map(normalizeResult);
}

/**
 * Image search. Returns the same SearchResult shape; image URLs land in
 * `url` (linking page) and may be exposed via `content` (the image URL on
 * raw responses lives at `img_src` but is not part of the normalized type).
 */
export async function imageSearch(
  query: string,
  options: ImageSearchOptions = {},
): Promise<SearchResult[]> {
  const params = buildSearchParams(query, {
    categories: "images",
    language: options.language,
    safeSearch: options.safeSearch,
  });
  const data = await searxngGet("/search", params);
  const limit = options.limit ?? 10;
  return (data.results ?? []).slice(0, limit).map(normalizeResult);
}

/**
 * Verifies the SearXNG instance is reachable. Returns `{ ok: true }` on a
 * successful round trip, otherwise `{ ok: false, error }` with a brief
 * reason. Never throws.
 */
export async function checkSearXNGHealth(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const base = getBaseUrl();
  try {
    const res = await fetch(`${base}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    // /healthz may not exist on older builds — fall back to a tiny search.
    try {
      const fallback = await fetch(`${base}/search?q=health&format=json`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (fallback.ok) return { ok: true };
      return { ok: false, error: `HTTP ${fallback.status}` };
    } catch (fallbackErr) {
      return {
        ok: false,
        error:
          fallbackErr instanceof Error
            ? fallbackErr.message
            : String(fallbackErr ?? err),
      };
    }
  }
}

/** Returns true iff SearXNG is configured (SEARXNG_URL or legacy SEARXNG_BASE_URL). */
export function isSearXNGConfigured(): boolean {
  // SearXNG is opt-in via the env var. We treat the default localhost URL
  // as "configured" only when explicitly set — that way tools degrade
  // cleanly on hosted deployments where no SearXNG instance exists.
  return Boolean(process.env.SEARXNG_URL || process.env.SEARXNG_BASE_URL);
}
