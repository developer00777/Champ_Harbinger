import "server-only";

import {
  findOrCreateOrganization,
  findOrCreatePerson,
  mergeEnrichmentData,
} from "@/lib/services/knowledge-base";
import { processEpisode, recordEpisode } from "@/lib/knowledge-graph";
import { getValue, type Contact } from "./types";

/**
 * Sync a waterfall-merged Contact into the production knowledge graph
 * (people / organizations), the tables outreach + email composition read.
 *
 * The whole point is ADDITIVITY: LakeB2B and the owned LinkedIn/web scrape are
 * written under their OWN top-level keys in enrichment_data
 * (`enrichment_data.lakeb2b`, `enrichment_data.linkedin`). Because
 * mergeEnrichmentData is last-write-wins PER top-level key, a run that lacks one
 * source never overwrites the other's subtree — LakeB2B is additive to LinkedIn
 * and vice versa. Canonical columns are filled via findOrCreate* (fill-if-empty,
 * never clobbering). `enrichedAt` is written into the JSONB so isRecentlyEnriched
 * (which reads enrichment_data.enrichedAt) works for people.
 *
 * Best-effort: never throws. Returns the resolved ids, or null when there is not
 * enough identity to place the record.
 */

/** Company-level firmographic keys that are not personalization content. */
const PERSONALIZATION_FIRMO_KEYS = new Set(["personalization", "recent_posts"]);

/** firmographics keys only ever produced by the LakeB2B adapter. */
const LAKEB2B_FIRMO_KEYS = [
  "contact_location",
  "company_name",
  "company_location",
  "company_description",
  "employee_range",
  "founded_year",
  "technologies",
];

function nowIso(): string {
  return new Date().toISOString();
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Turn a {country,state,city} bag (or string) into a display location. */
function locationString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const parts = [o.city, o.state, o.country]
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
  }
  return null;
}

function pick(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = obj[k];
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/** Company-level firmographics (everything that is not personalization). */
function companyFirmographics(
  firmo: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(firmo)) {
    if (PERSONALIZATION_FIRMO_KEYS.has(k)) continue;
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Build the additive, source-namespaced enrichment_data payload for a person.
 * Fields carry provenance; each source gets its own top-level subtree so merges
 * never clobber across sources.
 */
export function buildPersonEnrichment(
  contact: Contact,
): Record<string, unknown> {
  const bySource: Record<string, Record<string, unknown>> = {};
  const provenance: Record<string, unknown> = {};
  for (const [field, fv] of Object.entries(contact.fields)) {
    provenance[field] = {
      value: fv.value,
      source: fv.source,
      confidence: fv.confidence,
      verified: fv.verified,
      observedAt:
        fv.observedAt instanceof Date
          ? fv.observedAt.toISOString()
          : fv.observedAt,
    };
    (bySource[fv.source] ??= {})[field] = fv.value;
  }

  const firmo = contact.firmographics ?? {};
  const personalization = firmo.personalization as
    | Record<string, unknown>
    | undefined;
  const recentPosts = firmo.recent_posts;

  const payload: Record<string, unknown> = {
    provenance,
    enrichedAt: nowIso(),
  };

  // LakeB2B subtree — identity/firmographic backbone.
  const lakeb2bFields = bySource["lakeb2b"];
  const lakeb2bFirmo = pick(firmo, LAKEB2B_FIRMO_KEYS);
  if (lakeb2bFields || Object.keys(lakeb2bFirmo).length > 0) {
    payload.lakeb2b = {
      ...(lakeb2bFields ? { fields: lakeb2bFields } : {}),
      ...lakeb2bFirmo,
      observedAt: nowIso(),
    };
  }

  // LinkedIn / owned-scrape subtree — personalization content.
  const ownedFields = bySource["owned_scrape"];
  if (ownedFields || personalization || recentPosts) {
    payload.linkedin = {
      ...(ownedFields ? { fields: ownedFields } : {}),
      ...(personalization ? { personalization } : {}),
      ...(recentPosts ? { recent_posts: recentPosts } : {}),
      observedAt: nowIso(),
    };
  }

  const companyFirmo = companyFirmographics(firmo);
  if (Object.keys(companyFirmo).length > 0) {
    payload.firmographics = companyFirmo;
  }

  return payload;
}

export async function syncToKnowledgeBase(
  contact: Contact,
): Promise<{ personId: string; organizationId: string | null } | null> {
  const name = contact.fullName?.trim();
  if (!name) return null;

  const firmo = contact.firmographics ?? {};

  // 1. Organization (best-effort; a person can exist without one).
  let organizationId: string | null = null;
  const companyName =
    str(getValue(contact, "company")) ?? str(contact.company) ?? null;
  const domain = str(contact.domain);
  if (companyName || domain) {
    try {
      const org = await findOrCreateOrganization({
        name: companyName ?? domain!,
        domain,
        industry: str(firmo.industry),
        location:
          locationString(firmo.company_location) ??
          locationString(firmo.contact_location),
        description: str(firmo.company_description),
        source: "waterfall",
      });
      organizationId = org.id;
      const companyFirmo = companyFirmographics(firmo);
      if (Object.keys(companyFirmo).length > 0) {
        await mergeEnrichmentData("organizations", org.id, {
          firmographics: companyFirmo,
          enrichedAt: nowIso(),
        });
      }
    } catch {
      organizationId = null;
    }
  }

  // 2. Person — dedup by LinkedIn URL / name+org, fill-if-empty on columns.
  let personId: string;
  try {
    const person = await findOrCreatePerson({
      name,
      linkedin_url:
        str(getValue(contact, "linkedin")) ?? str(contact.linkedinUrl),
      work_email: str(getValue(contact, "email")),
      title: str(getValue(contact, "title")),
      organization_id: organizationId,
      source: "waterfall",
    });
    personId = person.id;
  } catch {
    return null;
  }

  // 3. Additive, source-namespaced enrichment_data.
  try {
    await mergeEnrichmentData(
      "people",
      personId,
      buildPersonEnrichment(contact),
    );
  } catch {
    // enrichment merge is best-effort; the record already exists.
  }

  // 4. Feed the knowledge graph: record this enrichment run as an episode and
  // extract it inline so a freshly-synced fact is queryable via
  // getPersonContext() without waiting for a separate batch job. Best-effort
  // — the knowledge base sync itself must never fail because the graph did.
  try {
    const episode = await recordEpisode({
      kind: "enrichment",
      refTable: "people",
      refId: personId,
      content: {
        fullName: name,
        organizationId,
        firmographics: firmo,
      },
    });
    await processEpisode(episode.id);
  } catch {
    // Graph extraction is additive; never block the sync on it.
  }

  return { personId, organizationId };
}
