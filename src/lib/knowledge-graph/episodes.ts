import "server-only";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

/**
 * Episodes are the raw ingestion log the graph extractor turns into
 * nodes+edges (kept for provenance and reprocessing — see db/schema.ts
 * kgEpisodes). Every writer of graph facts (enrichment sync, signal
 * researcher, future email-sent/received hooks) should go through
 * recordEpisode rather than inserting kg_episodes rows directly.
 */

export type EpisodeKind =
  "enrichment" | "signal" | "email_sent" | "email_received" | "note";

export interface RecordEpisodeInput {
  kind: EpisodeKind | string;
  clerkUserId?: string | null;
  refTable?: string | null;
  refId?: string | null;
  content: Record<string, unknown>;
}

export async function recordEpisode(
  input: RecordEpisodeInput,
): Promise<{ id: string }> {
  const [created] = await adminDb
    .insert(schema.kgEpisodes)
    .values({
      kind: input.kind,
      clerkUserId: input.clerkUserId ?? null,
      refTable: input.refTable ?? null,
      refId: input.refId ?? null,
      content: input.content,
    })
    .returning({ id: schema.kgEpisodes.id });
  return { id: created.id };
}
