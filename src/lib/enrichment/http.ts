/**
 * Minimal fetch helpers with an AbortController timeout. Used by every external
 * provider adapter so a hung provider cannot stall the waterfall.
 */

export interface HttpResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

/** fetch() with a timeout (ms). Throws on network error or timeout abort. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs: number },
): Promise<HttpResponse> {
  const { timeoutMs, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
      text: () => res.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Build a query string from a flat params object, skipping null/undefined. */
export function qs(
  params: Record<string, string | number | undefined | null>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
