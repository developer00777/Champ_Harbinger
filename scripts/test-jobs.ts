/**
 * End-to-end test for the jobs-aggregator integration.
 * Hits real public job boards — no API keys required.
 *
 * Run: pnpm exec tsx scripts/test-jobs.ts
 */
import { resolve } from "path";
import { createRequire } from "module";

// Stub `server-only` so tsx doesn't throw when importing service modules.
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

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

async function run() {
  console.log("\n🧪 jobs-aggregator integration test\n");

  const {
    fetchGreenhouseJobs,
    fetchLeverJobs,
    fetchAshbyJobs,
    fetchJobsForCompany,
    detectATSFromCareersUrl,
  } = await import("../src/lib/services/jobs");

  // ─── Per-ATS smoke tests ───────────────────────────────────────────────
  console.log("─".repeat(60));
  console.log("Greenhouse: stripe");
  console.log("─".repeat(60));
  try {
    const jobs = await fetchGreenhouseJobs("stripe");
    console.log(`    Found ${jobs.length} jobs`);
    assert(jobs.length > 0, "Stripe Greenhouse returns non-empty");
    if (jobs[0]) {
      assert(jobs[0].ats === "greenhouse", "ats field is 'greenhouse'");
      assert(typeof jobs[0].id === "string", "id is string");
      assert(typeof jobs[0].title === "string", "title is string");
      assert(typeof jobs[0].url === "string", "url is string");
      console.log(`    Sample: ${jobs[0].title} @ ${jobs[0].location}`);
    }
  } catch (err) {
    console.error("    ✗ Greenhouse fetch failed:", err);
    failures++;
  }

  console.log("\n" + "─".repeat(60));
  console.log("Lever: palantir");
  console.log("─".repeat(60));
  try {
    const jobs = await fetchLeverJobs("palantir");
    console.log(`    Found ${jobs.length} jobs`);
    assert(jobs.length > 0, "Palantir Lever returns non-empty");
    if (jobs[0]) {
      assert(jobs[0].ats === "lever", "ats field is 'lever'");
      console.log(`    Sample: ${jobs[0].title} @ ${jobs[0].location}`);
    }
  } catch (err) {
    console.error("    ✗ Lever fetch failed:", err);
    failures++;
  }

  console.log("\n" + "─".repeat(60));
  console.log("Ashby: ashby (their own board)");
  console.log("─".repeat(60));
  try {
    const jobs = await fetchAshbyJobs("ashby");
    console.log(`    Found ${jobs.length} jobs`);
    assert(jobs.length > 0, "Ashby (self) returns non-empty");
    if (jobs[0]) {
      assert(jobs[0].ats === "ashby", "ats field is 'ashby'");
      console.log(`    Sample: ${jobs[0].title} @ ${jobs[0].location}`);
    }
  } catch (err) {
    console.error("    ✗ Ashby fetch failed:", err);
    failures++;
  }

  // ─── Unified fetcher ──────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("fetchJobsForCompany('stripe', 'all')");
  console.log("─".repeat(60));
  try {
    const jobs = await fetchJobsForCompany("stripe", "all");
    console.log(`    Combined total: ${jobs.length} jobs`);
    assert(jobs.length > 0, "Combined fetch returns non-empty for 'stripe'");
    const atsSet = new Set(jobs.map((j) => j.ats));
    console.log(`    ATS hit: ${[...atsSet].join(", ")}`);
  } catch (err) {
    console.error("    ✗ Combined fetch failed:", err);
    failures++;
  }

  // ─── URL detector ─────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("detectATSFromCareersUrl");
  console.log("─".repeat(60));
  assert(
    detectATSFromCareersUrl("https://boards.greenhouse.io/stripe") ===
      "greenhouse",
    "greenhouse boards URL → greenhouse",
  );
  assert(
    detectATSFromCareersUrl("https://jobs.lever.co/palantir") === "lever",
    "lever URL → lever",
  );
  assert(
    detectATSFromCareersUrl("https://jobs.ashbyhq.com/ashby") === "ashby",
    "ashby URL → ashby",
  );
  assert(
    detectATSFromCareersUrl("https://example.com/careers") === null,
    "unknown URL → null",
  );
  assert(
    detectATSFromCareersUrl("not a url") === null,
    "garbage input → null",
  );

  console.log("\n" + "═".repeat(60));
  if (failures === 0) {
    console.log(`All checks passed.`);
  } else {
    console.log(`${failures} check(s) failed.`);
  }
  console.log("═".repeat(60) + "\n");
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("\n✗ Fatal error:", err);
  process.exit(1);
});
