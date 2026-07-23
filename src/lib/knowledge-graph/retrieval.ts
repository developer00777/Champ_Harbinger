import "server-only";
import { and, desc, eq, isNull, or } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

/**
 * Read side of the knowledge graph. Contract is fixed — Port B (email
 * composition) depends on this exact shape. Do not change the return type.
 */

const MAX_FACTS = 20;

/** The relation the signal researcher (src/lib/signals/researcher.ts) writes
 * its single accepted fact under. Kept here (not re-exported) so retrieval
 * and researcher agree on the marker without a circular import. */
export const RESEARCH_HOOK_RELATION = "research_hook";

function isUrl(value: string | null): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

async function findNode(refTable: string, refId: string) {
  const [node] = await adminDb
    .select()
    .from(schema.kgNodes)
    .where(
      and(
        eq(schema.kgNodes.refTable, refTable),
        eq(schema.kgNodes.refId, refId),
      ),
    )
    .limit(1);
  return node ?? null;
}

async function currentEdgesForNode(nodeId: string) {
  return adminDb
    .select()
    .from(schema.kgEdges)
    .where(
      and(
        or(
          eq(schema.kgEdges.sourceId, nodeId),
          eq(schema.kgEdges.targetId, nodeId),
        ),
        isNull(schema.kgEdges.invalidAt),
      ),
    )
    .orderBy(desc(schema.kgEdges.validFrom))
    .limit(MAX_FACTS);
}

export async function getPersonContext(personId: string): Promise<{
  summary: string;
  facts: string[];
  primaryHook: { fact: string; sourceUrl?: string; capturedAt: string } | null;
}> {
  const node = await findNode("people", personId);
  if (!node) return { summary: "", facts: [], primaryHook: null };

  const edges = await currentEdgesForNode(node.id);
  const facts = edges.map((e) => e.factText);

  const hookEdge = edges.find((e) => e.relation === RESEARCH_HOOK_RELATION);
  const primaryHook = hookEdge
    ? {
        fact: hookEdge.factText,
        ...(isUrl(hookEdge.source) ? { sourceUrl: hookEdge.source } : {}),
        capturedAt: hookEdge.validFrom.toISOString(),
      }
    : null;

  const summary = node.summary?.trim() || facts.slice(0, 3).join(" ") || "";

  return { summary, facts, primaryHook };
}

export async function getOrganizationContext(
  organizationId: string,
): Promise<{ summary: string; facts: string[] }> {
  const node = await findNode("organizations", organizationId);
  if (!node) return { summary: "", facts: [] };

  const edges = await currentEdgesForNode(node.id);
  const facts = edges.map((e) => e.factText);
  const summary = node.summary?.trim() || facts.slice(0, 3).join(" ") || "";

  return { summary, facts };
}
