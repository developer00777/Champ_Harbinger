import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  getClosestSnapshot,
  listSnapshots,
  fetchSnapshotContent,
} from "@/lib/services/wayback-client";
import { diffPlainText, htmlToPlainText } from "@/lib/services/page-differ";

/** Bucket Wayback snapshots by YYYY-MM for a month-level history view. */
function summarizeByMonth(
  snapshots: { timestamp: string; url: string; statuscode: string }[],
) {
  const byMonth = new Map<
    string,
    { count: number; first: string; last: string; example: string }
  >();
  for (const s of snapshots) {
    const ym = `${s.timestamp.slice(0, 4)}-${s.timestamp.slice(4, 6)}`;
    const existing = byMonth.get(ym);
    if (!existing) {
      byMonth.set(ym, {
        count: 1,
        first: s.timestamp,
        last: s.timestamp,
        example: s.url,
      });
    } else {
      existing.count++;
      if (s.timestamp < existing.first) existing.first = s.timestamp;
      if (s.timestamp > existing.last) {
        existing.last = s.timestamp;
        existing.example = s.url;
      }
    }
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([month, v]) => ({ month, ...v }));
}

export const getPageHistory = tool({
  description:
    "Look up the Wayback Machine snapshot history for a URL. " +
    "Returns a month-by-month summary of how often the page was archived. " +
    "Use this to see whether a URL is archived at all, and how frequently. " +
    "Free / no API key required.",
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe("Full URL to look up, e.g. https://stripe.com/pricing"),
    monthsBack: z
      .number()
      .int()
      .min(1)
      .max(120)
      .optional()
      .describe("How many months of history to fetch (default 12)"),
  }),
  execute: async ({ url, monthsBack = 12 }) => {
    const to = new Date();
    const from = new Date(to.getTime() - monthsBack * 30 * 24 * 60 * 60 * 1000);
    try {
      const snapshots = await listSnapshots(url, { from, to, limit: 500 });
      return {
        url,
        monthsBack,
        totalSnapshots: snapshots.length,
        firstSnapshot: snapshots[0]?.timestamp ?? null,
        latestSnapshot: snapshots[snapshots.length - 1]?.timestamp ?? null,
        byMonth: summarizeByMonth(snapshots),
      };
    } catch (err) {
      return {
        url,
        error: err instanceof Error ? err.message : String(err),
        totalSnapshots: 0,
        byMonth: [],
      };
    }
  },
});

export const comparePageVersions = tool({
  description:
    "Compare two archived versions of a page from the Wayback Machine and " +
    "return a plain-text diff (added / removed / modified lines). Use to " +
    "answer 'did X change between these two dates?' — e.g. pricing page " +
    "edits, leadership swaps, feature launches.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to compare across time"),
    before: z
      .string()
      .describe("ISO date (e.g. 2024-01-15) — earlier snapshot"),
    after: z.string().describe("ISO date (e.g. 2025-01-15) — later snapshot"),
  }),
  execute: async ({ url, before, after }) => {
    const beforeDate = new Date(before);
    const afterDate = new Date(after);
    if (isNaN(beforeDate.getTime()) || isNaN(afterDate.getTime())) {
      return { url, error: "Invalid before/after date" };
    }

    const beforeSnap = await getClosestSnapshot(url, beforeDate);
    const afterSnap = await getClosestSnapshot(url, afterDate);
    if (!beforeSnap || !afterSnap) {
      return {
        url,
        error: "No archived snapshot near one or both dates",
        beforeFound: !!beforeSnap,
        afterFound: !!afterSnap,
      };
    }

    const [beforeHtml, afterHtml] = await Promise.all([
      fetchSnapshotContent(beforeSnap.timestamp, beforeSnap.original),
      fetchSnapshotContent(afterSnap.timestamp, afterSnap.original),
    ]);

    const beforeText = htmlToPlainText(beforeHtml);
    const afterText = htmlToPlainText(afterHtml);
    const diff = diffPlainText(beforeText, afterText);

    const summary = `${diff.added.length} added, ${diff.removed.length} removed, ${diff.modified.length} modified`;

    return {
      url,
      before: {
        requested: before,
        timestamp: beforeSnap.timestamp,
        snapshotUrl: beforeSnap.url,
      },
      after: {
        requested: after,
        timestamp: afterSnap.timestamp,
        snapshotUrl: afterSnap.url,
      },
      added: diff.added,
      removed: diff.removed,
      modified: diff.modified,
      summary,
    };
  },
});

export const detectRecentChanges = tool({
  description:
    "Detect whether a page changed in roughly the last 30 days. Compares the " +
    "latest Wayback snapshot to one from ~30 days earlier. Useful for " +
    "'did this company's pricing page change recently?' style questions. " +
    "Free / no API key.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to check for recent changes"),
  }),
  execute: async ({ url }) => {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const latestSnap = await getClosestSnapshot(url, now);
    const earlierSnap = await getClosestSnapshot(url, monthAgo);

    if (!latestSnap || !earlierSnap) {
      return {
        url,
        changed: false,
        error: "No archived snapshot for one or both reference dates",
        latestFound: !!latestSnap,
        earlierFound: !!earlierSnap,
      };
    }

    if (latestSnap.timestamp === earlierSnap.timestamp) {
      return {
        url,
        changed: false,
        summary:
          "Wayback only has one snapshot in the last ~30 days, so no comparison is possible",
        latestSnapshot: latestSnap.timestamp,
      };
    }

    const [earlierHtml, latestHtml] = await Promise.all([
      fetchSnapshotContent(earlierSnap.timestamp, earlierSnap.original),
      fetchSnapshotContent(latestSnap.timestamp, latestSnap.original),
    ]);

    const diff = diffPlainText(
      htmlToPlainText(earlierHtml),
      htmlToPlainText(latestHtml),
    );
    const changed =
      diff.added.length > 0 ||
      diff.removed.length > 0 ||
      diff.modified.length > 0;

    return {
      url,
      changed,
      earlier: {
        timestamp: earlierSnap.timestamp,
        snapshotUrl: earlierSnap.url,
      },
      latest: {
        timestamp: latestSnap.timestamp,
        snapshotUrl: latestSnap.url,
      },
      added: diff.added,
      removed: diff.removed,
      modified: diff.modified,
      summary: `${diff.added.length} added, ${diff.removed.length} removed, ${diff.modified.length} modified between ${earlierSnap.timestamp} and ${latestSnap.timestamp}`,
    };
  },
});
