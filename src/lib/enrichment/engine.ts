import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { trackUsage } from "@/lib/services/cost-tracker";

import { getCached, setCached } from "./cache";
import { getSettings } from "./config";
import { buildFieldValue } from "./confidence";
import { WaterfallOrchestrator, type AuditLogFn } from "./orchestrator";
import { ProviderRegistry } from "./providers/base";
import { OwnedScrapeAdapter } from "./providers/ownedScrape";
import { MockLakeB2BAdapter } from "./providers/lakeb2bMock";
import { LakeB2BAdapter } from "./providers/lakeb2bAdapter";
import { ApolloAdapter } from "./providers/apolloAdapter";
import { PeopleDataLabsAdapter } from "./providers/peopleDataLabsAdapter";
import { CoresignalAdapter } from "./providers/coresignalAdapter";
import { verifyEmailOwned } from "./providers/emailGate";
import { MasterDBWriter } from "./writeback";
import {
  getValue,
  JobStatus,
  makeContact,
  summaryText,
  Tier,
  type Contact,
  type EnrichmentResult,
  type FieldValue,
} from "./types";

/**
 * High-level enrichment service.
 *
 * Wires the WaterfallOrchestrator to its real collaborators (owned email gate,
 * Drizzle TTL cache, provider-call audit + cost logging), persists the working
 * contact / provenance / job, and runs the owned-master build-up on acceptance.
 *
 * Runs end-to-end on one OpenRouter key: the only registered provider in SP1 is
 * the owned LLM scrape. LakeB2B (pinned primary) and optional paid vendors are
 * registered in later phases; the engine surface does not change.
 */

let cachedRegistry: ProviderRegistry | null = null;

