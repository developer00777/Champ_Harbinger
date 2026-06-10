/**
 * Client for a self-hosted SearXNG metasearch instance (the public-web discovery
 * backend). Far more robust than scraping Google/Bing through a headless browser,
 * which actively block automation. Requires SEARXNG_URL and the JSON output
 * format enabled in the instance settings (services/searxng/settings.yml).
 *
 * Returns [] gracefully when SEARXNG_URL is unset so discovery degrades cleanly.
 */

export interface SearxResult {
  title: string;
  url: string;
  content: string;
}

function searxBase(): string | null {
  return process.env.SEARXNG_URL?.trim().replace(/\/+$/, "") || null;
}

export function isSearxConfigured(): boolean {
  return searxBase() !== null;
}

export async function searxSearch(
  query: string,
  n = 10,
): Promise<SearxResult[]> {
  const base = searxBase();
  if (!base) return [];
  try {
    const u = new URL(`${base}/search`);
    u.searchParams.set("q", query);
    u.searchParams.set("format", "json");
    const res = await fetch(u, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[searxng] ${res.status}`);
      return [];
    }
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? [])
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        content: r.content ?? "",
      }))
      .filter((r) => r.url)
      .slice(0, n);
  } catch (err) {
    console.error("[searxng] error:", err);
    return [];
  }
}
