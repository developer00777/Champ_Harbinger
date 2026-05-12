import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

/**
 * PATCH /api/tracking/configs/[id]
 * Updates a tracking config. Currently supports toggling status (active/paused).
 *
 * Body: { status: "active" | "paused" }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { status?: "active" | "paused" };

  if (!body.status || !["active", "paused"].includes(body.status)) {
    return NextResponse.json(
      { error: "status must be 'active' or 'paused'" },
      { status: 400 },
    );
  }

  // Verify the config belongs to a campaign owned by this user
  const [config] = await sdb.raw
    .select({ campaignId: schema.trackingConfigs.campaignId })
    .from(schema.trackingConfigs)
    .where(eq(schema.trackingConfigs.id, id))
    .limit(1);

  if (!config) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [campaign] = await sdb.raw
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.id, config.campaignId),
        sdb.scope(schema.campaigns),
      ),
    )
    .limit(1);

  if (!campaign) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await sdb.raw
    .update(schema.trackingConfigs)
    .set({ status: body.status })
    .where(eq(schema.trackingConfigs.id, id));

  return NextResponse.json({ ok: true });
}
