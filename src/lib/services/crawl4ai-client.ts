import "server-only";

/**
 * Crawl4AI client — talks to the self-hosted Python microservice under
 * services/crawl4ai/. Used for bulk page extraction (1M+ companies) where
 * paying per-session for Browserbase would be prohibitive.
 *
 * The service is optional: every export gracefully degrades when
 * CRAWL4AI_BASE_URL is unset or the service is unreachable. Callers receive
 * a structured "not configured" / "unreachable" result rather than a thrown
 * exception so chat tools can surface a useful message to the user.
 */

const DEFAULT_BASE_URL = "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 60_000;

export interface CrawlResult {
  url: string;
  success: boolean;
  markdown?: string | null;
  data?: unknown;
  status_code?: number | null;
  error?: string | null;
}

interface CrawlServiceResponse {
  results: CrawlResult[];
}

export interface CrawlOptions {
  extractStrategy?: "markdown" | "json";
  query?: string;
}

function getBaseUrl(): string | null {
  // Allow explicit opt-out: set CRAWL4AI_BASE_URL to empty string to disable.
  const raw = process.env.CRAWL4AI_BASE_URL;
  if (raw === undefined) return DEFAULT_BASE_URL;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.replace(/\/+$/, "");
}

function notConfigured(urls: string[], reason: string): CrawlResult[] {
  return urls.map((url) => ({
    url,
    success: false,
    error: reason,
  }));
}

async function postJson<TBody extends object>(
  path: string,
  body: TBody,
): Promise<CrawlServiceResponse | { __error: string }> {
  const base = getBaseUrl();
  if (!base) {
    return { __error: "CRAWL4AI_BASE_URL is not configured" };
  }

  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        __error: `crawl4ai ${path} returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    return (await res.json()) as CrawlServiceResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { __error: `crawl4ai ${path} unreachable: ${message}` };
  }
}

/**
 * Crawl a list of URLs. Returns one CrawlResult per input URL, in order.
 * On configuration/transport error every URL is returned with success=false.
 */
export async function crawlPages(
  urls: string[],
  options: CrawlOptions = {},
): Promise<CrawlResult[]> {
  if (urls.length === 0) return [];

  const body = {
    urls,
    extract_strategy: options.extractStrategy ?? "markdown",
    query: options.query,
  };

  const resp = await postJson("/crawl", body);
  if ("__error" in resp) {
    return notConfigured(urls, resp.__error);
  }
  return resp.results;
}

/**
 * Bulk-crawl helper — same shape as crawlPages, but explicitly hits the
 * /bulk-crawl endpoint which the service caps at 100 URLs and parallelizes
 * with a configurable semaphore.
 */
export async function bulkCrawl(
  urls: string[],
  maxConcurrent = 5,
): Promise<CrawlResult[]> {
  if (urls.length === 0) return [];

  const body = { urls, max_concurrent: maxConcurrent };
  const resp = await postJson("/bulk-crawl", body);
  if ("__error" in resp) {
    return notConfigured(urls, resp.__error);
  }
  return resp.results;
}

/**
 * Cheap reachability probe for the integrations status panel.
 */
export async function checkCrawl4AIHealth(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const base = getBaseUrl();
  if (!base) {
    return { ok: false, error: "CRAWL4AI_BASE_URL is not configured" };
  }
  try {
    const res = await fetch(`${base}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, error: `health returned ${res.status}` };
    }
    const json = (await res.json()) as { ok?: boolean };
    return { ok: Boolean(json.ok) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
