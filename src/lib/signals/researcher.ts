import "server-only";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import {
  RESEARCH_HOOK_RELATION,
  insertKgEdge,
  recordEpisode,
  upsertKgNode,
} from "@/lib/knowledge-graph";

/**
 * Port A — "The Researcher".
 *
 * Turns a tripped signal into ONE verified, specific, personalization-ready
 * fact — never a paragraph of generic filler. researchSignal() is the single
 * entry point the coordinator (or a future pg-boss job) calls per
 * signal_results row.
 *
 * Grounding is enforced mechanically, not just by prompt: the model must
 * name which candidate source it used (sourceIndex) and quote the exact
 * substring of that source that supports the fact (evidenceQuote). If the
 * quote doesn't actually appear in the cited source, the fact is rejected —
 * mirrors the "never invent" rule already used in
 * src/lib/email-composition/skill.ts and src/lib/enrichment/extract.ts.
 */

export interface ResearchSource {
  /** Human-readable origin, e.g. "signal_result_output", "enrichment_field:title". */
  label: string;
  text: string;
  url?: string;
  /** ISO timestamp the source content was captured/observed. */
  capturedAt?: string;
}

export interface ResearchContext {
  signalResultId: string;
  personId?: string;
  organizationId?: string;
  signalName?: string;
  sources: ResearchSource[];
}

export interface PrimaryHook {
  fact: string;
  sourceUrl?: string;
  capturedAt: string;
}

export interface ResearchSignalResult {
  personId?: string;
  organizationId?: string;
  primaryHook: PrimaryHook;
}

const HookSchema = z.object({
  fact: z.string().nullable(),
  sourceIndex: z.number().int().nullable(),
  evidenceQuote: z.string().nullable(),
});

export type GenerateObjectFn = (args: {
  schema: unknown;
  prompt: string;
}) => Promise<{ object: Record<string, unknown> }>;

export interface ResearcherDeps {
  loadContext?: (signalResultId: string) => Promise<ResearchContext | null>;
  generateObject?: GenerateObjectFn;
  persistHook?: (input: {
    context: ResearchContext;
    fact: string;
    source: ResearchSource;
  }) => Promise<void>;
  clerkUserId?: string;
}

const MAX_FACT_LENGTH = 220;

export const RESEARCHER_SYSTEM_PROMPT = `You are a B2B sales researcher. You will be given several candidate SOURCES pulled from a tripped sales signal, prior enrichment, and knowledge-graph history for one prospect or company.

Extract exactly ONE specific, recent fact that the target buyer would instantly recognize as true about themselves or their company. Do NOT write a summary, a paragraph, or general commentary. If you cannot find one single verifiable fact, return null. A vague or generic statement is worse than no fact at all.

Rules:
- The fact must be traceable to exactly ONE of the numbered sources below. Set \`sourceIndex\` to that source's number.
- Set \`evidenceQuote\` to a short EXACT substring copied verbatim from that source's text that supports the fact. Never paraphrase the quote — copy it exactly. If you cannot find a verbatim substring to cite, return null for everything.
- Never invent a name, number, date, company, or event that is not present in the sources.
- \`fact\` must be a single sentence, under 200 characters, with no hedging ("might", "possibly") and no generic filler ("is active on LinkedIn", "works in the industry").
- If every source is vague, generic, or noise (no concrete named event/number/fact), return \`{ "fact": null, "sourceIndex": null, "evidenceQuote": null }\`.

Return JSON matching the schema exactly. No text outside the JSON.`;

function buildPrompt(context: ResearchContext): string {
  const sourceBlocks = context.sources
    .map(
      (s, i) =>
        `[${i}] (${s.label}${s.url ? `, ${s.url}` : ""})\n${s.text.slice(0, 2000)}`,
    )
    .join("\n\n");
  return [
    context.signalName ? `SIGNAL: ${context.signalName}` : "",
    `SOURCES:\n${sourceBlocks}`,
    "\nReturn the single best fact now.",
  ]
    .filter(Boolean)
    .join("\n\n");
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
    schema: HookSchema,
    prompt: args.prompt,
  });
  return { object: result.object as Record<string, unknown> };
}

