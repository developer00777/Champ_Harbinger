/**
 * End-to-end test for the Wayback Machine integration.
 *
 * Hits the real public Wayback API (no auth required). Tests:
 *   1. getClosestSnapshot for today
 *   2. listSnapshots for the last 6 months
 *   3. comparePageVersions between ~1 year ago and today (asserts no crash;
 *      diff itself may be empty depending on archived snapshots)
 *
 * Run: pnpm exec tsx scripts/test-wayback.ts
 */
import { resolve } from "path";
import { createRequire } from "module";

// Stub `server-only` so tsx doesn't throw.
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

const TEST_URL = "https://stripe.com/pricing";

async function run() {
  console.log("\nWayback Machine integration test");
  console.log(`URL: ${TEST_URL}\n`);

  const { getClosestSnapshot, listSnapshots, fetchSnapshotContent } =
    await import("../src/lib/services/wayback-client");
  const { diffPlainText, htmlToPlainText } =
    await import("../src/lib/services/page-differ");

  // 1. Closest snapshot for today. Wayback occasionally returns no closest
  // snapshot due to transient issues; retry a few times.
  console.log("[1] getClosestSnapshot (today)...");
  async function closestWithRetry(date?: Date) {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const s = await getClosestSnapshot(TEST_URL, date);
        if (s) return s;
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (lastErr) throw lastErr;
    return null;
  }
  const today = await closestWithRetry();
  if (!today) {
    throw new Error("Expected at least one snapshot, got null (after retries)");
  }
  console.log(
    `    -> ${today.timestamp}  status=${today.statuscode}\n    ${today.url}`,
  );

  // 2. Last 6 months. CDX can be flaky / slow; retry once on timeout.
  console.log("\n[2] listSnapshots (last 6 months)...");
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 30 * 24 * 60 * 60 * 1000);
  async function listWithRetry() {
    try {
      return await listSnapshots(TEST_URL, { from, to, limit: 25 });
    } catch (err) {
      console.log(
        `    first attempt failed (${err instanceof Error ? err.message : err}), retrying...`,
      );
      return await listSnapshots(TEST_URL, { from, to, limit: 25 });
    }
  }
  const snaps = await listWithRetry();
  console.log(`    -> ${snaps.length} snapshots`);
  if (snaps.length === 0) {
    throw new Error("Expected at least one snapshot in the last 6 months");
  }
  console.log(
    `    first=${snaps[0].timestamp}  last=${snaps[snaps.length - 1].timestamp}`,
  );

  // 3. Compare ~1 year ago vs today
  console.log("\n[3] comparePageVersions (~1 year ago vs today)...");
  const yearAgo = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
  const beforeSnap = await closestWithRetry(yearAgo);
  const afterSnap = await closestWithRetry(to);
  if (!beforeSnap || !afterSnap) {
    console.log(
      `    WARN: snapshots missing (before=${!!beforeSnap}, after=${!!afterSnap})`,
    );
  } else {
    console.log(
      `    before=${beforeSnap.timestamp}  after=${afterSnap.timestamp}`,
    );
    const beforeHtml = await fetchSnapshotContent(
      beforeSnap.timestamp,
      beforeSnap.original,
    );
    const afterHtml = await fetchSnapshotContent(
      afterSnap.timestamp,
      afterSnap.original,
    );
    const diff = diffPlainText(
      htmlToPlainText(beforeHtml),
      htmlToPlainText(afterHtml),
    );
    console.log(
      `    -> added=${diff.added.length}  removed=${diff.removed.length}  modified=${diff.modified.length}`,
    );
    const sampleAdded = diff.added.slice(0, 3);
    const sampleRemoved = diff.removed.slice(0, 3);
    if (sampleAdded.length) {
      console.log("    sample added:");
      sampleAdded.forEach((l) => console.log(`      + ${l.slice(0, 100)}`));
    }
    if (sampleRemoved.length) {
      console.log("    sample removed:");
      sampleRemoved.forEach((l) => console.log(`      - ${l.slice(0, 100)}`));
    }
  }

  console.log("\nAll Wayback tests passed.\n");
}

run().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
