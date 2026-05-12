import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

/**
 * GET /api/tracking-data?campaignId=<id>
 *
 * Returns tracking configs with joined org/signal data, readiness tags, and
 * the latest change per config — everything the /tracking page needs.
 */
export async function GET(request: Request) {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json(
      { error: "campaignId is required" },
      { status: 400 },
    );
  }

  // Ownership check: campaign must belong to current user.
  const [campaign] = await sdb.raw
    .select({ clerkUserId: schema.campaigns.clerkUserId })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);

  if (!campaign || campaign.clerkUserId !== sdb.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch tracking configs with org + signal joins
  const configs = await sdb.raw
    .select({
      id: schema.trackingConfigs.id,
      organizationId: schema.trackingConfigs.organizationId,
      schedule: schema.trackingConfigs.schedule,
      status: schema.trackingConfigs.status,
      lastRunAt: schema.trackingConfigs.lastRunAt,
      nextRunAt: schema.trackingConfigs.nextRunAt,
      orgName: schema.organizations.name,
      orgDomain: schema.organizations.domain,
      signalName: schema.signals.name,
      signalCategory: schema.signals.category,
    })
    .from(schema.trackingConfigs)
    .leftJoin(
      schema.organizations,
      eq(schema.trackingConfigs.organizationId, schema.organizations.id),
    )
    .leftJoin(
      schema.signals,
      eq(schema.trackingConfigs.signalId, schema.signals.id),
    )
    .where(eq(schema.trackingConfigs.campaignId, campaignId))
    .orderBy(desc(schema.trackingConfigs.createdAt));

  if (configs.length === 0) {
    return NextResponse.json([]);
  }

  // Collect org IDs and config IDs for parallel sub-queries
  const uniqueOrgIds = [
    ...new Set(
      configs
        .map((c) => c.organizationId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const configIds = configs.map((c) => c.id);

  // Fetch readiness tags + latest changes in parallel
  const [orgLinks, latestChanges] = await Promise.all([
    uniqueOrgIds.length > 0
      ? sdb.raw
          .select({
            organizationId: schema.campaignOrganizations.organizationId,
            readinessTag: schema.campaignOrganizations.readinessTag,
          })
          .from(schema.campaignOrganizations)
          .where(
            and(
              eq(schema.campaignOrganizations.campaignId, campaignId),
              inArray(
                schema.campaignOrganizations.organizationId,
                uniqueOrgIds,
              ),
            ),
          )
      : Promise.resolve(
          [] as Array<{
            organizationId: string;
            readinessTag: string | null;
          }>,
        ),
    sdb.raw
      .select({
        trackingConfigId: schema.trackingChanges.trackingConfigId,
        description: schema.trackingChanges.description,
        detectedAt: schema.trackingChanges.detectedAt,
      })
      .from(schema.trackingChanges)
      .where(inArray(schema.trackingChanges.trackingConfigId, configIds))
      .orderBy(desc(schema.trackingChanges.detectedAt)),
  ]);

  // Build lookup maps
  const readinessMap = new Map<string, string | null>();
  for (const link of orgLinks) {
    readinessMap.set(link.organizationId, link.readinessTag ?? null);
  }

  const changeMap = new Map<
    string,
    { description: string; detectedAt: string }
  >();
  for (const change of latestChanges) {
    if (!changeMap.has(change.trackingConfigId)) {
      changeMap.set(change.trackingConfigId, {
        description: change.description,
        detectedAt: change.detectedAt.toISOString(),
      });
    }
  }

  // Map to the shape the tracking page expects (TrackingRow)
  const rows = configs.map((c) => {
    const change = changeMap.get(c.id);
    const tag = c.organizationId ? readinessMap.get(c.organizationId) : null;

    return {
      id: c.id,
      organizationName: c.orgName || "Unknown",
      organizationDomain: c.orgDomain || null,
      signalName: c.signalName || "Unknown Signal",
      signalCategory: c.signalCategory || "",
      schedule: c.schedule,
      status: c.status,
      lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
      nextRunAt: c.nextRunAt ? c.nextRunAt.toISOString() : null,
      readinessTag: tag ?? null,
      latestChangeDescription: change?.description ?? null,
      latestChangeDate: change?.detectedAt ?? null,
    };
  });

  return NextResponse.json(rows);
}
