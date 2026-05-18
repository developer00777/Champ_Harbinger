import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { deliverProspectToChampIQ } from "@/lib/services/champiq-delivery";

async function getChampIQUrl(userId: string): Promise<string | null> {
  const [settings] = await adminDb
    .select({ champiqUrl: schema.userSettings.champiqUrl })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.clerkUserId, userId))
    .limit(1);
  return settings?.champiqUrl ?? null;
}

export async function GET() {
  const { userId } = await getCurrentUser();

  const pending = await adminDb
    .select()
    .from(schema.champiqQueue)
    .where(
      and(
        eq(schema.champiqQueue.clerkUserId, userId),
        eq(schema.champiqQueue.status, "pending"),
      ),
    )
    .orderBy(desc(schema.champiqQueue.createdAt))
    .limit(20);

  return NextResponse.json(
    pending.map((p) => ({
      id: p.id,
      company_name: p.companyName,
      company_domain: p.companyDomain,
      signal_name: p.signalName,
      signal_reasoning: p.signalReasoning,
      score: p.score,
      talking_points: p.talkingPoints,
      created_at: p.createdAt.toISOString(),
    })),
  );
}

export async function POST(request: Request) {
  const { userId } = await getCurrentUser();

  const body = (await request.json()) as {
    id?: string;
    action?: "push" | "discard" | "push_all";
  };

  if (!body.action || !["push", "discard", "push_all"].includes(body.action)) {
    return NextResponse.json(
      { error: "action (push|discard|push_all) is required" },
      { status: 400 },
    );
  }

  const champiqUrl = await getChampIQUrl(userId);

  // Bulk-approve all pending items and deliver to ChampOracle
  if (body.action === "push_all") {
    const pending = await adminDb
      .select({ id: schema.champiqQueue.id })
      .from(schema.champiqQueue)
      .where(
        and(
          eq(schema.champiqQueue.clerkUserId, userId),
          eq(schema.champiqQueue.status, "pending"),
        ),
      );

    // First mark all as pushed
    await adminDb
      .update(schema.champiqQueue)
      .set({ status: "pushed", pushedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.champiqQueue.clerkUserId, userId),
          eq(schema.champiqQueue.status, "pending"),
        ),
      );

    // Then deliver to ChampOracle if configured (fire-and-forget per item)
    if (champiqUrl) {
      await Promise.allSettled(
        pending.map((p) => deliverProspectToChampIQ(p.id, champiqUrl)),
      );
    }

    return NextResponse.json({ ok: true, action: "push_all" });
  }

  // Single-item push or discard
  if (!body.id) {
    return NextResponse.json(
      { error: "id is required for push and discard actions" },
      { status: 400 },
    );
  }

  await adminDb
    .update(schema.champiqQueue)
    .set({
      status: body.action === "push" ? "pushed" : "discarded",
      pushedAt: body.action === "push" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.champiqQueue.id, body.id),
        eq(schema.champiqQueue.clerkUserId, userId),
      ),
    );

  // Deliver to ChampOracle if configured
  if (body.action === "push" && champiqUrl) {
    await deliverProspectToChampIQ(body.id, champiqUrl);
  }

  return NextResponse.json({ ok: true });
}
