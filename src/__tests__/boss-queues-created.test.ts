import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression cover for: adding a pg-boss queue and registering a worker for it
 * without adding it to the createQueue list in getBoss().
 *
 * pg-boss v12 does NOT auto-create queues. `boss.work()` on an unknown queue
 * does not fail loudly at startup — it logs
 *   "Queue quick-start-discover does not exist"
 * on a loop while the worker otherwise looks healthy, and jobs sit unprocessed
 * forever. That is a very quiet way to lose a feature, so assert it statically.
 */

const root = join(__dirname, "..", "..");
const boss = readFileSync(join(root, "src/lib/jobs/boss.ts"), "utf8");
const workers = readFileSync(
  join(root, "src/lib/jobs/workers/index.ts"),
  "utf8",
);

/** Queue-name constants exported from boss.ts, e.g. `export const FOO = "foo";` */
function exportedQueueConstants(): string[] {
  return [...boss.matchAll(/export const ([A-Z][A-Z0-9_]*) = "[a-z0-9-]+";/g)]
    .map((m) => m[1])
    .filter((name) => name !== "BOSS_FETCH_BATCH");
}

/** Constants passed to createQueue() via the `for (const queue of [...])` list. */
function createdQueues(): string[] {
  const m = boss.match(/for \(const queue of \[([\s\S]*?)\]\)/);
  if (!m) return [];
  return [...m[1].matchAll(/([A-Z][A-Z0-9_]*)\s*,/g)].map((x) => x[1]);
}

describe("every pg-boss queue is created before it is worked", () => {
  it("finds the createQueue list", () => {
    expect(createdQueues().length).toBeGreaterThan(0);
  });

  it("every queue a worker registers for is in the createQueue list", () => {
    const created = new Set(createdQueues());
    const worked = exportedQueueConstants().filter((name) =>
      new RegExp(`boss\\.work\\(\\s*${name}\\b`).test(workers),
    );

    expect(worked.length).toBeGreaterThan(0);
    const missing = worked.filter((n) => !created.has(n));
    expect(
      missing,
      `these queues have a boss.work() handler but are never createQueue()'d, ` +
        `so pg-boss v12 will log "Queue ... does not exist" forever: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("QUICK_START_DISCOVER specifically is created (it regressed once)", () => {
    expect(createdQueues()).toContain("QUICK_START_DISCOVER");
  });
});
