import "server-only";
import { sql } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { researchSignal } from "@/lib/signals/researcher";

/**
 * Batch driver for Port A: finds recent signal_results that haven't produced
 * a research episode yet and runs each through researchSignal(). A "signal"
 * kg_episode's content embeds the originating signal_results id, so we
 * dedupe against that rather than a dedicated processed flag.
 *
 * Bounded to a recent lookback window (not "unprocessed forever") — a signal
 * that yields no groundable fact (the correct outcome for noisy signals,
 * see researcher.ts) leaves no episode and would otherwise be retried by
 * every future tick. A signal gets a few attempts within the window, then
 * ages out; that's an acceptable tradeoff against reprocessing every noisy
 * result on every tick indefinitely.
 */
export async function processRecentSignalResults(
  lookbackMinutes = 20,
  limit = 50,
): Promise<{ attempted: number; hooksFound: number }> {
  const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000);

  const rows = await adminDb
    .select({ id: schema.signalResults.id })
    .from(schema.signalResults)
    .where(
      sql`${schema.signalResults.ranAt} >= ${cutoff} AND NOT EXISTS (
        SELECT 1 FROM ${schema.kgEpisodes}
        WHERE ${schema.kgEpisodes.kind} = 'signal'
          AND ${schema.kgEpisodes.content}->>'signalResultId' = ${schema.signalResults.id}::text
      )`,
    )
    .limit(limit);

  let hooksFound = 0;
  for (const row of rows) {
    try {
      const result = await researchSignal(row.id);
      if (result) hooksFound += 1;
    } catch (err) {
      console.error(
        `[signals/process] researchSignal failed for ${row.id}:`,
        err,
      );
    }
  }

  return { attempted: rows.length, hooksFound };
}
