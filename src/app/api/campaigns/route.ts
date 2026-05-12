import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

export async function GET() {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaigns = await sdb.raw
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      status: schema.campaigns.status,
      createdAt: schema.campaigns.createdAt,
      updatedAt: schema.campaigns.updatedAt,
    })
    .from(schema.campaigns)
    .where(sdb.scope(schema.campaigns))
    .orderBy(desc(schema.campaigns.updatedAt));

  return NextResponse.json(campaigns);
}
