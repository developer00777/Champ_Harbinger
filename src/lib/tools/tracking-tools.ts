import { tool } from "ai";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";
import { SCHEDULE_INTERVALS } from "@/lib/types/tracking";
import type { Schedule } from "@/lib/types/tracking";
import { enqueueTrackingRun } from "@/lib/jobs/boss";

/**
 * Enqueue an immediate baseline run for a tracking config. Falls back to no-op
 * logging if the queue is unreachable so tool calls never fail on enqueue.
 */
async function dispatchImmediateRun(trackingConfigId: string): Promise<void> {
  try {
    await enqueueTrackingRun(trackingConfigId);
  } catch (err) {
    console.error("[tracking] Failed to enqueue baseline run:", err);
  }
}

export const createTracking = tool({
  description:
    "Start tracking a company or person with a specific signal on a recurring schedule. Runs the signal once immediately as a baseline snapshot, then schedules future runs. Use after discussing with the user what changes should flag them as ready to contact -- capture that as a plain-English intent string.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    organizationId: z
      .string()
      .uuid()
      .optional()
      .describe("Organization ID to track (provide this OR personId)"),
    personId: z
      .string()
      .uuid()
      .optional()
      .describe("Person ID to track (provide this OR organizationId)"),
    signalId: z.string().uuid().describe("Signal ID to run on schedule"),
    schedule: z
      .enum(["daily", "weekly", "biweekly", "monthly"])
      .default("weekly")
      .describe("How often to re-run the signal"),
    intent: z
      .string()
      .describe(
        "Plain-English description of what changes should flag the company/person as ready to contact.",
      ),
  }),
  execute: async (input) => {
    if (!input.organizationId && !input.personId) {
      throw new Error("Either organizationId or personId is required");
    }

    const sdb = await getScopedDb();
    const interval =
      SCHEDULE_INTERVALS[input.schedule as Schedule] ??
      SCHEDULE_INTERVALS.weekly;

    const [config] = await sdb.raw
      .insert(schema.trackingConfigs)
      .values({
        campaignId: input.campaignId,
        organizationId: input.organizationId ?? null,
        personId: input.personId ?? null,
        signalId: input.signalId,
        schedule: input.schedule,
        intent: input.intent,
        status: "active",
        nextRunAt: new Date(Date.now() + interval),
      })
      .returning();

    if (!config) throw new Error("Failed to create tracking config");

    // Set readiness_tag to 'monitoring' on the junction table
    if (input.organizationId) {
      await sdb.raw
        .update(schema.campaignOrganizations)
        .set({ readinessTag: "monitoring" })
        .where(
          and(
            eq(schema.campaignOrganizations.campaignId, input.campaignId),
            eq(
              schema.campaignOrganizations.organizationId,
              input.organizationId,
            ),
          ),
        );
    } else if (input.personId) {
      await sdb.raw
        .update(schema.campaignPeople)
        .set({ readinessTag: "monitoring" })
        .where(
          and(
            eq(schema.campaignPeople.campaignId, input.campaignId),
            eq(schema.campaignPeople.personId, input.personId),
          ),
        );
    }

    // Enqueue immediate baseline run on the pg-boss queue.
    await dispatchImmediateRun(config.id);

    return {
      trackingConfig: config,
      message: `Tracking created with baseline run dispatched. Signal will then run ${input.schedule}.`,
    };
  },
});

