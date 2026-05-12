import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

// GET /api/campaign-signals?campaignId=<id>
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json({ error: "Missing campaignId" }, { status: 400 });
  }

  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify campaign ownership first
  const campaign = await sdb.raw
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(eq(schema.campaigns.id, campaignId), sdb.scope(schema.campaigns)),
    )
    .limit(1);

  if (!campaign[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await sdb.raw
    .select({
      signalId: schema.campaignSignals.signalId,
      enabled: schema.campaignSignals.enabled,
    })
    .from(schema.campaignSignals)
    .where(eq(schema.campaignSignals.campaignId, campaignId));

  return NextResponse.json(rows);
}

// POST /api/campaign-signals — upsert a toggle
export async function POST(request: Request) {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    campaign_id: string;
    signal_id: string;
    enabled: boolean;
  };

  if (!body.campaign_id || !body.signal_id || body.enabled === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Verify campaign ownership
  const campaign = await sdb.raw
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.id, body.campaign_id),
        sdb.scope(schema.campaigns),
      ),
    )
    .limit(1);

  if (!campaign[0]) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  await sdb.raw
    .insert(schema.campaignSignals)
    .values({
      campaignId: body.campaign_id,
      signalId: body.signal_id,
      enabled: body.enabled,
    })
    .onConflictDoUpdate({
      target: [
        schema.campaignSignals.campaignId,
        schema.campaignSignals.signalId,
      ],
      set: { enabled: body.enabled },
    });

  return NextResponse.json({ ok: true });
}
