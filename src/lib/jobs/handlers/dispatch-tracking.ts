import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq, lte, and } from "drizzle-orm";
import { getScheduleIntervalMs } from "@/lib/types/tracking";
import { enqueueTrackingRun } from "@/lib/jobs/boss";

/**
 * Find every active tracking config whose next run is due, advance its
 * next_run_at, and enqueue a tracking-run job. Extracted from the old
 * /api/tracking/dispatch route so the scheduler can call it in-process.
 *
 * next_run_at is advanced BEFORE enqueueing so an overlapping scheduler tick
 * can't double-dispatch the same config.
 */
export async function dispatchDueTrackingConfigs(): Promise<{
  dispatched: number;
  total: number;
}> {
  const configs = await adminDb
    .select({
      id: schema.trackingConfigs.id,
      schedule: schema.trackingConfigs.schedule,
      customIntervalMinutes: schema.trackingConfigs.customIntervalMinutes,
      // Owner — so the worker can fairly schedule + budget-gate per user.
      clerkUserId: schema.campaigns.clerkUserId,
    })
    .from(schema.trackingConfigs)
    .innerJoin(
      schema.campaigns,
      eq(schema.trackingConfigs.campaignId, schema.campaigns.id),
    )
    .where(
      and(
        eq(schema.trackingConfigs.status, "active"),
        lte(schema.trackingConfigs.nextRunAt, new Date()),
      ),
    );

  if (configs.length === 0) return { dispatched: 0, total: 0 };

  let dispatched = 0;
  for (const config of configs) {
    try {
      const interval = getScheduleIntervalMs(
        config.schedule,
        config.customIntervalMinutes,
      );
      await adminDb
        .update(schema.trackingConfigs)
        .set({ nextRunAt: new Date(Date.now() + interval) })
        .where(eq(schema.trackingConfigs.id, config.id));

      await enqueueTrackingRun(config.id, config.clerkUserId ?? undefined);
      dispatched++;
    } catch (err) {
      console.error("[tracking/dispatch] failed for", config.id, err);
    }
  }

  return { dispatched, total: configs.length };
}