export const bulkCreateTracking = tool({
  description:
    "Enable tracking for all qualified organizations in a campaign with a shared signal and intent. Creates one tracking config per organization.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    signalId: z.string().uuid().describe("Signal ID to track"),
    schedule: z
      .enum(["daily", "weekly", "biweekly", "monthly"])
      .default("weekly"),
    intent: z
      .string()
      .describe(
        "Plain-English description of what changes should flag a company as ready to contact.",
      ),
    status: z
      .enum(["qualified", "discovered", "all"])
      .default("qualified")
      .describe("Only track organizations with this status"),
  }),
  execute: async (input) => {
    const sdb = await getScopedDb();

    // Get organizations in this campaign
    const orgsQuery = sdb.raw
      .select({ organizationId: schema.campaignOrganizations.organizationId })
      .from(schema.campaignOrganizations)
      .where(eq(schema.campaignOrganizations.campaignId, input.campaignId));

    const orgs =
      input.status !== "all"
        ? await sdb.raw
            .select({
              organizationId: schema.campaignOrganizations.organizationId,
            })
            .from(schema.campaignOrganizations)
            .where(
              and(
                eq(schema.campaignOrganizations.campaignId, input.campaignId),
                eq(schema.campaignOrganizations.status, input.status),
              ),
            )
        : await orgsQuery;

    if (orgs.length === 0) {
      return { created: 0, message: "No matching organizations found" };
    }

    // Check for existing tracking configs to avoid duplicates
    const existing = await sdb.raw
      .select({ organizationId: schema.trackingConfigs.organizationId })
      .from(schema.trackingConfigs)
      .where(
        and(
          eq(schema.trackingConfigs.campaignId, input.campaignId),
          eq(schema.trackingConfigs.signalId, input.signalId),
        ),
      );

    const existingOrgIds = new Set(existing.map((e) => e.organizationId));

    const interval =
      SCHEDULE_INTERVALS[input.schedule as Schedule] ??
      SCHEDULE_INTERVALS.weekly;
    const nextRun = new Date(Date.now() + interval);

    const toCreate = orgs
      .filter((o) => !existingOrgIds.has(o.organizationId))
      .map((o) => ({
        campaignId: input.campaignId,
        organizationId: o.organizationId,
        personId: null,
        signalId: input.signalId,
        schedule: input.schedule,
        intent: input.intent,
        status: "active",
        nextRunAt: nextRun,
      }));

    if (toCreate.length === 0) {
      return {
        created: 0,
        skipped: orgs.length,
        message:
          "All organizations already have tracking configs for this signal",
      };
    }

    const created = await sdb.raw
      .insert(schema.trackingConfigs)
      .values(toCreate)
      .returning({
        id: schema.trackingConfigs.id,
        organizationId: schema.trackingConfigs.organizationId,
      });

    // Set readiness_tag to 'monitoring' for all tracked orgs
    const orgIds = toCreate
      .map((c) => c.organizationId!)
      .filter(Boolean) as string[];
    if (orgIds.length > 0) {
      await sdb.raw
        .update(schema.campaignOrganizations)
        .set({ readinessTag: "monitoring" })
        .where(
          and(
            eq(schema.campaignOrganizations.campaignId, input.campaignId),
            inArray(schema.campaignOrganizations.organizationId, orgIds),
          ),
        );
    }

    // Dispatch baseline runs (max 5 concurrent)
    const configIds = created.map((c) => c.id);
    const batchSize = 5;
    for (let i = 0; i < configIds.length; i += batchSize) {
      const batch = configIds.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(dispatchImmediateRun));
    }

    return {
      created: toCreate.length,
      skipped: orgs.length - toCreate.length,
      message: `Created ${toCreate.length} tracking configs with baseline runs dispatched.`,
    };
  },
});

