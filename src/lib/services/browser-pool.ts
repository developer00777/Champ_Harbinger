import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";

/**
 * Connection helper for Obscura — a self-hosted Rust headless browser that
 * exposes a Chrome DevTools Protocol (CDP) WebSocket (`obscura serve`, default
 * :9222). Replaces Browserbase: playwright-core connects over CDP exactly the
 * same way.
 *
 * Configure with OBSCURA_CDP_URL (ws://host:9222) or OBSCURA_SERVE_URL
 * (http://host:9222 — converted to ws). When neither is set, isObscuraConfigured
 * is false and JS-rendering tiers degrade gracefully.
 */

function obscuraCdpUrl(): string | null {
  const cdp = process.env.OBSCURA_CDP_URL?.trim();
  if (cdp) return cdp;
  const serve = process.env.OBSCURA_SERVE_URL?.trim();
  if (!serve) return null;
  return serve.replace(/^http/, "ws").replace(/\/+$/, "");
}

export function isObscuraConfigured(): boolean {
  return obscuraCdpUrl() !== null;
}

/** Connect to Obscura over CDP. Caller MUST close the returned browser. */
export async function connectObscura(): Promise<Browser> {
  const url = obscuraCdpUrl();
  if (!url) {
    throw new Error(
      "Obscura not configured (set OBSCURA_CDP_URL or OBSCURA_SERVE_URL)",
    );
  }
  return chromium.connectOverCDP(url);
}

/**
 * Run `fn` against a fresh page on Obscura, always closing the connection after.
 * Opens/closes per call (same lifecycle as the old Browserbase session code);
 * add a p-limit semaphore here if concurrency ever needs bounding.
 */
export async function withObscuraPage<T>(
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await connectObscura();
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return await fn(page);
  } finally {
    await browser.close();
  }
}
