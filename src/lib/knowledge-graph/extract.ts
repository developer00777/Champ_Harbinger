import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { insertKgEdge, invalidateEdges, upsertKgNode } from "./nodes";

/**
 * Turns a kg_episode's raw content into kg_nodes + kg_edges.
 *
 * Mirrors the "never invent, ground every field" style of
 * src/lib/enrichment/extract.ts: the model call is injected so tests stay
 * deterministic and network-free, and any fact the model can't ground in the
 * episode content is simply dropped rather than stored.
 */

const KgFactSchema = z.object({
  subject: z.string(),
  subjectKind: z.enum(["person", "organization", "topic", "signal", "event"]),
  relation: z.string(),
  target: z.string(),
  targetKind: z.enum(["person", "organization", "topic", "signal", "event"]),
  factText: z.string(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  /**
   * True when this fact supersedes any prior fact of the same
   * subject+relation (e.g. a job change invalidates the previous
   * works_at edge). Only set this for facts that are exclusive by nature.
   */
  exclusive: z.boolean().nullable().optional(),
});

const KgExtractionSchema = z.object({
  facts: z.array(KgFactSchema).default([]),
});

export type KgExtractionObject = z.infer<typeof KgExtractionSchema>;

/** Injected model call — same shape as enrichment/extract's GenerateObjectFn. */
export type GenerateObjectFn = (args: {
  schema: unknown;
  prompt: string;
}) => Promise<{ object: Record<string, unknown> }>;

export interface ProcessEpisodeDeps {
  generateObject?: GenerateObjectFn;
  clerkUserId?: string;
}

function buildPrompt(episode: {
  kind: string;
  refTable: string | null;
  refId: string | null;
  content: Record<string, unknown>;
}): string {
  return [
    "You extract structured knowledge-graph facts from a single raw event about a B2B sales prospect or their company.",
    "Only return facts clearly supported by the event content below. Never invent a fact, a name, or a relationship that is not present. Return an empty facts array if nothing concrete is stated.",
    "Each fact connects a subject entity to a target entity via a short relation verb (e.g. works_at, raised_funding, announced, interested_in, mentioned, launched). `factText` must be a short, human-readable statement of the fact grounded in the content.",
    "Set `exclusive: true` only for facts that replace a prior state for the same subject+relation (e.g. a new employer replaces the old one). Leave it false/omitted for additive facts (an announcement, a mention, a funding event).",
    `\nEVENT KIND: ${episode.kind}`,
    episode.refTable && episode.refId
      ? `EVENT SUBJECT RECORD: ${episode.refTable}#${episode.refId}`
      : "",
    `\nEVENT CONTENT:\n${JSON.stringify(episode.content).slice(0, 10000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function defaultGenerateObject(
  clerkUserId: string | undefined,
  args: { schema: unknown; prompt: string },
): Promise<{ object: Record<string, unknown> }> {
  const [{ generateObjectLimited: generateObject }, { getModel }, { Models }] =
    await Promise.all([
      import("@/lib/ai/generate"),
      import("@/lib/ai/provider"),
      import("@/lib/ai/models"),
    ]);
  const model = await getModel(Models.classification, clerkUserId);
  void args.schema;
  const result = await generateObject({
    model,
    schema: KgExtractionSchema,
    prompt: args.prompt,
  });
  return { object: result.object as Record<string, unknown> };
}

/**
 * Process one pending episode: extract facts via the LLM, write kg_nodes +
 * kg_edges, invalidate superseded exclusive edges, and mark the episode
 * processed. Always marks the episode processed (recording `error` on
 * failure) so a bad episode doesn't retry forever.
 */
export async function processEpisode(
  episodeId: string,
  deps: ProcessEpisodeDeps = {},
): Promise<{ factsWritten: number }> {
  const [episode] = await adminDb
    .select()
    .from(schema.kgEpisodes)
    .where(eq(schema.kgEpisodes.id, episodeId))
    .limit(1);

  if (!episode) return { factsWritten: 0 };
  if (episode.processedAt) return { factsWritten: 0 };

  const generate =
    deps.generateObject ??
    ((args: { schema: unknown; prompt: string }) =>
      defaultGenerateObject(deps.clerkUserId, args));

  let factsWritten = 0;
  let errorMessage: string | null = null;

  try {
    const res = await generate({
      schema: KgExtractionSchema,
      prompt: buildPrompt({
        kind: episode.kind,
        refTable: episode.refTable,
        refId: episode.refId,
        content: episode.content,
      }),
    });
    const parsed = KgExtractionSchema.safeParse(res.object ?? {});
    const facts: KgExtractionObject["facts"] = parsed.success
      ? parsed.data.facts
      : [];

    for (const fact of facts) {
      if (
        !fact.subject?.trim() ||
        !fact.target?.trim() ||
        !fact.factText?.trim()
      ) {
        continue;
      }

      // The episode's own subject record (when known) anchors the node
      // identity instead of a fresh name-based node, so repeated episodes
      // about the same person/org converge on one kg_node.
      const subjectIsEpisodeSubject =
        episode.refTable != null &&
        ((fact.subjectKind === "person" && episode.refTable === "people") ||
          (fact.subjectKind === "organization" &&
            episode.refTable === "organizations"));

      const subjectNode = await upsertKgNode({
        kind: fact.subjectKind,
        name: fact.subject,
        refTable: subjectIsEpisodeSubject ? episode.refTable : null,
        refId: subjectIsEpisodeSubject ? episode.refId : null,
      });
      const targetNode = await upsertKgNode({
        kind: fact.targetKind,
        name: fact.target,
      });

      if (fact.exclusive) {
        await invalidateEdges({
          sourceId: subjectNode.id,
          relation: fact.relation,
        });
      }

      await insertKgEdge({
        sourceId: subjectNode.id,
        targetId: targetNode.id,
        relation: fact.relation,
        factText: fact.factText,
        confidence: fact.confidence ?? null,
        source: episode.kind,
        episodeId: episode.id,
      });
      factsWritten += 1;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  await adminDb
    .update(schema.kgEpisodes)
    .set({ processedAt: new Date(), error: errorMessage })
    .where(eq(schema.kgEpisodes.id, episodeId));

  return { factsWritten };
}