/** Default production context loader — real DB, no mocks. */
async function defaultLoadContext(
  signalResultId: string,
): Promise<ResearchContext | null> {
  const [row] = await adminDb
    .select()
    .from(schema.signalResults)
    .where(eq(schema.signalResults.id, signalResultId))
    .limit(1);
  if (!row) return null;

  let signalName: string | undefined;
  try {
    const [signalRow] = await adminDb
      .select({ name: schema.signals.name })
      .from(schema.signals)
      .where(eq(schema.signals.id, row.signalId))
      .limit(1);
    signalName = signalRow?.name;
  } catch {
    signalName = undefined;
  }

  const sources: ResearchSource[] = [];

  const output = row.output ?? {};
  if (Object.keys(output).length > 0) {
    const url =
      typeof (output as Record<string, unknown>).url === "string"
        ? ((output as Record<string, unknown>).url as string)
        : undefined;
    sources.push({
      label: "signal_result_output",
      text: JSON.stringify(output).slice(0, 4000),
      url,
      capturedAt: row.ranAt.toISOString(),
    });
  }

  if (row.personId) {
    try {
      const provenanceRows = await adminDb
        .select({
          field: schema.enrichmentFieldProvenance.field,
          value: schema.enrichmentFieldProvenance.value,
          observedAt: schema.enrichmentFieldProvenance.observedAt,
          source: schema.enrichmentFieldProvenance.source,
        })
        .from(schema.enrichmentFieldProvenance)
        .innerJoin(
          schema.enrichmentContacts,
          eq(
            schema.enrichmentFieldProvenance.contactId,
            schema.enrichmentContacts.id,
          ),
        )
        .where(eq(schema.enrichmentContacts.personId, row.personId))
        .orderBy(desc(schema.enrichmentFieldProvenance.observedAt))
        .limit(8);

      for (const p of provenanceRows) {
        if (!p.value) continue;
        sources.push({
          label: `enrichment_field_provenance:${p.field}`,
          text: `${p.field}: ${p.value} (source: ${p.source})`,
          capturedAt: p.observedAt.toISOString(),
        });
      }
    } catch {
      // Best-effort — a missing provenance table row must not fail research.
    }

    try {
      const episodeRows = await adminDb
        .select()
        .from(schema.kgEpisodes)
        .where(
          and(
            eq(schema.kgEpisodes.refTable, "people"),
            eq(schema.kgEpisodes.refId, row.personId),
          ),
        )
        .orderBy(desc(schema.kgEpisodes.createdAt))
        .limit(3);

      for (const ep of episodeRows) {
        sources.push({
          label: `kg_episode:${ep.kind}`,
          text: JSON.stringify(ep.content).slice(0, 2000),
          capturedAt: ep.createdAt.toISOString(),
        });
      }
    } catch {
      // Best-effort.
    }
  }

  return {
    signalResultId,
    personId: row.personId ?? undefined,
    organizationId: row.organizationId ?? undefined,
    signalName,
    sources,
  };
}

/** Default production persistence — writes an episode + kg_node/kg_edge. */
async function defaultPersistHook(input: {
  context: ResearchContext;
  fact: string;
  source: ResearchSource;
}): Promise<void> {
  const { context, fact, source } = input;

  const episode = await recordEpisode({
    kind: "signal",
    refTable: context.personId
      ? "people"
      : context.organizationId
        ? "organizations"
        : null,
    refId: context.personId ?? context.organizationId ?? null,
    content: {
      signalResultId: context.signalResultId,
      signalName: context.signalName,
      fact,
      source: {
        label: source.label,
        url: source.url,
        capturedAt: source.capturedAt,
      },
    },
  });

  const isPerson = !!context.personId;
  const subjectRefTable = isPerson ? "people" : "organizations";
  const subjectRefId = isPerson ? context.personId! : context.organizationId!;

  const subjectNode = await upsertKgNode({
    kind: isPerson ? "person" : "organization",
    name: context.signalName ?? subjectRefId,
    refTable: subjectRefTable,
    refId: subjectRefId,
  });

  const targetNode = await upsertKgNode({
    kind: "event",
    name: fact.slice(0, 120),
    refTable: "signal_results",
    refId: context.signalResultId,
    attributes: { sourceLabel: source.label, evidenceUrl: source.url ?? null },
  });

  await insertKgEdge({
    sourceId: subjectNode.id,
    targetId: targetNode.id,
    relation: RESEARCH_HOOK_RELATION,
    factText: fact,
    source: source.url ?? source.label,
    episodeId: episode.id,
    validFrom: source.capturedAt ? new Date(source.capturedAt) : new Date(),
  });
}

/**
 * Research one signal_results row down to a single grounded fact. Returns
 * null when nothing groundable was found — a missing hook is the correct,
 * intended outcome for noisy/generic signals, never a fabricated one.
 */
export async function researchSignal(
  signalResultId: string,
  deps: ResearcherDeps = {},
): Promise<ResearchSignalResult | null> {
  const loadContext = deps.loadContext ?? defaultLoadContext;
  const generate =
    deps.generateObject ??
    ((args: { schema: unknown; prompt: string }) =>
      defaultGenerateObject(deps.clerkUserId, args));
  const persistHook = deps.persistHook ?? defaultPersistHook;

  const context = await loadContext(signalResultId);
  if (!context || context.sources.length === 0) return null;
  if (!context.personId && !context.organizationId) return null;

  let raw: Record<string, unknown>;
  try {
    const res = await generate({
      schema: HookSchema,
      prompt: buildPrompt(context),
    });
    raw = res.object ?? {};
  } catch {
    return null;
  }

  const parsed = HookSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { fact, sourceIndex, evidenceQuote } = parsed.data;

  if (!fact || !fact.trim()) return null;
  const trimmedFact = fact.trim();
  if (trimmedFact.length === 0 || trimmedFact.length > MAX_FACT_LENGTH) {
    return null;
  }

  if (
    sourceIndex == null ||
    sourceIndex < 0 ||
    sourceIndex >= context.sources.length
  ) {
    return null;
  }
  const source = context.sources[sourceIndex];

  if (!evidenceQuote || !evidenceQuote.trim()) return null;
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalize(source.text).includes(normalize(evidenceQuote))) {
    return null;
  }

  await persistHook({ context, fact: trimmedFact, source });

  return {
    personId: context.personId,
    organizationId: context.organizationId,
    primaryHook: {
      fact: trimmedFact,
      ...(source.url ? { sourceUrl: source.url } : {}),
      capturedAt: source.capturedAt ?? new Date().toISOString(),
    },
  };
}
