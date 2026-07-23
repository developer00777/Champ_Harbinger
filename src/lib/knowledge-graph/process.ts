import "server-only";
import { isNull, asc } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { processEpisode, type ProcessEpisodeDeps } from "./extract";

/**
 * Plain batch driver over pending (unprocessed) kg_episodes. This is NOT
 * wired to pg-boss or any scheduler — the coordinator owns hooking this up
 * to a recurring job. Call it directly (e.g. from a cron route or a script)
 * to drain the backlog.
 */
export async function processPendingEpisodes(
  limit = 25,
  deps: ProcessEpisodeDeps = {},
): Promise<{ processed: number; errored: number; factsWritten: number }> {
  const pending = await adminDb
    .select({ id: schema.kgEpisodes.id })
    .from(schema.kgEpisodes)
    .where(isNull(schema.kgEpisodes.processedAt))
    .orderBy(asc(schema.kgEpisodes.createdAt))
    .limit(limit);

  let processed = 0;
  let errored = 0;
  let factsWritten = 0;

  for (const row of pending) {
    try {
      const result = await processEpisode(row.id, deps);
      factsWritten += result.factsWritten;
      processed += 1;
    } catch {
      // processEpisode already records its own errors on the episode row;
      // this catch is a last-resort guard so one bad row can't halt the batch.
      errored += 1;
    }
  }

  return { processed, errored, factsWritten };
}
