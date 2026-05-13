import { NextResponse } from "next/server";
import { desc, eq, and } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";
import { adminDb } from "@/lib/db/admin";
import { getCurrentUser } from "@/lib/auth";

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

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    name: string;
    icp?: string;
    config?: Record<string, unknown>;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const [campaign] = await adminDb
    .insert(schema.campaigns)
    .values({
      clerkUserId: userId,
      name: body.name.trim(),
      status: "active",
      icp: body.icp ? { description: body.icp } : {},
      offering: {},
      positioning: {},
      searchCriteria: body.config ?? {},
    })
    .returning();

  return NextResponse.json(campaign, { status: 201 });
}

export async function PATCH(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    id: string;
    name?: string;
    status?: string;
    config?: Record<string, unknown>;
  };

  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const [updated] = await adminDb
    .update(schema.campaigns)
    .set({
      ...(body.name ? { name: body.name } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.config ? { searchCriteria: body.config } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.campaigns.id, body.id),
        eq(schema.campaigns.clerkUserId, userId),
      ),
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
