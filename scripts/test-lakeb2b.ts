/**
 * End-to-end test for the LakeB2B mock integration.
 * Tests: criteria translation → mock search → LLM verification → tool execute
 *
 * Run: DATABASE_URL=postgres://... pnpm exec tsx scripts/test-lakeb2b.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { createRequire } from "module";

// Stub `server-only` so the tsx runner doesn't throw — these modules are
// only called in a Node.js server context (same as the Next.js runtime).
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
    // Return a path to the vitest mock (empty module)
    return resolve(process.cwd(), "src/__tests__/__mocks__/server-only.ts");
  }
  return _origResolve(request, parent, isMain, options);
};

// Load env before anything else
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

// Confirm mock mode
const isMock =
  process.env.LAKEB2B_MOCK === "true" || !process.env.LAKEB2B_API_URL;
console.log(
  `\n🧪 LakeB2B integration test (mode: ${isMock ? "MOCK" : "LIVE"})\n`,
);
console.log(
  `  OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? "set ✓" : "MISSING ✗"}`,
);
console.log(`  LAKEB2B_MOCK: ${process.env.LAKEB2B_MOCK ?? "(unset)"}\n`);

async function run() {
  // Dynamic imports after env is loaded
  const { getLakeB2BClient } = await import("../src/lib/lakeb2b/client");
  const { translateCompanyCriteria, translatePeopleCriteria } =
    await import("../src/lib/lakeb2b/criteria");
  const { verifyCompanies, verifyPeople } =
    await import("../src/lib/lakeb2b/verifier");

  const testPrompts = [
    {
      label: "Test 1 — SaaS seed companies in US with 10-100 employees",
      criteria:
        "SaaS companies in the US with 10-100 employees that raised seed funding",
      type: "company" as const,
    },
    {
      label: "Test 2 — Fintech startups in New York",
      criteria: "fintech startups in New York",
      type: "company" as const,
    },
    {
      label: "Test 3 — Series B companies with 100-300 employees",
      criteria: "Series B companies with 100-300 employees",
      type: "company" as const,
    },
  ];

  const client = await getLakeB2BClient();

  for (const test of testPrompts) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`${test.label}`);
    console.log(`${"─".repeat(60)}`);

    // Step 1: translate criteria
    console.log("\n[1] Translating criteria → query params...");
    let params: Awaited<ReturnType<typeof translateCompanyCriteria>>;
    try {
      params = await translateCompanyCriteria(test.criteria);
      console.log(
        "    Query params:",
        JSON.stringify(params, null, 2)
          .split("\n")
          .map((l) => "    " + l)
          .join("\n"),
      );
    } catch (err) {
      console.error(
        "    ✗ Criteria translation failed:",
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    // Step 2: search
    console.log("\n[2] Searching mock database...");
    let searchResult: Awaited<ReturnType<typeof client.searchCompanies>>;
    try {
      searchResult = await client.searchCompanies({ ...params, per_page: 20 });
      console.log(
        `    Found ${searchResult.results.length} results (total: ${searchResult.total})`,
      );
      searchResult.results.forEach((c) => {
        console.log(
          `    - ${c.name} | ${c.industry} | ${c.employee_count} emp | ${c.funding_stage}`,
        );
      });
    } catch (err) {
      console.error(
        "    ✗ Search failed:",
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    if (searchResult.results.length === 0) {
      console.log("    ⚠ No results — skipping verification");
      continue;
    }

    // Step 3: verify
    console.log(
      `\n[3] Verifying ${searchResult.results.length} candidates with LLM...`,
    );
    let verified: Awaited<ReturnType<typeof verifyCompanies>>;
    try {
      verified = await verifyCompanies(searchResult.results, test.criteria);
      const passing = verified.filter((c) => c.passes);
      const failing = verified.filter((c) => !c.passes);
      console.log(
        `    ✓ ${passing.length} passed  ✗ ${failing.length} skipped`,
      );
      passing.forEach((c) => {
        console.log(`    ✓ ${c.name} — ${c.reason}`);
      });
      if (failing.length > 0) {
        console.log("    Skipped:");
        failing.forEach((c) => {
          console.log(`    ✗ ${c.name} — ${c.reason}`);
        });
      }
    } catch (err) {
      console.error(
        "    ✗ Verification failed:",
        err instanceof Error ? err.message : err,
      );
      continue;
    }
  }

  // Test 4: people search
  console.log(`\n${"─".repeat(60)}`);
  console.log("Test 4 — People search");
  console.log(`${"─".repeat(60)}`);
  const peopleCriteria = "CEO or VP at AI or SaaS companies in San Francisco";
  console.log(`\nCriteria: "${peopleCriteria}"`);

  console.log("\n[1] Translating people criteria...");
  let peopleParams: Awaited<ReturnType<typeof translatePeopleCriteria>>;
  try {
    peopleParams = await translatePeopleCriteria(peopleCriteria);
    console.log("    Params:", JSON.stringify(peopleParams));
  } catch (err) {
    console.error(
      "    ✗ Translation failed:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  console.log("\n[2] Searching people...");
  try {
    const peopleResult = await client.searchPeople({
      ...peopleParams,
      per_page: 10,
    });
    console.log(`    Found ${peopleResult.results.length} people`);
    peopleResult.results.forEach((p) => {
      console.log(`    - ${p.full_name} | ${p.title} @ ${p.company_name}`);
    });

    if (peopleResult.results.length > 0) {
      console.log("\n[3] Verifying people...");
      const verifiedPeople = await verifyPeople(
        peopleResult.results,
        peopleCriteria,
      );
      const passing = verifiedPeople.filter((p) => p.passes);
      console.log(
        `    ✓ ${passing.length}/${verifiedPeople.length} passed verification`,
      );
      passing.forEach((p) => console.log(`    ✓ ${p.full_name}: ${p.reason}`));
    }
  } catch (err) {
    console.error(
      "    ✗ People search failed:",
      err instanceof Error ? err.message : err,
    );
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("All tests complete.");
  console.log(`${"═".repeat(60)}\n`);
}

run().catch((err) => {
  console.error("\n✗ Fatal error:", err);
  process.exit(1);
});
