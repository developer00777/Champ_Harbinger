/**
 * Live smoke test for the GitHub engineering-momentum signals service.
 *
 * Run: pnpm exec tsx scripts/test-github-signals.ts
 * Optionally: GITHUB_TOKEN=... pnpm exec tsx scripts/test-github-signals.ts
 *
 * Hits the public GitHub REST API against well-known repos (vercel /
 * vercel/next.js) and asserts each call returns non-zero results. Prints a
 * short summary per call.
 */
import { config } from "dotenv";
import { resolve } from "path";
import { createRequire } from "module";

// Stub `server-only` so tsx can import our service modules outside Next.js.
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

console.log(
  `\nGitHub signals smoke test  (auth: ${process.env.GITHUB_TOKEN ? "token ✓" : "unauthenticated — 60 rpm"})\n`,
);

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];
function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name} — ${detail}`);
}

async function run() {
  const {
    getCompanyOrgStats,
    getCommitVelocity,
    getReleaseCadence,
    getStargazerTrend,
  } = await import("../src/lib/services/github-signals");

  // 1. Org stats
  console.log("[1] getCompanyOrgStats('vercel')");
  try {
    const stats = await getCompanyOrgStats("vercel");
    const ok =
      stats.publicRepos > 0 &&
      stats.topRepos.length > 0 &&
      Object.keys(stats.topLanguages).length > 0;
    record(
      "org stats",
      ok,
      `publicRepos=${stats.publicRepos} topRepos=${stats.topRepos.length} stars(sampled)=${stats.totalStars} langs=${Object.keys(stats.topLanguages).join(",")}`,
    );
  } catch (err) {
    record(
      "org stats",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 2. Commit velocity
  console.log("\n[2] getCommitVelocity('vercel', 'next.js')");
  try {
    const velocity = await getCommitVelocity("vercel", "next.js");
    const ok = velocity.totalCommits > 0 && velocity.uniqueAuthors > 0;
    record(
      "commit velocity",
      ok,
      `commits=${velocity.totalCommits} authors=${velocity.uniqueAuthors} weeks=${velocity.commitsByWeek.length}`,
    );
  } catch (err) {
    record(
      "commit velocity",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 3. Release cadence
  console.log("\n[3] getReleaseCadence('vercel', 'next.js')");
  try {
    const cadence = await getReleaseCadence("vercel", "next.js");
    const ok = cadence.totalReleases > 0 && cadence.latest !== null;
    record(
      "release cadence",
      ok,
      `releases=${cadence.totalReleases} months=${cadence.releasesPerMonth.length} latest=${cadence.latest?.name ?? "none"}`,
    );
  } catch (err) {
    record(
      "release cadence",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 4. Stargazer trend
  // Note: GitHub caps the stargazers endpoint at 400 pages (40k stars), so
  // for very popular repos (next.js has ~140k stars) the most recent stars
  // are not accessible. We pick a smaller Vercel repo (`swr`, ~32k stars)
  // where the recent-window walk is meaningful.
  console.log("\n[4] getStargazerTrend('vercel', 'swr', 30)");
  try {
    const trend = await getStargazerTrend("vercel", "swr", 30);
    const ok = trend.delta > 0;
    record(
      "star trend",
      ok,
      `delta=${trend.delta} weeks=${trend.dailyByWeek.length}`,
    );
  } catch (err) {
    record(
      "star trend",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  console.log(`\n${"═".repeat(60)}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log(`All ${results.length} checks passed.`);
  } else {
    console.log(`${failed.length}/${results.length} checks FAILED:`);
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
  }
  console.log(`${"═".repeat(60)}\n`);

  process.exit(failed.length === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("\nFatal:", err);
  process.exit(1);
});
