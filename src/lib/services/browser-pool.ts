import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * Obscura integration. Obscura is a self-hosted Rust headless browser; its
 * `serve` mode only exposes page-level CDP (which Playwright can't drive), so we
 * talk to the `obscura fetch` renderer through a thin HTTP gateway
 * (services/obscura-gateway) — same pattern as the Trafilatura service.
 *
 * Configure with OBSCURA_GATEWAY_URL (e.g. http://obscura:9223). When unset,
 * isObscuraConfigured() is false and JS-rendering tiers degrade gracefully.
 */

function gatewayUrl(): string | null {
  const raw =
    process.env.OBSCURA_GATEWAY_URL?.trim() ||
    process.env.OBSCURA_SERVE_URL?.trim(); // back-compat
  return raw ? raw.replace(/\/+$/, "") : null;
}

export function isObscuraConfigured(): boolean {
  return gatewayUrl() !== null;
}

export interface ObscuraFetchOptions {
  /** What Obscura dumps: rendered html (default), plain text, markdown, or links. */
  dump?: "html" | "text" | "markdown" | "links";
  /** Hard navigation/render timeout in seconds (default 30). */
  timeoutSec?: number;
  /** Extra settle time after load, in seconds (default 3). */
  waitSec?: number;
}

/**
 * Render a URL through Obscura and return the dumped content (rendered HTML by
 * default). Throws when the gateway is unconfigured or the fetch fails — callers
 * guard with isObscuraConfigured() and/or catch.
 */
export async function obscuraFetchHtml(
  url: string,
  opts: ObscuraFetchOptions = {},
): Promise<string> {
  const base = gatewayUrl();
  if (!base) {
    throw new Error("Obscura not configured (set OBSCURA_GATEWAY_URL)");
  }
  const timeoutSec = opts.timeoutSec ?? 30;
  const res = await fetchWithTimeout(
    `${base}/fetch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        dump: opts.dump ?? "html",
        timeout: timeoutSec,
        wait: opts.waitSec ?? 3,
      }),
    },
    (timeoutSec + 20) * 1000,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Obscura gateway ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: string };
  return data.content ?? "";
}
