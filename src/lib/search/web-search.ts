/**
 * Web search with a reliable backend.
 *
 * Self-hosted SearXNG gets blocked by Google/Bing/DuckDuckGo/Brave on its own
 * (they serve "access denied" / CAPTCHA to scraper-looking instances), so it
 * frequently returns ZERO results — which starves both company discovery and
 * the LinkedIn-URL backfill. A real search API (Serper — Google results, no
 * blocking, ~$0.30 per 1k queries) fixes both.
 *
 * Order: Serper when SERPER_API_KEY is set; otherwise the self-hosted SearXNG
 * instance. Returns [] gracefully when neither is available.
 */
import { searxSearch, type SearxResult } from "@/lib/search/searxng-client";

export type WebSearchResult = SearxResult;

function serperKey(): string | null {
  return process.env.SERPER_API_KEY?.trim() || null;
}

/** Which backend a query will use right now — for diagnostics / health checks. */
export function searchBackend(): "serper" | "searxng" | "none" {
  if (serperKey()) return "serper";
  if (process.env.SEARXNG_URL?.trim()) return "searxng";
  return "none";
}

async function serperSearch(
  query: string,
  n: number,
): Promise<WebSearchResult[]> {
  const key = serperKey();
  if (!key) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: Math.min(n, 20) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[serper] ${res.status}`);
      return [];
    }
    const data = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    return (data.organic ?? [])
      .map((r) => ({
        title: r.title ?? "",
        url: r.link ?? "",
        content: r.snippet ?? "",
      }))
      .filter((r) => r.url)
      .slice(0, n);
  } catch (err) {
    console.error("[serper] error:", err);
    return [];
  }
}

export async function webSearch(
  query: string,
  n = 10,
): Promise<WebSearchResult[]> {
  if (serperKey()) {
    const r = await serperSearch(query, n);
    if (r.length > 0) return r;
    // Serper returned nothing — fall through to SearXNG as a last resort.
  }
  return searxSearch(query, n);
}
