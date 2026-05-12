import { NextResponse } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { validateApiKey } from "@/lib/api/validate-api-key";

export async function GET(request: Request) {
  let ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since");
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);
  const cursor = searchParams.get("cursor");

  const conditions = [
    eq(schema.champiqQueue.clerkUserId, ctx.userId),
    eq(schema.champiqQueue.status, "pending"),
  ];

  if (since) {
    conditions.push(gte(schema.champiqQueue.createdAt, new Date(since)));
  }
  if (cursor) {
    conditions.push(lt(schema.champiqQueue.createdAt, new Date(cursor)));
  }

  const rows = await adminDb
    .select()
    .from(schema.champiqQueue)
    .where(and(...conditions))
    .orderBy(schema.champiqQueue.createdAt)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const prospects = rows.slice(0, limit);
  const nextCursor = hasMore
    ? prospects[prospects.length - 1]?.createdAt.toISOString()
    : null;

  return NextResponse.json({
    prospects: prospects.map((p) => ({
      id: p.id,
      company: {
        name: p.companyName,
        domain: p.companyDomain,
        ...(p.companyData as Record<string, unknown>),
      },
      contacts: p.contacts,
      signal: {
        id: p.signalId,
        name: p.signalName,
        reasoning: p.signalReasoning,
        data: p.signalData,
      },
      score: p.score,
      talking_points: p.talkingPoints,
      qualified_at: p.createdAt.toISOString(),
    })),
    next_cursor: nextCursor,
  });
}
