/**
 * Single web-search entry point for the app (LinkedIn-URL finding + company
 * discovery both go through here).
 *
 * Backed by the self-hosted SearXNG instance. The RELIABILITY problem — Google/
 * Bing/DuckDuckGo serving access-denied/CAPTCHA to a server-IP instance, so
 * search returns 0 results — is fixed at the INFRASTRUCTURE layer: residential
 * proxies in services/searxng/settings.yml (`outgoing.proxies`), so each engine
 * request looks like a real user. That's a config change, not app code.
 *
 * This wrapper stays as the single seam: if a turnkey SERP API is ever wanted
 * as a fallback, slot it in here and the rest of the app is unaffected.
 */
import { searxSearch, type SearxResult } from "@/lib/search/searxng-client";

export type WebSearchResult = SearxResult;

export async function webSearch(
  query: string,
  n = 10,
): Promise<WebSearchResult[]> {
  return searxSearch(query, n);
}
