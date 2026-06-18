import "server-only";

/**
 * Wayback Machine (archive.org) client — historical page snapshots.
 *
 * Public, free APIs (no auth):
 *   - https://archive.org/wayback/available — closest snapshot lookup
 *   - http://web.archive.org/cdx/search/cdx  — list snapshots
 *   - https://web.archive.org/web/{timestamp}/{url} — fetch archived HTML
 *
 * Used by change-detection tools: "did this company's pricing page change
 * recently?", "when did they swap their leadership name?", etc.
 */

export interface Snapshot {
  /** Full URL to the snapshot on web.archive.org. */
  url: string;
  /** Wayback timestamp, format YYYYMMDDhhmmss. */
  timestamp: string;
  /** The original URL that was archived. */
  original: string;
  /** HTTP status code at capture time, e.g. "200". */
  statuscode: string;
}

export interface PageVersion {
  snapshot: Snapshot;
  /** Plain-text-ish HTML with Wayback's injected toolbar stripped. */
  content: string;
  /** ISO timestamp of when WE fetched it. */
  fetched_at: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "ChampHarbinger/1.0 (+https://github.com/championsmail)";

/** YYYYMMDDhhmmss (UTC) for the Wayback timestamp format. */
function formatWaybackTimestamp(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}

/** YYYYMMDD only — used by CDX from/to filters. */
function formatWaybackDate(date: Date): string {
  return formatWaybackTimestamp(date).slice(0, 8);
}

/**
 * Strip Wayback's injected toolbar / banner so diffs aren't dominated by
 * archive.org chrome. Wayback injects scripts with id="wm-...", inline JS
 * referencing `__wm` / `wbhack`, and an iframe-like wrapper div.
 */
function stripWaybackChrome(html: string): string {
  return html
    .replace(
      /<!--\s*BEGIN WAYBACK TOOLBAR INSERT[\s\S]*?END WAYBACK TOOLBAR INSERT\s*-->/gi,
      "",
    )
    .replace(
      /<script[^>]*\b(?:id|src)=["'][^"']*(?:wm-|wayback|wbhack|archive\.org)[^"']*["'][^>]*>[\s\S]*?<\/script>/gi,
      "",
    )
    .replace(
      /<script[^>]*>[\s\S]*?(?:__wm\.|wbhack|wombat)[\s\S]*?<\/script>/gi,
      "",
    )
    .replace(/<link[^>]*archive\.org[^>]*>/gi, "")
    .replace(/<div[^>]*id=["']wm-ipp[^"']*["'][\s\S]*?<\/div>/gi, "")
    .replace(/<iframe[^>]*id=["']wm-[^"']*["'][\s\S]*?<\/iframe>/gi, "");
}

/**
 * Look up the snapshot closest to `date` (defaults to today).
 * Returns null if Wayback has no archive of this URL.
 */
export async function getClosestSnapshot(
  url: string,
  date?: Date,
): Promise<Snapshot | null> {
  const ts = formatWaybackTimestamp(date ?? new Date());
  const endpoint = `https://archive.org/wayback/available?url=${encodeURIComponent(
    url,
  )}&timestamp=${ts}`;

  const res = await fetch(endpoint, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Wayback availability lookup failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    archived_snapshots?: {
      closest?: {
        url?: string;
        timestamp?: string;
        status?: string;
        available?: boolean;
      };
    };
  };

  const closest = data.archived_snapshots?.closest;
  if (!closest || !closest.available || !closest.timestamp || !closest.url) {
    return null;
  }

  return {
    url: closest.url,
    timestamp: closest.timestamp,
    original: url,
    statuscode: closest.status ?? "200",
  };
}

/**
 * List snapshots between `from` and `to` (defaults: last 12 months → today).
 * Default filter: status code 200 only.
 */
export async function listSnapshots(
  url: string,
  options: {
    from?: Date;
    to?: Date;
    limit?: number;
    statusCodeFilter?: string;
    /** Deduplicate consecutive content-identical snapshots. Default: true. */
    collapseDuplicates?: boolean;
  } = {},
): Promise<Snapshot[]> {
  const to = options.to ?? new Date();
  const from =
    options.from ?? new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000); // 12 months back
  const limit = options.limit ?? 100;
  const statusCodeFilter = options.statusCodeFilter ?? "200";
  const collapseDuplicates = options.collapseDuplicates ?? true;

  // matchType=exact + collapse=digest dramatically speeds up CDX for
  // popular URLs (otherwise the default prefix match scans every variant
  // of the URL and frequently exceeds our timeout).
  const params = new URLSearchParams({
    url,
    from: formatWaybackDate(from),
    to: formatWaybackDate(to),
    output: "json",
    limit: String(limit),
    matchType: "exact",
    filter: `statuscode:${statusCodeFilter}`,
    fl: "timestamp,original,statuscode",
  });
  if (collapseDuplicates) {
    params.append("collapse", "digest");
  }
  const endpoint = `https://web.archive.org/cdx/search/cdx?${params.toString()}`;

  const res = await fetch(endpoint, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Wayback CDX search failed: HTTP ${res.status}`);
  }

  // CDX JSON returns [header_row, ...data_rows]. May be empty.
  const text = await res.text();
  if (!text.trim()) return [];

  let rows: string[][];
  try {
    rows = JSON.parse(text) as string[][];
  } catch {
    return [];
  }
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const header = rows[0];
  const idxTs = header.indexOf("timestamp");
  const idxOrig = header.indexOf("original");
  const idxStatus = header.indexOf("statuscode");

  return rows.slice(1).map((row) => {
    const timestamp = row[idxTs] ?? "";
    const original = row[idxOrig] ?? url;
    const statuscode = row[idxStatus] ?? "200";
    return {
      url: `https://web.archive.org/web/${timestamp}/${original}`,
      timestamp,
      original,
      statuscode,
    } as Snapshot;
  });
}

/**
 * Fetch the archived HTML for a snapshot.
 * Uses the `id_` modifier so Wayback returns raw, un-rewritten HTML — but
 * it can still leak some toolbar chrome, so we strip it afterwards.
 */
export async function fetchSnapshotContent(
  timestamp: string,
  url: string,
): Promise<string> {
  // id_ asks for "identity" — no Wayback URL rewriting or toolbar injection.
  const endpoint = `https://web.archive.org/web/${timestamp}id_/${url}`;
  const res = await fetch(endpoint, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `Wayback snapshot fetch failed for ${timestamp}: HTTP ${res.status}`,
    );
  }
  const html = await res.text();
  return stripWaybackChrome(html);
}

/**
 * Convenience helper: for each date, fetch the closest snapshot and its
 * content. Snapshots that don't exist are silently skipped.
 */
export async function getPageVersions(
  url: string,
  dates: Date[],
): Promise<PageVersion[]> {
  const out: PageVersion[] = [];
  for (const d of dates) {
    const snap = await getClosestSnapshot(url, d);
    if (!snap) continue;
    try {
      const content = await fetchSnapshotContent(snap.timestamp, snap.original);
      out.push({
        snapshot: snap,
        content,
        fetched_at: new Date().toISOString(),
      });
    } catch {
      // skip unreachable snapshots
    }
  }
  return out;
}
