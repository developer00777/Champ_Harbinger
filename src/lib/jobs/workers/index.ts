import {
  getBoss,
  TRACKING_DISPATCH,
  TRACKING_RUN,
  OUTREACH_FOLLOWUPS,
  ENRICH_COMPANY,
  type EnrichCompanyJob,
} from "@/lib/jobs/boss";
import { dispatchDueTrackingConfigs } from "@/lib/jobs/handlers/dispatch-tracking";
import { getAppBaseUrl, workerHeaders } from "@/lib/jobs/internal-auth";

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

  await boss.schedule(TRACKING_DISPATCH, dispatchCron);
  await boss.schedule(OUTREACH_FOLLOWUPS, followupsCron);

  await boss.work(TRACKING_DISPATCH, async () => {
    const result = await dispatchDueTrackingConfigs();
    if (result.dispatched > 0) {
      console.log(
        `[worker] dispatched ${result.dispatched}/${result.total} tracking runs`,
      );
    }
  });

  await boss.work(TRACKING_RUN, async (jobs) => {
    for (const job of jobs) {
      const { trackingConfigId } = job.data as { trackingConfigId: string };
      await postInternal("/api/tracking/run", { trackingConfigId });
    }
  });

  await boss.work(OUTREACH_FOLLOWUPS, async () => {
    await postInternal("/api/outreach/process", { type: "followups" });
  });

  // Bulk enrichment: process up to 5 companies concurrently per poll so a
  // 50-company campaign finishes in ~1-2 min instead of serially.
  await boss.work(ENRICH_COMPANY, { batchSize: 5 }, async (jobs) => {
    await Promise.allSettled(
      jobs.map((job) => {
        const { companyId, campaignId, userId } = job.data as EnrichCompanyJob;
        return postInternal("/api/enrich-company", {
          companyId,
          campaignId,
          userId,
        });
      }),
    );
  });

  console.log(
    `[worker] ready — dispatch:"${dispatchCron}" followups:"${followupsCron}"`,
  );
}
