import { eq, and } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";
import type { Signal } from "@/lib/types/signal";

/**
 * Load active signals for a campaign's system prompt.
 * Returns enabled signals joined from campaign_signals + signals.
 */
export async function getActiveSignals(campaignId: string): Promise<Signal[]> {
  const sdb = await getScopedDb();

  const rows = await sdb.raw
    .select({
      signal: schema.signals,
    })
    .from(schema.campaignSignals)
    .innerJoin(schema.signals, eq(schema.campaignSignals.signalId, schema.signals.id))
    .where(
      and(
        eq(schema.campaignSignals.campaignId, campaignId),
        eq(schema.campaignSignals.enabled, true),
      ),
    );

  return rows.map((r) => r.signal as unknown as Signal);
}
