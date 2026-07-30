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

/** SearXNG returns roughly this many results per page. */
const RESULTS_PER_PAGE = 10;
/** Cap pages per query so a large `n` can't hammer the instance. */
const MAX_PAGES = 5;

async function searxFetchPage(
  base: string,
  query: string,
  pageno: number,
): Promise<SearxResult[]> {
  const u = new URL(`${base}/search`);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  // * Previously omitted, so every search only ever saw page 1 (~10 URLs)
  // * no matter how many results the caller asked for.
  u.searchParams.set("pageno", String(pageno));

  const res = await fetch(u, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error(`[searxng] ${res.status} (page ${pageno})`);
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
    .filter((r) => r.url);
}

export async function searxSearch(
  query: string,
  n = 10,
): Promise<SearxResult[]> {
  const base = searxBase();
  if (!base) return [];
  try {
    const pagesNeeded = Math.min(Math.ceil(n / RESULTS_PER_PAGE), MAX_PAGES);
    const collected: SearxResult[] = [];
    const seen = new Set<string>();

    for (let pageno = 1; pageno <= pagesNeeded; pageno++) {
      const page = await searxFetchPage(base, query, pageno);
      if (page.length === 0) break; // exhausted
      for (const r of page) {
        // Pages can overlap across engines — dedupe by URL.
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        collected.push(r);
      }
      if (collected.length >= n) break;
    }

    return collected.slice(0, n);
  } catch (err) {
    console.error("[searxng] error:", err);
    return [];
  }
}
