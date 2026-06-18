/**
 * End-to-end smoke test for the Crawl4AI microservice client.
 *
 * Boots without Next.js — stubs `server-only` so the tsx runner can import
 * the client. Hits the live service at CRAWL4AI_BASE_URL (default
 * http://localhost:8000) and exercises:
 *
 *   1. /health        — basic reachability
 *   2. crawlPages     — single URL markdown extraction
 *   3. bulkCrawl      — three URLs in parallel
 *
 * Run: pnpm exec tsx scripts/test-crawl4ai.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { createRequire } from "module";

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

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const BASE_URL = process.env.CRAWL4AI_BASE_URL ?? "http://localhost:8000";
console.log(`\n🧪 Crawl4AI integration test`);
console.log(`   CRAWL4AI_BASE_URL: ${BASE_URL}\n`);

async function run() {
  const { checkCrawl4AIHealth, crawlPages, bulkCrawl } =
    await import("../src/lib/services/crawl4ai-client");

  // 1. Health
  console.log("[1] /health …");
  const health = await checkCrawl4AIHealth();
  if (!health.ok) {
    console.error(`   ✗ service unreachable: ${health.error}`);
    console.error(
      "   Hint: start the service with `docker compose up -d crawl4ai`",
    );
    process.exit(1);
  }
  console.log("   ✓ ok");

  // 2. Single-URL crawl
  console.log("\n[2] crawlPages(['https://example.com']) …");
  const single = await crawlPages(["https://example.com"]);
  if (single.length !== 1) {
    console.error(`   ✗ expected 1 result, got ${single.length}`);
    process.exit(1);
  }
  const first = single[0];
  if (!first.success || !first.markdown || first.markdown.length === 0) {
    console.error(`   ✗ crawl failed: ${first.error ?? "no markdown"}`);
    process.exit(1);
  }
  console.log(
    `   ✓ ${first.markdown.length} chars of markdown (status ${first.status_code ?? "?"})`,
  );

  // 3. Bulk crawl
  const urls = [
    "https://example.com",
    "https://example.org",
    "https://example.net",
  ];
  console.log(`\n[3] bulkCrawl(${urls.length} URLs) …`);
  const bulk = await bulkCrawl(urls, 3);
  if (bulk.length !== urls.length) {
    console.error(`   ✗ expected ${urls.length} results, got ${bulk.length}`);
    process.exit(1);
  }
  const allOk = bulk.every((r) => r.success);
  bulk.forEach((r) => {
    const len = r.markdown?.length ?? 0;
    const status = r.success ? "✓" : "✗";
    console.log(
      `   ${status} ${r.url} — ${len} chars${r.error ? ` (${r.error})` : ""}`,
    );
  });
  if (!allOk) {
    console.error("\n   ✗ at least one bulk URL failed");
    process.exit(1);
  }

  console.log("\n✅ All Crawl4AI smoke tests passed.\n");
}

run().catch((err) => {
  console.error("\n✗ Fatal error:", err);
  process.exit(1);
});