export const getTrackingConfigs = tool({
  description:
    "List tracking configs for a campaign with their latest change summary and readiness status.",
  inputSchema: z.object({
    campaignId: z.string().uuid().describe("Campaign ID"),
    status: z
      .enum(["active", "paused", "completed"])
      .optional()
      .describe("Filter by tracking status"),
  }),
  execute: async (input) => {
    const sdb = await getScopedDb();

    const whereClause = input.status
      ? and(
          eq(schema.trackingConfigs.campaignId, input.campaignId),
          eq(schema.trackingConfigs.status, input.status),
        )
      : eq(schema.trackingConfigs.campaignId, input.campaignId);

    const configs = await sdb.raw
      .select()
      .from(schema.trackingConfigs)
      .where(whereClause)
      .orderBy(desc(schema.trackingConfigs.createdAt));

    const configIds = configs.map((c) => c.id);

    const latestChanges =
      configIds.length > 0
        ? await sdb.raw
            .select({
              trackingConfigId: schema.trackingChanges.trackingConfigId,
              description: schema.trackingChanges.description,
              changeType: schema.trackingChanges.changeType,
              detectedAt: schema.trackingChanges.detectedAt,
            })
            .from(schema.trackingChanges)
            .where(inArray(schema.trackingChanges.trackingConfigId, configIds))
            .orderBy(desc(schema.trackingChanges.detectedAt))
        : [];

    const changeMap = new Map<string, (typeof latestChanges)[0]>();
    for (const change of latestChanges) {
      if (!changeMap.has(change.trackingConfigId)) {
        changeMap.set(change.trackingConfigId, change);
      }
    }

    const result = configs.map((c) => ({
      ...c,
      latestChange: changeMap.get(c.id) || null,
    }));

    return { configs: result };
  },
});

export const getTrackingHistory = tool({
  description:
    "Get the change history and snapshots for a tracking config. Use this to narrate trends over time.",
  inputSchema: z.object({
    trackingConfigId: z.string().uuid().describe("Tracking config ID"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Max number of changes to return"),
  }),
  execute: async (input) => {
    const sdb = await getScopedDb();

    const [changes, snapshots] = await Promise.all([
      sdb.raw
        .select()
        .from(schema.trackingChanges)
        .where(
          eq(schema.trackingChanges.trackingConfigId, input.trackingConfigId),
        )
        .orderBy(desc(schema.trackingChanges.detectedAt))
        .limit(input.limit),
      sdb.raw
        .select({
          snapshotData: schema.trackingSnapshots.snapshotData,
          capturedAt: schema.trackingSnapshots.capturedAt,
        })
        .from(schema.trackingSnapshots)
        .where(
          eq(schema.trackingSnapshots.trackingConfigId, input.trackingConfigId),
        )
        .orderBy(desc(schema.trackingSnapshots.capturedAt))
        .limit(input.limit),
    ]);

    return { changes, snapshots };
  },
});

export const updateTracking = tool({
  description:
    "Update a tracking config: change schedule, rewrite the intent, or pause/resume tracking.",
  inputSchema: z.object({
    trackingConfigId: z.string().uuid().describe("Tracking config ID"),
    schedule: z
      .enum(["daily", "weekly", "biweekly", "monthly"])
      .optional()
      .describe("New schedule"),
    intent: z.string().optional().describe("New plain-English intent"),
    status: z
      .enum(["active", "paused", "completed"])
      .optional()
      .describe("New status"),
  }),
  execute: async (input) => {
    const sdb = await getScopedDb();

    const updates: Partial<typeof schema.trackingConfigs.$inferInsert> = {};
    if (input.schedule) {
      updates.schedule = input.schedule;
      const interval =
        SCHEDULE_INTERVALS[input.schedule as Schedule] ??
        SCHEDULE_INTERVALS.weekly;
      updates.nextRunAt = new Date(Date.now() + interval);
    }
    if (input.intent !== undefined) updates.intent = input.intent;
    if (input.status) updates.status = input.status;

    if (Object.keys(updates).length === 0) {
      return { message: "Nothing to update" };
    }

    const [data] = await sdb.raw
      .update(schema.trackingConfigs)
      .set(updates)
      .where(eq(schema.trackingConfigs.id, input.trackingConfigId))
      .returning();

    if (!data) throw new Error("Tracking config not found");

    return {
      trackingConfig: data,
      message: `Tracking config updated.${input.status === "paused" ? " Tracking paused." : ""}${input.status === "active" ? " Tracking resumed." : ""}`,
    };
  },
});
