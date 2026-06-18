/**
 * End-to-end test for the SearXNG meta-search integration.
 *
 * Prereq: `docker compose up -d searxng` (instance must be reachable at
 * SEARXNG_BASE_URL, defaulting to http://localhost:8888).
 *
 * Run: pnpm exec tsx scripts/test-searxng.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { createRequire } from "module";

// Stub `server-only` so tsx can load modules that import it.
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

// Ensure a base URL is set so the client doesn't short-circuit.
if (!process.env.SEARXNG_BASE_URL) {
  process.env.SEARXNG_BASE_URL = "http://localhost:8888";
}

console.log("\nSearXNG integration test");
console.log(`  SEARXNG_BASE_URL: ${process.env.SEARXNG_BASE_URL}\n`);

async function run() {
  const { webSearch, newsSearch, checkSearXNGHealth } =
    await import("../src/lib/services/searxng-client");

  // Step 1 — health check
  console.log("[1] Checking health endpoint...");
  const health = await checkSearXNGHealth();
  if (!health.ok) {
    console.error(`    ✗ SearXNG unreachable: ${health.error}`);
    console.error(
      "    Make sure the container is running: `docker compose up -d searxng`",
    );
    process.exit(1);
  }
  console.log("    ✓ SearXNG reachable\n");

  // Step 2 — web search
  console.log("[2] webSearch('OpenAI funding round 2024')...");
  const webResults = await webSearch("OpenAI funding round 2024", {
    limit: 10,
  });
  if (webResults.length === 0) {
    console.error("    ✗ Expected non-empty results, got 0");
    process.exit(1);
  }
  console.log(`    ✓ ${webResults.length} results`);
  console.log("    Top 3:");
  webResults.slice(0, 3).forEach((r, i) => {
    console.log(`      ${i + 1}. [${r.engine}] ${r.title}`);
    console.log(`         ${r.url}`);
    if (r.content) {
      console.log(`         ${r.content.slice(0, 120).replace(/\s+/g, " ")}…`);
    }
  });

  // Step 3 — news search
  console.log(
    "\n[3] newsSearch('Series A startup', { timeRange: 'month' })...",
  );
  const newsResults = await newsSearch("Series A startup", {
    timeRange: "month",
    limit: 10,
  });
  if (newsResults.length === 0) {
    console.error("    ✗ Expected non-empty results, got 0");
    process.exit(1);
  }
  console.log(`    ✓ ${newsResults.length} results`);
  console.log("    Top 3:");
  newsResults.slice(0, 3).forEach((r, i) => {
    console.log(`      ${i + 1}. [${r.engine}] ${r.title}`);
    console.log(`         ${r.url}`);
    if (r.publishedDate) console.log(`         published: ${r.publishedDate}`);
    if (r.content) {
      console.log(`         ${r.content.slice(0, 120).replace(/\s+/g, " ")}…`);
    }
  });

  console.log("\n" + "═".repeat(60));
  console.log("All SearXNG tests passed.");
  console.log("═".repeat(60) + "\n");
}

run().catch((err) => {
  console.error("\n✗ Fatal error:", err);
  process.exit(1);
});
