import { NextResponse } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

/**
 * GET /api/tracking/changes?configId=<id>[&configId=<id>...]
 * Returns tracking changes for one or more config IDs, ordered newest-first.
 * Query params:
 *   configId — one value, or multiple (repeated param)
 *   limit    — defaults to 20, max 100
 */
export async function GET(request: Request) {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const configIds = searchParams.getAll("configId");
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 100);

  if (configIds.length === 0) {
    return NextResponse.json(
      { error: "At least one configId is required" },
      { status: 400 },
    );
  }

  const changes = await sdb.raw
    .select()
    .from(schema.trackingChanges)
    .where(inArray(schema.trackingChanges.trackingConfigId, configIds))
    .orderBy(desc(schema.trackingChanges.detectedAt))
    .limit(limit);

  return NextResponse.json(
    changes.map((c) => ({
      id: c.id,
      tracking_config_id: c.trackingConfigId,
      change_type: c.changeType,
      field_path: c.fieldPath,
      previous_value: c.previousValue,
      current_value: c.currentValue,
      description: c.description,
      detected_at: c.detectedAt.toISOString(),
    })),
  );
}