/** LAKEB2B_MOCK flag — swaps the real LakeB2B adapter for the deterministic mock. */
function mockLakeB2BEnabled(): boolean {
  const raw = (process.env.LAKEB2B_MOCK ?? "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function getRegistry(): ProviderRegistry {
  if (cachedRegistry) return cachedRegistry;
  const settings = getSettings();
  const registry = new ProviderRegistry(settings);
  registry.register(new OwnedScrapeAdapter());
  // LakeB2B is the pinned primary (orchestrator.PINNED_PRIMARY). Both adapters
  // register under the name "lakeb2b", so exactly ONE is active: normally the
  // real LakeB2BAdapter (no-ops gracefully until its key/API contract lands), or
  // the deterministic MockLakeB2BAdapter when LAKEB2B_MOCK is set — so the
  // "LakeB2B first" waterfall is demoable end to end locally without the real API.
  if (mockLakeB2BEnabled()) {
    registry.register(new MockLakeB2BAdapter());
  } else {
    registry.register(new LakeB2BAdapter());
  }
  // Paid data-API providers (escalation tiers). Each no-ops gracefully until its
  // key is configured (env or per-user BYOK), and only runs for still-missing
  // required fields per the config-driven provider priority list.
  registry.register(new ApolloAdapter());
  registry.register(new PeopleDataLabsAdapter());
  registry.register(new CoresignalAdapter());
  cachedRegistry = registry;
  return registry;
}

/** Test-only: reset the cached registry so a new provider set is picked up. */
export function resetRegistryCache(): void {
  cachedRegistry = null;
}

export interface EnrichContactInput {
  name?: string | null;
  company?: string | null;
  domain?: string | null;
  email?: string | null;
  linkedin?: string | null;
  externalRef?: string | null;
  requiredFields?: string[];
  maxTier?: Tier;
  budgetUsd?: number | null;
  writeBack?: boolean;
  /**
   * Clerk user for per-user key resolution + the waterfall's private audit
   * tables. Optional: when absent (e.g. an unauthenticated chat tool) the engine
   * runs on server env keys and skips its private persistence, but STILL syncs
   * the additive result into the shared knowledge graph.
   */
  clerkUserId?: string;
  clerkOrgId?: string | null;
}

export interface ContactSeed {
  name?: string | null;
  company?: string | null;
  domain?: string | null;
  email?: string | null;
  linkedin?: string | null;
  externalRef?: string | null;
}

function seedToContact(seed: ContactSeed): Contact {
  const contact = makeContact({
    contactId: randomUUID(),
    externalRef: seed.externalRef ?? null,
    fullName: seed.name ?? null,
    company: seed.company ?? null,
    domain: seed.domain ?? null,
    linkedinUrl: seed.linkedin ?? null,
  });
  const settings = getSettings();
  if (seed.email) {
    contact.fields.email = buildFieldValue({
      value: seed.email,
      provider: "caller_input",
      settings,
      verified: false,
    });
  }
  if (seed.linkedin) {
    contact.fields.linkedin = buildFieldValue({
      value: seed.linkedin,
      provider: "caller_input",
      settings,
      verified: false,
    });
  }
  return contact;
}

/**
 * Audit logger for a job: persists one enrichment_provider_calls row per provider
 * call AND logs cost to api_usage for billable calls.
 */
function makeAuditLog(
  clerkUserId: string | undefined,
  clerkOrgId: string | null,
): AuditLogFn {
  return async (row: Record<string, unknown>) => {
    try {
      await adminDb.insert(schema.enrichmentProviderCalls).values({
        jobId: (row.jobId as string | null) ?? null,
        contactId: (row.contactId as string | null) ?? null,
        tier: String(row.tier ?? ""),
        provider: String(row.provider ?? ""),
        requestIdentifiers:
          (row.requestIdentifiers as Record<string, unknown>) ?? {},
        success: Boolean(row.success),
        fieldsReturned: (row.fieldsReturned as string[]) ?? [],
        confidence: String(Number(row.confidence ?? 0)),
        costUsd: String(Number(row.costUsd ?? 0)),
        latencyMs:
          row.latencyMs === null || row.latencyMs === undefined
            ? null
            : Number(row.latencyMs),
        httpStatus:
          row.httpStatus === null || row.httpStatus === undefined
            ? null
            : Number(row.httpStatus),
        cacheHit: Boolean(row.cacheHit),
        error: (row.error as string | null) ?? null,
      });
    } catch {
      // Audit must not break the enrichment flow.
    }

    const cost = Number(row.costUsd ?? 0);
    if (cost > 0 && clerkUserId) {
      trackUsage({
        service: "enrichment",
        operation: `provider:${String(row.provider ?? "unknown")}`,
        estimated_cost_usd: cost,
        user_id: clerkUserId,
        metadata: {
          tier: row.tier,
          provider: row.provider,
          cacheHit: row.cacheHit,
          fieldsReturned: row.fieldsReturned,
          clerkOrgId,
        },
      });
    }
  };
}

function buildOrchestrator(
  registry: ProviderRegistry,
  clerkUserId: string | undefined,
  clerkOrgId: string | null,
): WaterfallOrchestrator {
  return new WaterfallOrchestrator({
    registry,
    settings: getSettings(),
    verifyEmail: (email, settings) =>
      verifyEmailOwned(email, settings, clerkUserId),
    cacheGet: (idHash, provider) => getCached(idHash, provider),
    cacheSet: (idHash, result, settings) => setCached(idHash, result, settings),
    auditLog: makeAuditLog(clerkUserId, clerkOrgId),
    clerkUserId,
  });
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function bestValue(contact: Contact, field: string): string | null {
  const v = getValue(contact, field);
  return v === undefined ? null : asText(v);
}

/** Persist the working contact, field provenance, and a job row. Best-effort. */
async function persistContactAndJob(
  contact: Contact,
  result: EnrichmentResult,
  clerkUserId: string | undefined,
  clerkOrgId: string | null,
): Promise<void> {
  // The private audit tables (enrichment_contacts/jobs) require a user; without
  // one we skip them. The shared knowledge-graph sync still runs (see caller).
  if (!contact.contactId || !clerkUserId) return;
  const email = getValue(contact, "email");
  try {
    await adminDb
      .insert(schema.enrichmentContacts)
      .values({
        id: contact.contactId,
        clerkUserId,
        clerkOrgId,
        externalRef: contact.externalRef,
        fullName: contact.fullName,
        firstName: contact.firstName,
        lastName: contact.lastName,
        company: contact.company,
        domain: contact.domain,
        email: email ? String(email) : null,
        phone: bestValue(contact, "phone"),
        title: bestValue(contact, "title"),
        seniority: bestValue(contact, "seniority"),
        linkedin: bestValue(contact, "linkedin"),
        firmographics: contact.firmographics,
        completenessScore: String(contact.completenessScore),
        confidenceScore: String(contact.confidenceScore),
        status: contact.status,
      })
      .onConflictDoUpdate({
        target: schema.enrichmentContacts.id,
        set: {
          email: email ? String(email) : null,
          phone: bestValue(contact, "phone"),
          title: bestValue(contact, "title"),
          seniority: bestValue(contact, "seniority"),
          linkedin: bestValue(contact, "linkedin"),
          firmographics: contact.firmographics,
          completenessScore: String(contact.completenessScore),
          confidenceScore: String(contact.confidenceScore),
          status: contact.status,
          updatedAt: new Date(),
        },
      });

    const provRows = Object.entries(contact.fields).map(([field, fv]) => ({
      contactId: contact.contactId as string,
      field,
      value: asText(fv.value),
      source: fv.source,
      confidence: String(fv.confidence),
      verified: fv.verified,
      observedAt: fv.observedAt,
    }));
    if (provRows.length > 0) {
      await adminDb.insert(schema.enrichmentFieldProvenance).values(provRows);
    }

    await adminDb.insert(schema.enrichmentJobs).values({
      clerkUserId,
      clerkOrgId,
      contactId: contact.contactId,
      status: result.status,
      startTier: Tier.T0Master,
      resolvedTier: result.resolvedTier,
      requiredFields: result.requiredFields,
      totalCostUsd: String(result.totalCostUsd),
      finishedAt: new Date(),
    });
  } catch {
    // Persistence is best-effort.
  }
}

/** Run the full owned-first waterfall for ONE contact and persist the result. */
export async function enrichContact(
  input: EnrichContactInput,
): Promise<EnrichmentResult & { summary: string }> {
  const clerkOrgId = input.clerkOrgId ?? null;
  const registry = getRegistry();
  const contact = seedToContact({
    name: input.name,
    company: input.company,
    domain: input.domain,
    email: input.email,
    linkedin: input.linkedin,
    externalRef: input.externalRef,
  });
  const orchestrator = buildOrchestrator(
    registry,
    input.clerkUserId,
    clerkOrgId,
  );
  const result = await orchestrator.run(contact, {
    requiredFields: input.requiredFields,
    maxTier: input.maxTier,
    budgetUsd: input.budgetUsd ?? null,
  });

  // Persist the working contact + provenance + job FIRST: the master
  // writeback log's contactId FK references enrichment_contacts, so the row
  // must exist before writeBack() logs against it (otherwise the audit +
  // rollback trail is silently dropped and masterWriteback misreports false).
  await persistContactAndJob(contact, result, input.clerkUserId, clerkOrgId);

  // Close the loop on acceptance: build up the owned master DB.
  if ((input.writeBack ?? true) && result.status === JobStatus.Accepted) {
    const writer = new MasterDBWriter();
    const wb = await writer.writeBack(contact);
    if (wb) {
      result.masterWriteback = true;
      result.notes.push(
        `Wrote ${wb.fieldsWritten.length} field(s) to the owned master (rollback token ${wb.rollbackToken}).`,
      );
    }
  }

  // Sync the provenance-merged result into the production knowledge graph
  // (people / organizations) so outreach + personalization read it. Additive:
  // LakeB2B and LinkedIn/web land in their own enrichment_data subtrees. Runs
  // whenever we gathered anything, not just on acceptance, so partial signal
  // still grows the graph. Best-effort — never fails the enrichment.
  const gatheredSomething =
    Object.keys(contact.fields).length > 0 ||
    Object.keys(contact.firmographics).length > 0;
  if ((input.writeBack ?? true) && gatheredSomething) {
    try {
      const { syncToKnowledgeBase } = await import("./knowledgeBaseSync");
      await syncToKnowledgeBase(contact);
    } catch {
      // knowledge-graph sync is best-effort.
    }
  }

  return { ...result, summary: summaryText(result) };
}

export interface EnrichSetInput {
  contacts?: ContactSeed[];
  requiredFields?: string[];
  maxTier?: Tier;
  budgetUsd?: number | null;
  writeBack?: boolean;
  limit?: number;
  offset?: number;
  clerkUserId: string;
  clerkOrgId?: string | null;
}

export interface EnrichSetPageResult {
  total: number;
  count: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  results: Array<Record<string, unknown>>;
}

/** Enrich a page of contacts, one record at a time, with pagination. */
export async function enrichSet(
  input: EnrichSetInput,
): Promise<EnrichSetPageResult> {
  const seeds = input.contacts ?? [];
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 25;
  const total = seeds.length;
  const page = seeds.slice(offset, offset + limit);
  async function enrichOne(
    seed: (typeof page)[number],
  ): Promise<Record<string, unknown>> {
    try {
      const r = await enrichContact({
        name: seed.name,
        company: seed.company,
        domain: seed.domain,
        email: seed.email,
        linkedin: seed.linkedin,
        externalRef: seed.externalRef,
        requiredFields: input.requiredFields,
        maxTier: input.maxTier,
        budgetUsd: input.budgetUsd ?? null,
        writeBack: input.writeBack,
        clerkUserId: input.clerkUserId,
        clerkOrgId: input.clerkOrgId ?? null,
      });
      return {
        externalRef: seed.externalRef ?? null,
        contactId: r.contactId,
        status: r.status,
        resolvedTier: r.resolvedTier,
        confidenceScore: r.confidenceScore,
        totalCostUsd: r.totalCostUsd,
        masterWriteback: r.masterWriteback,
        summary: r.summary,
      };
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      const msg = err instanceof Error ? err.message : String(err);
      return {
        externalRef: seed.externalRef ?? null,
        status: "failed",
        error: `${name}: ${msg}`,
      };
    }
  }

  // Bounded-concurrency fan-out across the page. Order is preserved; the inner
  // LLM calls are globally rate-limited (runLlm), so this won't hammer the key.
  const concurrency = Math.max(
    1,
    Number(process.env.ENRICH_SET_CONCURRENCY) || 4,
  );
  const results: Array<Record<string, unknown>> = new Array(page.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, page.length) }, async () => {
      for (let i = cursor++; i < page.length; i = cursor++) {
        results[i] = await enrichOne(page[i]);
      }
    }),
  );

  const processed = offset + page.length;
  const hasMore = processed < total;
  return {
    total,
    count: page.length,
    offset,
    hasMore,
    nextOffset: hasMore ? processed : null,
    results,
  };
}

