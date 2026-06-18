import "server-only";
import Parser from "rss-parser";
import { and, eq, sql } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 5;

export interface NormalizedItem {
  guid: string;
  title: string | null;
  link: string | null;
  publishedAt: Date | null;
  summary: string | null;
  content: string | null;
}

export interface FetchFeedResult {
  title: string | null;
  items: NormalizedItem[];
}

export interface CheckFeedResult {
  newItems: number;
  errors: string[];
}

export interface CheckAllFeedsResult {
  checked: number;
  newItems: number;
  errors: string[];
}

/**
 * Build a Parser instance per call (rss-parser holds per-instance request
 * config so reusing it across concurrent fetches is fine, but recreating
 * is cheap and avoids any shared state pitfalls).
 */
function makeParser() {
  return new Parser({
    timeout: FETCH_TIMEOUT_MS,
    headers: {
      "User-Agent":
        "ChampHarbinger-RSSMonitor/1.0 (+https://champhar.binger)",
    },
  });
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function deriveGuid(item: Parser.Item): string {
  // Prefer rss-parser's normalized guid; fall back to link or title hash.
  if (item.guid && item.guid.length > 0) return item.guid;
  if (item.link && item.link.length > 0) return item.link;
  if (item.title && item.title.length > 0) {
    return `title:${item.title.slice(0, 256)}`;
  }
  // Last resort: a random-ish stable hash of pubDate to avoid empty guid.
  return `anon:${item.pubDate ?? Math.random().toString(36).slice(2)}`;
}

function normalizeItems(items: Parser.Item[]): NormalizedItem[] {
  return items.map((item) => ({
    guid: deriveGuid(item),
    title: item.title ?? null,
    link: item.link ?? null,
    publishedAt: parseDate(item.isoDate ?? item.pubDate),
    summary: item.contentSnippet ?? item.summary ?? null,
    content: item.content ?? null,
  }));
}

/**
 * Fetch and parse an RSS/Atom feed. Throws on network/parse errors.
 */
export async function fetchFeed(url: string): Promise<FetchFeedResult> {
  const parser = makeParser();
  // rss-parser supports a `timeout` option internally, but it does not always
  // abort the underlying request. Wrap in an explicit timeout race so we never
  // block indefinitely on a slow feed.
  const parsed = await Promise.race<Parser.Output<Record<string, unknown>>>([
    parser.parseURL(url),
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`Feed fetch timed out after ${FETCH_TIMEOUT_MS}ms`)),
        FETCH_TIMEOUT_MS,
      ),
    ),
  ]);

  return {
    title: parsed.title ?? null,
    items: normalizeItems(parsed.items ?? []),
  };
}

/**
 * Fetch a feed by id, insert any new items, and update bookkeeping columns.
 * Never throws — failures bump errorCount and are returned in `errors`.
 */
export async function checkFeed(feedId: string): Promise<CheckFeedResult> {
  const errors: string[] = [];
  const [feed] = await adminDb
    .select()
    .from(schema.monitoredFeeds)
    .where(eq(schema.monitoredFeeds.id, feedId))
    .limit(1);

  if (!feed) {
    return { newItems: 0, errors: [`Feed ${feedId} not found`] };
  }

  const now = new Date();

  let parsed: FetchFeedResult;
  try {
    parsed = await fetchFeed(feed.feedUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`fetch failed: ${message}`);
    await adminDb
      .update(schema.monitoredFeeds)
      .set({
        lastCheckedAt: now,
        errorCount: sql`coalesce(${schema.monitoredFeeds.errorCount}, 0) + 1`,
        updatedAt: now,
      })
      .where(eq(schema.monitoredFeeds.id, feedId));
    return { newItems: 0, errors };
  }

  let newItems = 0;
  for (const item of parsed.items) {
    try {
      const inserted = await adminDb
        .insert(schema.feedItems)
        .values({
          feedId,
          guid: item.guid,
          title: item.title,
          link: item.link,
          publishedAt: item.publishedAt,
          summary: item.summary,
          content: item.content,
        })
        .onConflictDoNothing({
          target: [schema.feedItems.feedId, schema.feedItems.guid],
        })
        .returning({ id: schema.feedItems.id });
      if (inserted.length > 0) newItems++;
    } catch (err) {
      errors.push(
        `insert ${item.guid}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await adminDb
    .update(schema.monitoredFeeds)
    .set({
      lastCheckedAt: now,
      lastSuccessAt: now,
      errorCount: 0,
      title: feed.title ?? parsed.title,
      updatedAt: now,
    })
    .where(eq(schema.monitoredFeeds.id, feedId));

  return { newItems, errors };
}

/**
 * Run `checkFeed` over every enabled feed for a user with bounded
 * concurrency. Errors aggregate; the function does not throw.
 */
export async function checkAllFeeds(
  clerkUserId: string,
  maxConcurrent: number = DEFAULT_CONCURRENCY,
): Promise<CheckAllFeedsResult> {
  const feeds = await adminDb
    .select({ id: schema.monitoredFeeds.id })
    .from(schema.monitoredFeeds)
    .where(
      and(
        eq(schema.monitoredFeeds.clerkUserId, clerkUserId),
        eq(schema.monitoredFeeds.enabled, true),
      ),
    );

  return runCheckBatch(
    feeds.map((f) => f.id),
    maxConcurrent,
  );
}

/**
 * Run `checkFeed` over every enabled feed system-wide. Used by the cron
 * endpoint when no user/feed is specified.
 */
export async function checkAllEnabledFeeds(
  maxConcurrent: number = DEFAULT_CONCURRENCY,
): Promise<CheckAllFeedsResult> {
  const feeds = await adminDb
    .select({ id: schema.monitoredFeeds.id })
    .from(schema.monitoredFeeds)
    .where(eq(schema.monitoredFeeds.enabled, true));

  return runCheckBatch(
    feeds.map((f) => f.id),
    maxConcurrent,
  );
}

async function runCheckBatch(
  feedIds: string[],
  maxConcurrent: number,
): Promise<CheckAllFeedsResult> {
  const errors: string[] = [];
  let checked = 0;
  let newItems = 0;

  const limit = Math.max(1, maxConcurrent);
  let cursor = 0;

  async function worker() {
    while (cursor < feedIds.length) {
      const idx = cursor++;
      const id = feedIds[idx];
      try {
        const result = await checkFeed(id);
        checked++;
        newItems += result.newItems;
        for (const e of result.errors) errors.push(`${id}: ${e}`);
      } catch (err) {
        errors.push(
          `${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, feedIds.length) }, () => worker()),
  );

  return { checked, newItems, errors };
}
