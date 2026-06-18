import {
  getBoss,
  TRACKING_DISPATCH,
  TRACKING_RUN,
  OUTREACH_FOLLOWUPS,
  ENRICH_COMPANY,
  MAILBOX_SYNC,
  type EnrichCompanyJob,
} from "@/lib/jobs/boss";
import { dispatchDueTrackingConfigs } from "@/lib/jobs/handlers/dispatch-tracking";
import { syncMailboxes } from "@/lib/jobs/handlers/sync-mailboxes";
import { getAppBaseUrl, workerHeaders } from "@/lib/jobs/internal-auth";
import { createFairDispatcher } from "@/lib/jobs/fair-dispatcher";
import { assertWithinBudget, BudgetExceededError } from "@/lib/budget/guard";

async function postInternal(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${getAppBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...workerHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `${path} ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
}

const UNKNOWN_USER = "__unknown__";

type HeavyJob =
  | { kind: "enrich"; userId: string; companyId: string; campaignId: string }
  | { kind: "tracking"; userId: string; trackingConfigId: string };

const FAIR_PER_USER_MAX = Number(process.env.FAIR_PER_USER_MAX) || 3;
const FAIR_GLOBAL_MAX = Number(process.env.FAIR_GLOBAL_MAX) || 8;
const BOSS_FETCH_BATCH = Number(process.env.BOSS_FETCH_BATCH) || 20;

/**
 * One fair scheduler shared by every heavy job type: each user runs at most
 * FAIR_PER_USER_MAX jobs at once, total bounded by FAIR_GLOBAL_MAX, served
 * round-robin so no user's bulk run starves another. pg-boss is the durable
 * inbox; this decides execution order in the worker process.
 */
const heavyDispatcher = createFairDispatcher<HeavyJob>({
  perUserMax: FAIR_PER_USER_MAX,
  globalMax: FAIR_GLOBAL_MAX,
  userIdOf: (j) => j.userId,
  run: async (j) => {
    if (j.kind === "enrich") {
      await postInternal("/api/enrich-company", {
        companyId: j.companyId,
        campaignId: j.campaignId,
        userId: j.userId,
      });
    } else {
      await postInternal("/api/tracking/run", {
        trackingConfigId: j.trackingConfigId,
        clerkUserId: j.userId === UNKNOWN_USER ? undefined : j.userId,
      });
    }
  },
});

/**
 * Budget-gate, then fairly dispatch one heavy job. If the owner is over their
 * weekly hard cap, skip it (hard stop — not retried). The bulk-intake gate
 * already blocks new over-budget runs; the user re-triggers once budget resets.
 */
async function dispatchHeavy(job: HeavyJob): Promise<void> {
  if (job.userId && job.userId !== UNKNOWN_USER) {
    try {
      await assertWithinBudget({ userId: job.userId });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        console.warn(
          `[worker] budget stop — skipped ${job.kind} for ${job.userId}: ${err.message}`,
        );
        return;
      }
      throw err;
    }
  }
  await heavyDispatcher.submit(job);
}

/**
 * Register the schedules + job handlers on the shared pg-boss instance. Runs in
 * the standalone worker process (scripts/run-worker.ts). The cron tick replaces
 * the external QStash cron; run handlers trigger the existing app routes over
 * HTTP (authenticated with WORKER_SECRET) so the route logic stays in one place.
 */
export async function startWorkers(): Promise<void> {
  const boss = await getBoss();

  const dispatchCron = process.env.TRACKING_DISPATCH_CRON || "*/5 * * * *";
  const followupsCron = process.env.OUTREACH_FOLLOWUPS_CRON || "*/15 * * * *";

  const mailboxSyncCron = process.env.MAILBOX_SYNC_CRON || "*/3 * * * *";

  await boss.schedule(TRACKING_DISPATCH, dispatchCron);
  await boss.schedule(OUTREACH_FOLLOWUPS, followupsCron);
  await boss.schedule(MAILBOX_SYNC, mailboxSyncCron);

  await boss.work(TRACKING_DISPATCH, async () => {
    const result = await dispatchDueTrackingConfigs();
    if (result.dispatched > 0) {
      console.log(
        `[worker] dispatched ${result.dispatched}/${result.total} tracking runs`,
      );
    }
  });

  await boss.work(TRACKING_RUN, { batchSize: BOSS_FETCH_BATCH }, async (jobs) => {
    await Promise.allSettled(
      jobs.map((job) => {
        const { trackingConfigId, clerkUserId } = job.data as {
          trackingConfigId: string;
          clerkUserId?: string;
        };
        return dispatchHeavy({
          kind: "tracking",
          userId: clerkUserId ?? UNKNOWN_USER,
          trackingConfigId,
        });
      }),
    );
  });

  await boss.work(OUTREACH_FOLLOWUPS, async () => {
    await postInternal("/api/outreach/process", { type: "followups" });
  });

  // Bulk enrichment: fetch a batch and run it through the fair dispatcher
  // (per-user cap + round-robin) so one user's "Enrich all" can't monopolize
  // the worker or the shared OpenRouter key.
  await boss.work(
    ENRICH_COMPANY,
    { batchSize: BOSS_FETCH_BATCH },
    async (jobs) => {
      const results = await Promise.allSettled(
        jobs.map((job) => {
          const { companyId, campaignId, userId } =
            job.data as EnrichCompanyJob;
          return dispatchHeavy({
            kind: "enrich",
            userId,
            companyId,
            campaignId,
          });
        }),
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length) {
        console.error(
          `[worker] enrich: ${failures.length}/${jobs.length} failed:`,
          failures
            .slice(0, 3)
            .map((f) => (f as PromiseRejectedResult).reason?.message),
        );
      }
    },
  );

  await boss.work(MAILBOX_SYNC, async () => {
    const r = await syncMailboxes();
    if (r.synced > 0 || r.replies > 0) {
      console.log(
        `[worker] mailbox sync: ${r.synced} new, ${r.replies} replies`,
      );
    }
  });

  console.log(
    `[worker] ready — dispatch:"${dispatchCron}" followups:"${followupsCron}" mailbox:"${mailboxSyncCron}"`,
  );
}
