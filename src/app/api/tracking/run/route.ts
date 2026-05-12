import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq, desc } from "drizzle-orm";
import { verifyQStashSignature, getBaseUrl } from "@/lib/services/qstash";
import { withAction } from "@/lib/services/cost-tracker";
import { executeSignal } from "@/lib/signals/executor";
import type { Signal } from "@/lib/types/signal";
import {
  normalizeHiringData,
  hashSnapshot,
  diffHiringSnapshots,
  classifyNewRoles,
  describeHiringChanges,
} from "@/lib/services/tracking-differ";
import { evaluateIntent } from "@/lib/services/intent-evaluator";
import type {
  HiringSnapshot,
  TrackingConfig,
  Schedule,
  TrackingStatus,
} from "@/lib/types/tracking";

export const maxDuration = 120;

interface RunPayload {
  trackingConfigId: string;
}

export async function POST(request: Request) {
  // Verify QStash signature
  let payload: RunPayload;
  try {
    payload = await verifyQStashSignature<RunPayload>(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    return Response.json({ error: msg }, { status: 401 });
  }

  const { trackingConfigId } = payload;

  // Load tracking config with joins
  const [configRow] = await adminDb
    .select({
      id: schema.trackingConfigs.id,
      campaignId: schema.trackingConfigs.campaignId,
      organizationId: schema.trackingConfigs.organizationId,
      personId: schema.trackingConfigs.personId,
      signalId: schema.trackingConfigs.signalId,
      schedule: schema.trackingConfigs.schedule,
      intent: schema.trackingConfigs.intent,
      status: schema.trackingConfigs.status,
      lastRunAt: schema.trackingConfigs.lastRunAt,
      nextRunAt: schema.trackingConfigs.nextRunAt,
      // Campaign fields
      campaignIcp: schema.campaigns.icp,
      campaignOffering: schema.campaigns.offering,
      // Organization fields
      orgName: schema.organizations.name,
      orgDomain: schema.organizations.domain,
      orgIndustry: schema.organizations.industry,
      orgLocation: schema.organizations.location,
      orgDescription: schema.organizations.description,
      orgUrl: schema.organizations.url,
      // Signal fields
      signalSlug: schema.signals.slug,
      signalName: schema.signals.name,
      signalCategory: schema.signals.category,
      signalExecutionType: schema.signals.executionType,
      signalToolKey: schema.signals.toolKey,
      signalConfig: schema.signals.config,
      signalIsBuiltin: schema.signals.isBuiltin,
      signalIsPublic: schema.signals.isPublic,
      signalDescription: schema.signals.description,
    })
    .from(schema.trackingConfigs)
    .innerJoin(
      schema.campaigns,
      eq(schema.trackingConfigs.campaignId, schema.campaigns.id),
    )
    .leftJoin(
      schema.organizations,
      eq(schema.trackingConfigs.organizationId, schema.organizations.id),
    )
    .innerJoin(
      schema.signals,
      eq(schema.trackingConfigs.signalId, schema.signals.id),
    )
    .where(eq(schema.trackingConfigs.id, trackingConfigId))
    .limit(1);

  if (!configRow) {
    return Response.json(
      { error: `Tracking config not found: ${trackingConfigId}` },
      { status: 404 },
    );
  }

  const orgName = configRow.orgName ?? "Unknown Company";
  const orgDomain = configRow.orgDomain ?? undefined;

  // Reconstruct the nested objects that the downstream code expects
  const typedConfig: TrackingConfig & {
    organization: Record<string, unknown> | null;
    signal: Record<string, unknown>;
    campaign: {
      icp: Record<string, unknown>;
      offering: Record<string, unknown>;
    };
  } = {
    id: configRow.id,
    campaign_id: configRow.campaignId,
    organization_id: configRow.organizationId ?? null,
    person_id: configRow.personId ?? null,
    signal_id: configRow.signalId,
    schedule: configRow.schedule as Schedule,
    intent: configRow.intent,
    status: configRow.status as TrackingStatus,
    last_run_at: configRow.lastRunAt?.toISOString() ?? null,
    next_run_at: configRow.nextRunAt?.toISOString() ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    organization: configRow.orgName
      ? {
          name: configRow.orgName,
          domain: configRow.orgDomain,
          industry: configRow.orgIndustry,
          location: configRow.orgLocation,
          description: configRow.orgDescription,
          url: configRow.orgUrl,
        }
      : null,
    signal: {
      id: configRow.signalId,
      slug: configRow.signalSlug,
      name: configRow.signalName,
      category: configRow.signalCategory,
      executionType: configRow.signalExecutionType,
      toolKey: configRow.signalToolKey,
      config: configRow.signalConfig,
      isBuiltin: configRow.signalIsBuiltin,
      isPublic: configRow.signalIsPublic,
      description: configRow.signalDescription,
    },
    campaign: {
      icp: (configRow.campaignIcp as Record<string, unknown>) ?? {},
      offering: (configRow.campaignOffering as Record<string, unknown>) ?? {},
    },
  };

  // Wrap in withAction for cost tracking
  return withAction(`Tracking run: ${orgName}`, async () => {
    // ── Execute signal via universal executor ────────────────────────
    const signalRecord = typedConfig.signal as unknown as Signal;
    let rawOutput: Record<string, unknown>;

    try {
      const signalOutput = await executeSignal(signalRecord, {
        organizationId: configRow.organizationId ?? undefined,
        domain: orgDomain,
        name: orgName,
        campaignId: configRow.campaignId,
        useAdmin: true,
      });

      rawOutput = signalOutput.data;

      // If the signal executor didn't find anything meaningful, still store the result
      if (!signalOutput.found && !rawOutput) {
        rawOutput = { found: false, summary: signalOutput.summary };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return Response.json(
        { trackingConfigId, error: `Buying-signal execution failed: ${msg}` },
        { status: 500 },
      );
    }

    // ── Normalize into snapshot ────────────────────────────────────────
    const jobs =
      (rawOutput.jobs as Array<{
        title: string;
        department?: string;
        location?: string;
        url?: string;
      }>) || [];
    const careersUrl = (rawOutput.careersUrl as string) || null;
    const snapshot = normalizeHiringData(jobs, careersUrl);
    const hash = hashSnapshot(snapshot);

    // ── Compare to previous snapshot ───────────────────────────────────
    const prevSnapshots = await adminDb
      .select({
        snapshotData: schema.trackingSnapshots.snapshotData,
        snapshotHash: schema.trackingSnapshots.snapshotHash,
      })
      .from(schema.trackingSnapshots)
      .where(eq(schema.trackingSnapshots.trackingConfigId, trackingConfigId))
      .orderBy(desc(schema.trackingSnapshots.capturedAt))
      .limit(1);

    const prevSnapshot = prevSnapshots[0] ?? null;
    const hasChanged = !prevSnapshot || prevSnapshot.snapshotHash !== hash;

    // ── Store new snapshot (always, for the timeline) ──────────────────
    await adminDb.insert(schema.trackingSnapshots).values({
      trackingConfigId,
      snapshotData: snapshot as unknown as Record<string, unknown>,
      snapshotHash: hash,
    });

    // ── Store signal_result with tracking_config_id ────────────────────
    await adminDb.insert(schema.signalResults).values({
      signalId: configRow.signalId,
      campaignId: configRow.campaignId,
      organizationId: configRow.organizationId ?? undefined,
      personId: configRow.personId ?? undefined,
      trackingConfigId,
      output: rawOutput,
      status: "success",
    });

    // ── Update last_run_at ─────────────────────────────────────────────
    await adminDb
      .update(schema.trackingConfigs)
      .set({ lastRunAt: new Date() })
      .where(eq(schema.trackingConfigs.id, trackingConfigId));

    if (!hasChanged) {
      return Response.json({
        trackingConfigId,
        changed: false,
        jobCount: snapshot.job_count,
      });
    }

    // ── Compute diff ───────────────────────────────────────────────────
    const prevData = prevSnapshot
      ? (prevSnapshot.snapshotData as unknown as HiringSnapshot)
      : null;

    // If no previous data (first run after baseline), store as baseline
    if (!prevData) {
      return Response.json({
        trackingConfigId,
        changed: false,
        baseline: true,
        jobCount: snapshot.job_count,
      });
    }

    const diff = diffHiringSnapshots(prevData, snapshot);

    // ── Classify new roles via Haiku ───────────────────────────────────
    if (diff.added_jobs.length > 0) {
      const icp = typedConfig.campaign.icp || {};
      const offering = typedConfig.campaign.offering || {};
      const icpContext = [
        icp.industry && `Industry: ${icp.industry}`,
        icp.targetTitles &&
          `Target titles: ${(icp.targetTitles as string[]).join(", ")}`,
        icp.painPoints &&
          `Pain points: ${(icp.painPoints as string[]).join(", ")}`,
        offering.description && `Offering: ${offering.description}`,
      ]
        .filter(Boolean)
        .join(". ");

      const classified = await classifyNewRoles(diff.added_jobs, icpContext);
      diff.classified_added = classified;
    }

    // ── Store tracking changes ─────────────────────────────────────────
    const changeDescription = describeHiringChanges(diff);

    const changesToInsert: Array<{
      trackingConfigId: string;
      changeType: string;
      fieldPath: string | null;
      previousValue: unknown;
      currentValue: unknown;
      description: string;
    }> = [];

    if (diff.added_jobs.length > 0) {
      changesToInsert.push({
        trackingConfigId,
        changeType: "added",
        fieldPath: "jobs",
        previousValue: null,
        currentValue: diff.added_jobs,
        description: `+${diff.added_jobs.length} role${diff.added_jobs.length > 1 ? "s" : ""}: ${diff.added_jobs.map((j) => j.title).join(", ")}`,
      });
    }

    if (diff.removed_jobs.length > 0) {
      changesToInsert.push({
        trackingConfigId,
        changeType: "removed",
        fieldPath: "jobs",
        previousValue: diff.removed_jobs,
        currentValue: null,
        description: `-${diff.removed_jobs.length} role${diff.removed_jobs.length > 1 ? "s" : ""}: ${diff.removed_jobs.map((j) => j.title).join(", ")}`,
      });
    }

    if (diff.job_count_delta !== 0 && changesToInsert.length === 0) {
      changesToInsert.push({
        trackingConfigId,
        changeType: "count_change",
        fieldPath: "job_count",
        previousValue: prevData.job_count,
        currentValue: snapshot.job_count,
        description: changeDescription,
      });
    }

    if (changesToInsert.length > 0) {
      await adminDb.insert(schema.trackingChanges).values(changesToInsert);
    }

    // ── Evaluate intent via LLM ────────────────────────────────────────
    const signal = typedConfig.signal as {
      name?: string;
      category?: string;
    } | null;
    const verdict = await evaluateIntent({
      intent: (typedConfig.intent as string) ?? "",
      signalName: signal?.name ?? "Unknown signal",
      signalCategory: signal?.category ?? "custom",
      snapshotSummary: changeDescription,
      rawDiff: diff,
      isFirstRun: false,
    });

    if (verdict.fire) {
      await adminDb.insert(schema.trackingChanges).values({
        trackingConfigId,
        changeType: "threshold_crossed",
        fieldPath: null,
        previousValue: null,
        currentValue: { confidence: verdict.confidence },
        description: verdict.reason,
      });

      if (configRow.organizationId) {
        await adminDb
          .update(schema.campaignOrganizations)
          .set({ readinessTag: "ready_to_contact" })
          .where(
            eq(schema.campaignOrganizations.campaignId, configRow.campaignId),
          );
        // Further filter by organizationId
        await adminDb
          .update(schema.campaignOrganizations)
          .set({ readinessTag: "ready_to_contact" })
          .where(
            eq(
              schema.campaignOrganizations.organizationId,
              configRow.organizationId,
            ),
          );
      } else if (configRow.personId) {
        await adminDb
          .update(schema.campaignPeople)
          .set({ readinessTag: "ready_to_contact" })
          .where(eq(schema.campaignPeople.campaignId, configRow.campaignId));
      }

      const outreachBaseUrl = getBaseUrl();
      void fetch(`${outreachBaseUrl}/api/outreach/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "signal",
          signalId: configRow.signalId,
          campaignId: configRow.campaignId,
          organizationId: configRow.organizationId ?? undefined,
          reason: verdict.reason,
          confidence: verdict.confidence,
        }),
      }).catch(() => {
        // Fire-and-forget -- don't block tracking response
      });
    }

    return Response.json({
      trackingConfigId,
      changed: true,
      diff: {
        addedCount: diff.added_jobs.length,
        removedCount: diff.removed_jobs.length,
        jobCountDelta: diff.job_count_delta,
        description: changeDescription,
      },
      intentFired: verdict.fire,
      reason: verdict.reason,
      confidence: verdict.confidence,
    });
  });
}
