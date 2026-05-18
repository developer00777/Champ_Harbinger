import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { executeSignal } from "@/lib/signals/executor";
import { deliverProspectToChampIQ } from "@/lib/services/champiq-delivery";
import type { Signal } from "@/lib/types/signal";

export const maxDuration = 60;

/** Map confidence label to a 0–1 numeric score for champiq_queue.score */
function confidenceToScore(confidence: "high" | "medium" | "low"): number {
  switch (confidence) {
    case "high":
      return 0.9;
    case "medium":
      return 0.6;
    case "low":
      return 0.3;
  }
}

/**
 * Resolve the effective handoff mode for a specific signal.
 * `per_signal` mode reads from userSettings.champiqSignalConfig — if no
 * per-signal entry exists, falls back to "review" (the safe default).
 */
function resolveEffectiveMode(
  globalMode: string,
  signalId: string,
  signalScore: number,
  signalConfig: Record<string, { mode: "auto" | "review"; min_score: number }>,
): "auto" | "review" {
  if (globalMode !== "per_signal") {
    return globalMode === "auto" ? "auto" : "review";
  }
  const cfg = signalConfig[signalId];
  if (!cfg) return "review";
  // If a min_score threshold is set, downgrade to review when below threshold.
  if (cfg.min_score && signalScore < cfg.min_score) return "review";
  return cfg.mode;
}

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const body = (await request.json()) as {
    signal_id?: string;
    domain?: string;
  };

  if (!body.signal_id || !body.domain) {
    return NextResponse.json(
      { error: "signal_id and domain are required" },
      { status: 400 },
    );
  }

  const [signal] = await adminDb
    .select()
    .from(schema.signals)
    .where(eq(schema.signals.id, body.signal_id))
    .limit(1);

  if (!signal) {
    return NextResponse.json({ error: "Signal not found" }, { status: 404 });
  }

  const mappedSignal: Signal = {
    id: signal.id,
    name: signal.name,
    slug: signal.slug ?? signal.name.toLowerCase().replace(/\s+/g, "-"),
    description: signal.description ?? "",
    long_description: signal.longDescription ?? null,
    category: signal.category as Signal["category"],
    icon: signal.icon ?? null,
    execution_type: signal.executionType as Signal["execution_type"],
    tool_key: signal.toolKey ?? null,
    config: (signal.config as Record<string, unknown>) ?? {},
    is_builtin: signal.isBuiltin,
    is_public: signal.isPublic,
    created_by: signal.createdBy ?? null,
    created_at: signal.createdAt.toISOString(),
    updated_at: signal.updatedAt.toISOString(),
  };

  const output = await executeSignal(mappedSignal, {
    domain: body.domain,
    useAdmin: true,
  });

  let queued = false;
  let delivered = false;

  if (output.found) {
    const [settings] = await adminDb
      .select({
        champiqUrl: schema.userSettings.champiqUrl,
        champiqHandoffMode: schema.userSettings.champiqHandoffMode,
        champiqSignalConfig: schema.userSettings.champiqSignalConfig,
      })
      .from(schema.userSettings)
      .where(eq(schema.userSettings.clerkUserId, ctx.userId))
      .limit(1);

    const globalMode = settings?.champiqHandoffMode ?? "review";
    const signalConfig =
      (settings?.champiqSignalConfig as Record<
        string,
        { mode: "auto" | "review"; min_score: number }
      >) ?? {};
    const score = confidenceToScore(output.confidence);
    const effectiveMode = resolveEffectiveMode(
      globalMode,
      signal.id,
      score,
      signalConfig,
    );

    // ── Deduplication: if the same user already has a non-discarded entry
    //    for this domain+signal pair, update it in place instead of
    //    creating a duplicate. Keeps the queue clean across repeated runs.
    const [existing] = await adminDb
      .select({ id: schema.champiqQueue.id })
      .from(schema.champiqQueue)
      .where(
        and(
          eq(schema.champiqQueue.clerkUserId, ctx.userId),
          eq(schema.champiqQueue.companyDomain, body.domain),
          eq(schema.champiqQueue.signalId, signal.id),
        ),
      )
      .limit(1);

    const targetStatus = effectiveMode === "auto" ? "pushed" : "pending";
    let queueId: string;

    if (existing) {
      await adminDb
        .update(schema.champiqQueue)
        .set({
          companyData: output.data ?? {},
          signalReasoning: output.summary ?? "",
          signalData: output.data ?? {},
          score,
          status: targetStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.champiqQueue.id, existing.id));
      queueId = existing.id;
    } else {
      const [inserted] = await adminDb
        .insert(schema.champiqQueue)
        .values({
          clerkUserId: ctx.userId,
          companyName: body.domain,
          companyDomain: body.domain,
          companyData: output.data ?? {},
          contacts: [],
          signalId: signal.id,
          signalName: signal.name,
          signalReasoning: output.summary ?? "",
          signalData: output.data ?? {},
          score,
          talkingPoints: [],
          status: targetStatus,
        })
        .returning({ id: schema.champiqQueue.id });
      queueId = inserted.id;
    }

    queued = true;

    // Auto-deliver to ChampOracle when in auto mode and URL configured.
    if (effectiveMode === "auto" && settings?.champiqUrl) {
      const result = await deliverProspectToChampIQ(
        queueId,
        settings.champiqUrl,
      );
      delivered = result.ok;
      if (!result.ok) {
        console.error(
          `[signals/run] delivery failed for ${queueId}:`,
          result.error,
        );
      }
    }
  }

  return NextResponse.json({
    fired: output.found,
    reasoning: output.summary ?? "",
    data: output.data ?? {},
    fired_at: output.found ? new Date().toISOString() : null,
    queued,
    delivered,
  });
}
