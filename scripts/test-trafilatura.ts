/**
 * End-to-end test for the Trafilatura microservice integration.
 *
 * Skips automatically when TRAFILATURA_BASE_URL is unset OR the service is
 * unreachable — so it stays green on CI machines that don't run the Python
 * container.
 *
 * Run:
 *   docker compose up -d trafilatura
 *   TRAFILATURA_BASE_URL=http://localhost:8001 pnpm exec tsx scripts/test-trafilatura.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { createRequire } from "module";

// Stub `server-only` so tsx doesn't blow up — same trick the LakeB2B test uses.
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

async function main() {
  const baseUrl = process.env.TRAFILATURA_BASE_URL?.trim();
  if (!baseUrl) {
    console.log(
      "⏭  TRAFILATURA_BASE_URL not set — skipping Trafilatura integration test.",
    );
    process.exit(0);
  }

  const { checkTrafilaturaHealth, extractFromUrl, extractBatch } =
    await import("../src/lib/services/trafilatura-client");

  console.log(`\n🧪 Trafilatura test against ${baseUrl}\n`);

  console.log("[1] Health check…");
  const health = await checkTrafilaturaHealth();
  if (!health.ok) {
    console.log(
      `⏭  service unreachable (${health.error ?? "unknown"}) — skipping.`,
    );
    process.exit(0);
  }
  console.log("    ✓ healthy");

  // -- Single URL extraction --------------------------------------------------
  const target = "https://techcrunch.com/";
  console.log(`\n[2] Extracting single URL: ${target}`);
  const single = await extractFromUrl(target, { format: "markdown" });

  console.log(`    success: ${single.success}`);
  console.log(`    title:   ${single.title ?? "(none)"}`);
  console.log(`    author:  ${single.author ?? "(none)"}`);
  console.log(`    date:    ${single.date ?? "(none)"}`);
  console.log(`    lang:    ${single.language ?? "(none)"}`);
  const body = single.markdown ?? single.text ?? "";
  console.log(`    bytes:   ${body.length}`);
  console.log(
    `    preview: ${body.slice(0, 160).replace(/\s+/g, " ")}${body.length > 160 ? "…" : ""}`,
  );

  if (!single.success) {
    // TechCrunch homepage occasionally fails extraction — try Wikipedia as
    // a deterministic fallback so we still exercise the success path.
    console.log("    ⚠ extraction failed; retrying against Wikipedia…");
    const fallback = await extractFromUrl(
      "https://en.wikipedia.org/wiki/Web_scraping",
      { format: "markdown" },
    );
    if (!fallback.success || !(fallback.text || fallback.markdown)) {
      console.error("    ✗ fallback also failed:", fallback.error);
      process.exit(1);
    }
    if (!fallback.title) {
      console.error("    ✗ no title returned");
      process.exit(1);
    }
    console.log(`    ✓ fallback ok — title: ${fallback.title}`);
  } else if (!body) {
    console.error("    ✗ extraction succeeded but body is empty");
    process.exit(1);
  }

  // -- Batch extraction ------------------------------------------------------
  const batchUrls = [
    "https://en.wikipedia.org/wiki/Web_scraping",
    "https://en.wikipedia.org/wiki/Natural_language_processing",
    "https://en.wikipedia.org/wiki/Information_retrieval",
  ];
  console.log(`\n[3] Batch extraction (${batchUrls.length} URLs)…`);
  const batch = await extractBatch(batchUrls, {
    format: "text",
    maxConcurrent: 3,
  });
  batch.forEach((r) => {
    const len = (r.text ?? r.markdown ?? "").length;
    console.log(
      `    ${r.success ? "✓" : "✗"} ${r.url}  (${len} bytes${r.error ? ` — ${r.error}` : ""})`,
    );
  });
  const succeeded = batch.filter((r) => r.success).length;
  if (succeeded < batchUrls.length) {
    console.warn(
      `    ⚠ ${batchUrls.length - succeeded}/${batchUrls.length} URLs failed (acceptable for live test)`,
    );
  }
  if (succeeded === 0) {
    console.error("    ✗ batch had zero successes — failing.");
    process.exit(1);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("All Trafilatura tests passed.");
  console.log(`${"═".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("\n✗ Fatal error:", err);
  process.exit(1);
});
