import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq, inArray, sql, count } from "drizzle-orm";

export async function GET(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "30d";

  // Calculate date filter for time-series
  let days = 30;
  if (range === "7d") days = 7;

  // Fetch all campaigns for this user first (needed to scope junction tables)
  const userCampaigns = await adminDb
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      status: schema.campaigns.status,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.clerkUserId, userId));

  const campaignIds = userCampaigns.map((c) => c.id);

  if (campaignIds.length === 0) {
    return Response.json({
      totals: { leads: 0, sent: 0, opened: 0, replied: 0, bounced: 0 },
      timeSeries: [],
      campaigns: [],
    });
  }

  const dateThreshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Fetch campaign_people and outreach_events scoped via campaign IDs
  const [allPeople, timeSeriesRows] = await Promise.all([
    adminDb
      .select({
        campaignId: schema.campaignPeople.campaignId,
        outreachStatus: schema.campaignPeople.outreachStatus,
      })
      .from(schema.campaignPeople)
      .where(inArray(schema.campaignPeople.campaignId, campaignIds)),

    adminDb
      .select({
        date: sql<string>`date_trunc('day', ${schema.outreachEvents.createdAt})::date::text`,
        status: schema.outreachEvents.status,
        cnt: count(),
      })
      .from(schema.outreachEvents)
      .where(inArray(schema.outreachEvents.campaignId, campaignIds))
      .groupBy(
        sql`date_trunc('day', ${schema.outreachEvents.createdAt})::date`,
        schema.outreachEvents.status,
      )
      .orderBy(
        sql`date_trunc('day', ${schema.outreachEvents.createdAt})::date`,
      ),
  ]);

  // Compute totals and per-campaign stats from campaignPeople rows
  let totalLeads = 0;
  let totalSent = 0;
  let totalOpened = 0;
  let totalReplied = 0;
  let totalBounced = 0;
  const campaignMap = new Map<
    string,
    { leads: number; sent: number; opened: number; replied: number }
  >();

  for (const row of allPeople) {
    totalLeads++;
    const stats = campaignMap.get(row.campaignId) ?? {
      leads: 0,
      sent: 0,
      opened: 0,
      replied: 0,
    };
    stats.leads++;
    if (["sent", "opened", "replied"].includes(row.outreachStatus)) {
      totalSent++;
      stats.sent++;
    }
    if (["opened", "replied"].includes(row.outreachStatus)) {
      totalOpened++;
      stats.opened++;
    }
    if (row.outreachStatus === "replied") {
      totalReplied++;
      stats.replied++;
    }
    if (row.outreachStatus === "bounced") totalBounced++;
    campaignMap.set(row.campaignId, stats);
  }

  const totals = {
    leads: totalLeads,
    sent: totalSent,
    opened: totalOpened,
    replied: totalReplied,
    bounced: totalBounced,
  };

  // Process time-series: DB has already grouped by day + status
  const cutoffDateStr = dateThreshold.toISOString().slice(0, 10);
  const eventsByDay = new Map<string, Record<string, number>>();
  for (const row of timeSeriesRows) {
    if (row.date < cutoffDateStr) continue;
    if (!eventsByDay.has(row.date)) {
      eventsByDay.set(row.date, { sent: 0, opened: 0, replied: 0, bounced: 0 });
    }
    const bucket = eventsByDay.get(row.date)!;
    const s = row.status;
    if (s in bucket) {
      bucket[s] = (bucket[s] ?? 0) + Number(row.cnt);
    }
  }
  const timeSeries = Array.from(eventsByDay.entries())
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const campaigns = userCampaigns
    .map((c) => {
      const stats = campaignMap.get(c.id) ?? {
        leads: 0,
        sent: 0,
        opened: 0,
        replied: 0,
      };
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        leads: stats.leads,
        sent: stats.sent,
        opened: stats.opened,
        openRate:
          stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0,
        replied: stats.replied,
        replyRate:
          stats.sent > 0 ? Math.round((stats.replied / stats.sent) * 100) : 0,
      };
    })
    .sort((a, b) => b.replyRate - a.replyRate);

  return Response.json({ totals, timeSeries, campaigns });
}
