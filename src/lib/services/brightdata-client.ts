import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * Bright Data Web Unlocker integration (LinkedIn retrieval only).
 *
 * LinkedIn auth-walls unauthenticated fetches, and even a self-hosted headless
 * browser (Obscura) usually gets the login page. Bright Data's Web Unlocker
 * routes the request through residential IPs and handles the anti-bot/auth
 * challenge, returning the rendered public-profile HTML. We then parse that HTML
 * in-house (cheerio + LLM extraction) — Bright Data never sees anything but the
 * target URL and never retains the result, which keeps our data minimal and
 * keeps our own infra IPs off LinkedIn.
 *
 * Configure with BRIGHTDATA_API_TOKEN + BRIGHTDATA_UNLOCKER_ZONE (the Web
 * Unlocker zone name from the Bright Data dashboard). When either is unset,
 * isBrightDataConfigured() is false and callers fall back to Obscura.
 *
 * Uses the Direct API (POST https://api.brightdata.com/request) rather than the
 * proxy port so no proxy-agent dependency is needed. When we later build our own
 * unlocking on top of Obscura, this module is the only thing to retire — the app
 * would then need a plain residential-proxy zone instead of Web Unlocker.
 */

const REQUEST_ENDPOINT = "https://api.brightdata.com/request";

function apiToken(): string | null {
  const raw = process.env.BRIGHTDATA_API_TOKEN?.trim();
  return raw ? raw : null;
}

function unlockerZone(): string | null {
  const raw = process.env.BRIGHTDATA_UNLOCKER_ZONE?.trim();
  return raw ? raw : null;
}

export function isBrightDataConfigured(): boolean {
  return apiToken() !== null && unlockerZone() !== null;
}

export interface BrightDataFetchOptions {
  /** Hard request timeout in seconds (default 30). */
  timeoutSec?: number;
  /**
   * Total attempts on an empty 200 body. Web Unlocker occasionally returns an
   * empty response on the first (cold) request for a hard target like LinkedIn,
   * then succeeds on retry. Default 3 (env BRIGHTDATA_MAX_ATTEMPTS).
   */
  maxAttempts?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL's rendered HTML through Bright Data's Web Unlocker.
 *
 * Only the target URL is sent to Bright Data. Retries on an empty 200 body (a
 * known Web Unlocker cold-start behavior on hard targets like LinkedIn) up to
 * maxAttempts, then returns "" so the caller can fall back. Throws when
 * unconfigured or on a non-OK HTTP status — callers guard with
 * isBrightDataConfigured() and/or catch.
 */
export async function brightDataFetchHtml(
  url: string,
  opts: BrightDataFetchOptions = {},
): Promise<string> {
  const token = apiToken();
  const zone = unlockerZone();
  if (!token || !zone) {
    throw new Error(
      "Bright Data not configured (set BRIGHTDATA_API_TOKEN and BRIGHTDATA_UNLOCKER_ZONE)",
    );
  }

  const timeoutSec =
    opts.timeoutSec ?? (Number(process.env.BRIGHTDATA_TIMEOUT_SEC) || 30);
  const maxAttempts = Math.max(
    1,
    opts.maxAttempts ?? (Number(process.env.BRIGHTDATA_MAX_ATTEMPTS) || 3),
  );
  const retryDelayMs = Number(process.env.BRIGHTDATA_RETRY_DELAY_MS) || 1500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchWithTimeout(
      REQUEST_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ zone, url, format: "raw" }),
      },
      (timeoutSec + 20) * 1000,
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Bright Data ${res.status}: ${detail.slice(0, 300)}`);
    }

    const body = await res.text();
    if (body) return body;

    // Empty 200: Web Unlocker cold-start / transient block. Retry, then give up.
    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }

  return "";
}
