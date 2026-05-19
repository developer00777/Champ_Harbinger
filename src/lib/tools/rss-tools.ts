import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { checkAllFeeds, checkFeed, fetchFeed } from "@/lib/services/rss-monitor";

export const addFeedMonitor = tool({
  description:
    "Register an RSS or Atom feed URL for continuous monitoring. Performs an initial fetch to validate the feed and seeds known items. " +
    "Use this when the user wants to track a company blog, newsroom, changelog, or any other RSS/Atom feed.",
  inputSchema: z.object({
    feedUrl: z
      .string()
      .url()
      .describe("Absolute URL of the RSS or Atom feed (e.g. https://example.com/rss)"),
    organizationId: z
      .string()
      .uuid()
      .optional()
      .describe("Optional organization id to associate the feed with"),
    title: z
      .string()
      .optional()
      .describe(
        "Optional human-readable title. If omitted, the feed's own title is used.",
      ),
  }),
  execute: async ({ feedUrl, organizationId, title }) => {
    let userId: string;
    let orgId: string | null;
    try {
      ({ userId, orgId } = await getCurrentUser());
    } catch {
      return { ok: false, error: "Not authenticated" };
    }

    // Validate by fetching once before inserting.
    let initialFeed: Awaited<ReturnType<typeof fetchFeed>>;
    try {
      initialFeed = await fetchFeed(feedUrl);
    } catch (err) {
      return {
        ok: false,
        error: `Could not parse feed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const resolvedTitle = title ?? initialFeed.title ?? null;

    const [row] = await adminDb
      .insert(schema.monitoredFeeds)
      .values({
        clerkUserId: userId,
        clerkOrgId: orgId,
        organizationId: organizationId ?? null,
        feedUrl,
        feedType: "rss",
        title: resolvedTitle,
      })
      .onConflictDoNothing({
        target: [
          schema.monitoredFeeds.clerkUserId,
          schema.monitoredFeeds.feedUrl,
        ],
      })
      .returning({ id: schema.monitoredFeeds.id });

    let feedId: string;
    if (row) {
      feedId = row.id;
    } else {
      const [existing] = await adminDb
        .select({ id: schema.monitoredFeeds.id })
        .from(schema.monitoredFeeds)
        .where(
          and(
            eq(schema.monitoredFeeds.clerkUserId, userId),
            eq(schema.monitoredFeeds.feedUrl, feedUrl),
          ),
        )
        .limit(1);
      if (!existing) {
        return { ok: false, error: "Failed to insert or locate feed" };
      }
      feedId = existing.id;
    }

    const result = await checkFeed(feedId);

    return {
      ok: true,
      feedId,
      title: resolvedTitle,
      feedUrl,
      itemsIngested: result.newItems,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  },
});

export const listMyFeeds = tool({
  description:
    "List all RSS/Atom feeds the current user is monitoring along with health metadata (last check, last success, error count, enabled state).",
  inputSchema: z.object({}),
  execute: async () => {
    let userId: string;
    try {
      ({ userId } = await getCurrentUser());
    } catch {
      return { ok: false, error: "Not authenticated", feeds: [] };
    }

    const rows = await adminDb
      .select({
        id: schema.monitoredFeeds.id,
        feedUrl: schema.monitoredFeeds.feedUrl,
        title: schema.monitoredFeeds.title,
        enabled: schema.monitoredFeeds.enabled,
        lastCheckedAt: schema.monitoredFeeds.lastCheckedAt,
        lastSuccessAt: schema.monitoredFeeds.lastSuccessAt,
        errorCount: schema.monitoredFeeds.errorCount,
        organizationId: schema.monitoredFeeds.organizationId,
        createdAt: schema.monitoredFeeds.createdAt,
      })
      .from(schema.monitoredFeeds)
      .where(eq(schema.monitoredFeeds.clerkUserId, userId))
      .orderBy(desc(schema.monitoredFeeds.createdAt));

    return {
      ok: true,
      count: rows.length,
      feeds: rows.map((r) => ({
        id: r.id,
        feedUrl: r.feedUrl,
        title: r.title,
        enabled: r.enabled,
        lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
        lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
        errorCount: r.errorCount ?? 0,
        organizationId: r.organizationId,
      })),
    };
  },
});

export const getRecentFeedItems = tool({
  description:
    "Return recently ingested feed items, optionally filtered to a single feed and/or restricted to a recency window in hours. " +
    "Use this to surface news the user should look at right now.",
  inputSchema: z.object({
    feedId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Optional feed id. When omitted, returns items across all of the user's feeds.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(25)
      .optional()
      .describe("Maximum items to return (default 25, max 200)"),
    sinceHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .optional()
      .describe("Only return items published within the last N hours"),
  }),
  execute: async ({ feedId, limit = 25, sinceHours }) => {
    let userId: string;
    try {
      ({ userId } = await getCurrentUser());
    } catch {
      return { ok: false, error: "Not authenticated", items: [] };
    }

    const conditions = [eq(schema.monitoredFeeds.clerkUserId, userId)];
    if (feedId) conditions.push(eq(schema.feedItems.feedId, feedId));
    if (sinceHours) {
      const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
      conditions.push(gte(schema.feedItems.publishedAt, cutoff));
    }

    const rows = await adminDb
      .select({
        id: schema.feedItems.id,
        feedId: schema.feedItems.feedId,
        feedTitle: schema.monitoredFeeds.title,
        feedUrl: schema.monitoredFeeds.feedUrl,
        title: schema.feedItems.title,
        link: schema.feedItems.link,
        summary: schema.feedItems.summary,
        publishedAt: schema.feedItems.publishedAt,
        processed: schema.feedItems.processed,
      })
      .from(schema.feedItems)
      .innerJoin(
        schema.monitoredFeeds,
        eq(schema.feedItems.feedId, schema.monitoredFeeds.id),
      )
      .where(and(...conditions))
      .orderBy(
        desc(
          sql`coalesce(${schema.feedItems.publishedAt}, ${schema.feedItems.createdAt})`,
        ),
      )
      .limit(limit);

    return {
      ok: true,
      count: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        feedId: r.feedId,
        feedTitle: r.feedTitle,
        feedUrl: r.feedUrl,
        title: r.title,
        link: r.link,
        summary: r.summary,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        processed: r.processed,
      })),
    };
  },
});

export const checkAllMyFeeds = tool({
  description:
    "Manually trigger a poll of every enabled feed the current user owns. Returns counts of feeds checked, new items ingested, and any errors. " +
    "Useful when the user wants fresh data on demand without waiting for the next scheduled poll.",
  inputSchema: z.object({
    maxConcurrent: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Maximum number of feeds to fetch in parallel (default 5)"),
  }),
  execute: async ({ maxConcurrent }) => {
    let userId: string;
    try {
      ({ userId } = await getCurrentUser());
    } catch {
      return { ok: false, error: "Not authenticated" };
    }

    const result = await checkAllFeeds(userId, maxConcurrent);
    return {
      ok: true,
      ...result,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  },
});
