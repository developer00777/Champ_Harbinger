/**
 * End-to-end test for the self-hosted RSS/Atom monitor.
 *
 * Tests:
 *   1. fetchFeed parses a real-world RSS feed (TechCrunch) and returns items > 0
 *   2. checkFeed inserts items and updates bookkeeping columns
 *   3. checkFeed run twice does NOT create duplicates (dedup by guid works)
 *
 * Run: DATABASE_URL=postgres://... pnpm exec tsx scripts/test-rss-monitor.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { createRequire } from "module";

// Stub `server-only` so the tsx runner doesn't throw.
const _require = createRequire(import.meta.url);
const Module = _require("module") as typeof import("module") & {
  _resolveFilename: (
    request: string,
    parent: unknown,
    isMain: boolean,
    options: unknown,
  ) => string;
};
const _origResolve = Module._resolveFilename.bind(Module);
(
  Module as unknown as { _resolveFilename: typeof _origResolve }
)._resolveFilename = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => {
  if (request === "server-only") {
    return resolve(process.cwd(), "src/__tests__/__mocks__/server-only.ts");
  }
  return _origResolve(request, parent, isMain, options);
};

// Load env before anything else
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL must be set (no migrations are run by this script).");
  process.exit(1);
}

const FEED_URL = "https://techcrunch.com/feed/";
const TEST_USER_ID = `test-rss-${Date.now()}`;

async function run() {
  const { fetchFeed, checkFeed } = await import(
    "../src/lib/services/rss-monitor"
  );
  const { adminDb } = await import("../src/lib/db/admin");
  const { schema } = await import("../db/index");
  const { and, eq, sql } = await import("drizzle-orm");

  console.log("\n🧪 RSS monitor integration test\n");
  console.log(`  Feed: ${FEED_URL}`);
  console.log(`  User: ${TEST_USER_ID}\n`);

  let createdFeedId: string | null = null;

  try {
    // ── Step 1: fetchFeed ───────────────────────────────────────────────────
    console.log("[1] fetchFeed → parsing TechCrunch...");
    const parsed = await fetchFeed(FEED_URL);
    console.log(`    title: ${parsed.title}`);
    console.log(`    items: ${parsed.items.length}`);
    if (parsed.items.length === 0) {
      throw new Error("Expected items > 0 from TechCrunch feed");
    }
    console.log(`    sample: ${parsed.items[0].title?.slice(0, 80)}...`);

    // ── Step 2: insert feed + checkFeed (first run) ─────────────────────────
    console.log("\n[2] inserting test feed row + first checkFeed()...");
    const [row] = await adminDb
      .insert(schema.monitoredFeeds)
      .values({
        clerkUserId: TEST_USER_ID,
        feedUrl: FEED_URL,
        feedType: "rss",
        title: parsed.title ?? "TechCrunch",
      })
      .returning({ id: schema.monitoredFeeds.id });
    createdFeedId = row.id;
    console.log(`    feedId: ${createdFeedId}`);

    const first = await checkFeed(createdFeedId);
    console.log(`    newItems: ${first.newItems}`);
    console.log(`    errors:   ${first.errors.length}`);
    if (first.newItems === 0) {
      throw new Error("Expected newItems > 0 on first checkFeed run");
    }
    if (first.errors.length > 0) {
      console.warn("    ⚠ unexpected errors:", first.errors);
    }

    // Verify bookkeeping columns updated.
    const [afterFirst] = await adminDb
      .select()
      .from(schema.monitoredFeeds)
      .where(eq(schema.monitoredFeeds.id, createdFeedId))
      .limit(1);
    if (!afterFirst.lastSuccessAt) {
      throw new Error("lastSuccessAt was not set after successful check");
    }
    if (afterFirst.errorCount !== 0) {
      throw new Error(
        `errorCount expected 0 after success, got ${afterFirst.errorCount}`,
      );
    }
    console.log("    ✓ bookkeeping columns updated (lastSuccessAt set, errorCount = 0)");

    // ── Step 3: checkFeed (second run) → expect zero new items ──────────────
    console.log("\n[3] second checkFeed() → expect dedup, newItems = 0...");
    const second = await checkFeed(createdFeedId);
    console.log(`    newItems: ${second.newItems}`);
    console.log(`    errors:   ${second.errors.length}`);
    if (second.newItems !== 0) {
      throw new Error(
        `Dedup broken: expected 0 new items on second run, got ${second.newItems}`,
      );
    }

    // Verify total row count matches first.newItems.
    const [{ count }] = await adminDb
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.feedItems)
      .where(eq(schema.feedItems.feedId, createdFeedId));
    console.log(`    feed_items row count: ${count}`);
    if (count !== first.newItems) {
      throw new Error(
        `Row count mismatch: expected ${first.newItems}, got ${count}`,
      );
    }

    console.log("\n✓ All assertions passed.\n");
  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    console.log("[cleanup] removing test data...");
    if (createdFeedId) {
      await adminDb
        .delete(schema.feedItems)
        .where(eq(schema.feedItems.feedId, createdFeedId));
      await adminDb
        .delete(schema.monitoredFeeds)
        .where(eq(schema.monitoredFeeds.id, createdFeedId));
    }
    // Defensive: also wipe any leftover rows for this test user.
    await adminDb
      .delete(schema.monitoredFeeds)
      .where(
        and(
          eq(schema.monitoredFeeds.clerkUserId, TEST_USER_ID),
          eq(schema.monitoredFeeds.feedUrl, FEED_URL),
        ),
      );
    console.log("[cleanup] done.\n");
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Fatal error:", err);
    process.exit(1);
  });