/** Fetch a previously stored enrichment record by contactId (read-only). */
export async function getEnrichment(
  contactId: string,
  clerkUserId: string,
): Promise<Record<string, unknown>> {
  const [contactRow] = await adminDb
    .select()
    .from(schema.enrichmentContacts)
    .where(
      and(
        eq(schema.enrichmentContacts.id, contactId),
        eq(schema.enrichmentContacts.clerkUserId, clerkUserId),
      ),
    )
    .limit(1);
  if (!contactRow) {
    return {
      found: false,
      message: `No enrichment found for contactId ${contactId}.`,
    };
  }
  const provRows = await adminDb
    .select({
      field: schema.enrichmentFieldProvenance.field,
      value: schema.enrichmentFieldProvenance.value,
      source: schema.enrichmentFieldProvenance.source,
      confidence: schema.enrichmentFieldProvenance.confidence,
      verified: schema.enrichmentFieldProvenance.verified,
      observedAt: schema.enrichmentFieldProvenance.observedAt,
    })
    .from(schema.enrichmentFieldProvenance)
    .where(eq(schema.enrichmentFieldProvenance.contactId, contactId))
    .orderBy(schema.enrichmentFieldProvenance.observedAt);
  return { found: true, contact: contactRow, fields: provRows };
}

/** List configured tiers, providers, and circuit-breaker status (read-only). */
export async function listProviders(
  clerkUserId?: string,
): Promise<Record<string, unknown>> {
  const settings = getSettings();
  const registry = getRegistry();
  return {
    providers: await registry.describe(clerkUserId),
    emailGate: {
      configured: true,
      provider: "owned_email_gate",
      note: "The owned email gate (pattern + MX) runs on any candidate email at every tier; it is not a tier itself.",
    },
    primarySource: "lakeb2b (pinned primary when registered)",
    providerPriority: settings.providerPriority,
    budgets: {
      defaultJobBudgetUsd: settings.defaultJobBudgetUsd,
      perTierBudgetUsd: settings.perTierBudgetUsd,
    },
  };
}

export type { FieldValue };
