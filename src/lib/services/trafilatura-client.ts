import "server-only";

/**
 * Trafilatura — HTTP client for the self-hosted Python content-extraction
 * microservice (see services/trafilatura/). Trafilatura is the same article
 * extractor used by Common Crawl / HuggingFace dataset pipelines — strictly
 * better than the regex HTML-stripping that ChampHarbinger ships with by
 * default.
 *
 * Graceful degradation
 * --------------------
 * The Python service is optional. If TRAFILATURA_BASE_URL is unset, every
 * call returns a structured `{ success: false, error: "not_configured" }`
 * result instead of throwing — callers can branch on it and fall back to
 * whatever lossy pipeline they were using before.
 */

const REQUEST_TIMEOUT_MS = 60_000;

export interface ExtractedContent {
  url: string;
  success: boolean;
  title?: string;
  author?: string;
  date?: string;
  language?: string;
  text?: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface ExtractOptions {
  format?: "text" | "markdown" | "json";
  includeLinks?: boolean;
  includeImages?: boolean;
}

export interface ExtractBatchOptions extends ExtractOptions {
  maxConcurrent?: number;
}

function getBaseUrl(): string | null {
  const raw = process.env.TRAFILATURA_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function notConfigured(url: string): ExtractedContent {
  return { url, success: false, error: "not_configured" };
}

function mapOptions(options?: ExtractOptions) {
  if (!options) return undefined;
  return {
    include_links: options.includeLinks ?? false,
    include_images: options.includeImages ?? false,
    output_format: options.format ?? "text",
  };
}

async function postJson<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return { ok: false, error: "not_configured" };

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `http_${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `request_failed: ${message}` };
  }
}

/**
 * Extract clean text/markdown from a remote URL. The Python service fetches
 * the URL itself (so cookies/headers don't have to be plumbed from Node).
 */
export async function extractFromUrl(
  url: string,
  options?: ExtractOptions,
): Promise<ExtractedContent> {
  if (!getBaseUrl()) return notConfigured(url);

  const result = await postJson<ExtractedContent>("/extract", {
    url,
    options: mapOptions(options),
  });

  if (!result.ok) {
    return { url, success: false, error: result.error };
  }
  return result.data;
}

/**
 * Extract clean text/markdown from an HTML string you already have in hand.
 * Useful when ChampHarbinger has already fetched HTML via Browserbase / Playwright
 * and just needs Trafilatura's article-detection pass.
 */
export async function extractFromHtml(
  html: string,
  options?: ExtractOptions & { url?: string },
): Promise<ExtractedContent> {
  const sourceUrl = options?.url ?? "";
  if (!getBaseUrl()) return notConfigured(sourceUrl);

  const result = await postJson<ExtractedContent>("/extract", {
    html,
    url: options?.url,
    options: mapOptions(options),
  });

  if (!result.ok) {
    return { url: sourceUrl, success: false, error: result.error };
  }
  return result.data;
}

/**
 * Extract a batch of URLs in parallel (server-side concurrency, default 5).
 * The Python service caps concurrency at 20.
 */
export async function extractBatch(
  urls: string[],
  options?: ExtractBatchOptions,
): Promise<ExtractedContent[]> {
  if (!getBaseUrl()) return urls.map((url) => notConfigured(url));
  if (urls.length === 0) return [];

  const result = await postJson<ExtractedContent[]>("/extract-batch", {
    urls,
    max_concurrent: options?.maxConcurrent ?? 5,
    options: mapOptions(options),
  });

  if (!result.ok) {
    return urls.map((url) => ({
      url,
      success: false,
      error: result.error,
    }));
  }
  return result.data;
}

/**
 * Liveness probe — used by /api/integrations/status and the test script.
 */
export async function checkTrafilaturaHealth(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return { ok: false, error: "not_configured" };

  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = (await res.json()) as { ok?: boolean };
    return { ok: data.ok === true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
