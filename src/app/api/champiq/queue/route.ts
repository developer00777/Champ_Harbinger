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

    // Mark all as pushed first; delivery may flip individual rows to
    // "delivered" or leave them at "pushed" on failure.
    await adminDb
      .update(schema.champiqQueue)
      .set({ status: "pushed", pushedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.champiqQueue.clerkUserId, userId),
          eq(schema.champiqQueue.status, "pending"),
        ),
      );

    let delivered = 0;
    let failed = 0;
    if (champiqUrl) {
      const results = await Promise.allSettled(
        pending.map((p) => deliverProspectToChampIQ(p.id, champiqUrl)),
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.ok) delivered++;
        else failed++;
      }
    }
    return NextResponse.json({
      ok: true,
      action: "push_all",
      total: pending.length,
      delivered,
      failed,
      champiq_url_configured: !!champiqUrl,
    });
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

  if (body.action === "discard") {
    return NextResponse.json({ ok: true, action: "discard" });
  }

  // Push action: try to deliver to ChampOracle if configured
  if (!champiqUrl) {
    return NextResponse.json({
      ok: true,
      action: "push",
      delivered: false,
      reason:
        "ChampIQ URL not configured — item marked as pushed but not delivered",
    });
  }

  const result = await deliverProspectToChampIQ(body.id, champiqUrl);
  return NextResponse.json({
    ok: true,
    action: "push",
    delivered: result.ok,
    error: result.ok ? undefined : result.error,
  });
}
