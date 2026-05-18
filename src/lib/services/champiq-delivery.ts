import "server-only";
import { eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

interface ChampIQProspect {
  champharb_queue_id: string;
  company: string;
  company_domain: string | null;
  company_data: Record<string, unknown>;
  contacts: unknown[];
  signal_name: string | null;
  signal_reasoning: string | null;
  signal_data: Record<string, unknown>;
  score: number | null;
  talking_points: string[];
  source: string;
}

export async function deliverProspectToChampIQ(
  queueId: string,
  champiqUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const [item] = await adminDb
    .select()
    .from(schema.champiqQueue)
    .where(eq(schema.champiqQueue.id, queueId))
    .limit(1);

  if (!item) {
    return { ok: false, error: "Queue item not found" };
  }

  const prospect: ChampIQProspect = {
    champharb_queue_id: item.id,
    company: item.companyName,
    company_domain: item.companyDomain,
    company_data: (item.companyData as Record<string, unknown>) ?? {},
    contacts: (item.contacts as unknown[]) ?? [],
    signal_name: item.signalName ?? null,
    signal_reasoning: item.signalReasoning ?? null,
    signal_data: (item.signalData as Record<string, unknown>) ?? {},
    score: item.score ?? null,
    talking_points: (item.talkingPoints as string[]) ?? [],
    source: "champharb",
  };

  const url = `${champiqUrl.replace(/\/$/, "")}/api/harbinger/prospects`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prospects: [prospect] }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `ChampOracle returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    // Mark as delivered
    await adminDb
      .update(schema.champiqQueue)
      .set({ status: "delivered", pushedAt: new Date() })
      .where(eq(schema.champiqQueue.id, queueId));

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
