import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

/**
 * Low-level node/edge helpers shared by the generic episode extractor
 * (extract.ts) and the signal researcher (src/lib/signals/researcher.ts).
 *
 * Dedup rule for nodes: when a `refTable`/`refId` pair is supplied the node
 * mirrors an existing knowledge-base row (a person/organization/signal), so
 * that pair is the identity key. Free-standing concepts (topics, events with
 * no backing row) dedupe on (kind, name) case-insensitively instead.
 */

export type KgNodeKind =
  "person" | "organization" | "topic" | "signal" | "event";

export interface UpsertKgNodeInput {
  kind: KgNodeKind | string;
  name: string;
  refTable?: string | null;
  refId?: string | null;
  summary?: string | null;
  attributes?: Record<string, unknown>;
}

/** Find-or-create a kg_node, merging attributes/summary into an existing row. */
export async function upsertKgNode(
  input: UpsertKgNodeInput,
): Promise<{ id: string }> {
  const db = adminDb;

  if (input.refTable && input.refId) {
    const [existing] = await db
      .select()
      .from(schema.kgNodes)
      .where(
        and(
          eq(schema.kgNodes.refTable, input.refTable),
          eq(schema.kgNodes.refId, input.refId),
        ),
      )
      .limit(1);
    if (existing) {
      await maybeMergeNode(existing.id, existing, input);
      return { id: existing.id };
    }
  } else {
    const [existing] = await db
      .select()
      .from(schema.kgNodes)
      .where(
        and(
          eq(schema.kgNodes.kind, input.kind),
          sql`lower(${schema.kgNodes.name}) = lower(${input.name})`,
        ),
      )
      .limit(1);
    if (existing) {
      await maybeMergeNode(existing.id, existing, input);
      return { id: existing.id };
    }
  }

  const [created] = await db
    .insert(schema.kgNodes)
    .values({
      kind: input.kind,
      name: input.name,
      refTable: input.refTable ?? null,
      refId: input.refId ?? null,
      summary: input.summary ?? null,
      attributes: input.attributes ?? {},
    })
    .returning({ id: schema.kgNodes.id });
  return { id: created.id };
}

async function maybeMergeNode(
  id: string,
  existing: {
    summary: string | null;
    attributes: Record<string, unknown> | null;
  },
  input: UpsertKgNodeInput,
): Promise<void> {
  const summary = existing.summary ?? input.summary ?? null;
  const attributes = {
    ...(existing.attributes ?? {}),
    ...(input.attributes ?? {}),
  };
  const changed =
    (input.summary && !existing.summary) ||
    Object.keys(input.attributes ?? {}).length > 0;
  if (!changed) return;
  await adminDb
    .update(schema.kgNodes)
    .set({ summary, attributes })
    .where(eq(schema.kgNodes.id, id));
}

export interface InsertKgEdgeInput {
  sourceId: string;
  targetId: string;
  relation: string;
  factText: string;
  confidence?: number | null;
  source?: string | null;
  episodeId?: string | null;
  validFrom?: Date;
}

export async function insertKgEdge(
  input: InsertKgEdgeInput,
): Promise<{ id: string }> {
  const [created] = await adminDb
    .insert(schema.kgEdges)
    .values({
      sourceId: input.sourceId,
      targetId: input.targetId,
      relation: input.relation,
      factText: input.factText,
      confidence: input.confidence != null ? String(input.confidence) : null,
      source: input.source ?? null,
      episodeId: input.episodeId ?? null,
      validFrom: input.validFrom ?? new Date(),
    })
    .returning({ id: schema.kgEdges.id });
  return { id: created.id };
}

/**
 * Invalidate all currently-valid edges from `sourceId` with `relation` — used
 * when a new fact supersedes an exclusive prior one (e.g. a job change
 * invalidates the previous works_at edge).
 */
export async function invalidateEdges(input: {
  sourceId: string;
  relation: string;
  at?: Date;
}): Promise<void> {
  await adminDb
    .update(schema.kgEdges)
    .set({ invalidAt: input.at ?? new Date() })
    .where(
      and(
        eq(schema.kgEdges.sourceId, input.sourceId),
        eq(schema.kgEdges.relation, input.relation),
        isNull(schema.kgEdges.invalidAt),
      ),
    );
}
