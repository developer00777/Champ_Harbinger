import { eq, ilike } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import type { Organization, Person } from "@/lib/types/campaign";

/**
 * Strip diacritics/accents from a string for fuzzy name comparison.
 * e.g. "Žunič" → "Zunic", "Müller" → "Muller"
 */
function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Normalize a domain for dedup: strip protocol, www prefix, trailing slash.
 */
export function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Normalize a LinkedIn URL for dedup: strip query params and trailing slashes.
 */
export function normalizeLinkedInUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

/**
 * Find an existing organization by domain (primary) or name (fallback),
 * or create a new one. Returns the organization record.
 */
export async function findOrCreateOrganization(data: {
  name: string;
  domain?: string | null;
  url?: string | null;
  industry?: string | null;
  location?: string | null;
  description?: string | null;
  source?: string | null;
}): Promise<Organization> {
  const normalizedDomain = data.domain ? normalizeDomain(data.domain) : null;

  // Try dedup by domain first
  if (normalizedDomain) {
    const [existing] = await adminDb
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.domain, normalizedDomain))
      .limit(1);

    if (existing) {
      const updates: Partial<typeof schema.organizations.$inferInsert> = {};
      if (data.industry && !existing.industry) updates.industry = data.industry;
      if (data.location && !existing.location) updates.location = data.location;
      if (data.description && !existing.description)
        updates.description = data.description;
      if (data.url && !existing.url) updates.url = data.url;

      if (Object.keys(updates).length > 0) {
        await adminDb
          .update(schema.organizations)
          .set(updates)
          .where(eq(schema.organizations.id, existing.id));
      }

      return existing as unknown as Organization;
    }
  }

  // Fallback: match by name if no domain
  if (!normalizedDomain) {
    const [existing] = await adminDb
      .select()
      .from(schema.organizations)
      .where(ilike(schema.organizations.name, data.name))
      .limit(1);

    if (existing) return existing as unknown as Organization;
  }

  // Create new
  try {
    const [created] = await adminDb
      .insert(schema.organizations)
      .values({
        name: data.name,
        domain: normalizedDomain ?? undefined,
        url:
          data.url || (normalizedDomain ? `https://${normalizedDomain}` : null),
        industry: data.industry || null,
        location: data.location || null,
        description: data.description || null,
        source: data.source || null,
      })
      .returning();

    if (!created) throw new Error("Insert returned no rows");
    return created as unknown as Organization;
  } catch (err: unknown) {
    // Handle race condition: another request may have inserted the same domain
    if (
      normalizedDomain &&
      err instanceof Error &&
      err.message.includes("23505")
    ) {
      const [existing] = await adminDb
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.domain, normalizedDomain))
        .limit(1);
      if (existing) return existing as unknown as Organization;
    }
    throw new Error(
      `Failed to create organization: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Find an existing person by LinkedIn URL (primary) or name+org (fallback),
 * or create a new one. Returns the person record.
 */
export async function findOrCreatePerson(data: {
  name: string;
  linkedin_url?: string | null;
  work_email?: string | null;
  personal_email?: string | null;
  twitter_url?: string | null;
  title?: string | null;
  organization_id?: string | null;
  source?: string | null;
}): Promise<Person> {
  const normalizedLinkedin = data.linkedin_url
    ? normalizeLinkedInUrl(data.linkedin_url)
    : null;

  // Try dedup by LinkedIn URL first
  if (normalizedLinkedin) {
    const [existing] = await adminDb
      .select()
      .from(schema.people)
      .where(eq(schema.people.linkedinUrl, normalizedLinkedin))
      .limit(1);

    if (existing) {
      const updates: Partial<typeof schema.people.$inferInsert> = {};
      if (data.title && !existing.title) updates.title = data.title;
      if (data.work_email && !existing.workEmail)
        updates.workEmail = data.work_email;
      if (data.personal_email && !existing.personalEmail)
        updates.personalEmail = data.personal_email;
      if (data.twitter_url && !existing.twitterUrl)
        updates.twitterUrl = data.twitter_url;
      if (data.organization_id && !existing.organizationId)
        updates.organizationId = data.organization_id;

      if (Object.keys(updates).length > 0) {
        await adminDb
          .update(schema.people)
          .set(updates)
          .where(eq(schema.people.id, existing.id));
      }

      return existing as unknown as Person;
    }
  }

  // Fallback: match by name + organization (diacritics-insensitive)
  if (data.organization_id) {
    const orgPeople = await adminDb
      .select()
      .from(schema.people)
      .where(eq(schema.people.organizationId, data.organization_id));

    if (orgPeople.length > 0) {
      const incomingNorm = stripDiacritics(data.name).toLowerCase();
      const match = orgPeople.find(
        (p) => stripDiacritics(p.name).toLowerCase() === incomingNorm,
      );
      if (match) {
        const updates: Partial<typeof schema.people.$inferInsert> = {};
        if (normalizedLinkedin && !match.linkedinUrl)
          updates.linkedinUrl = normalizedLinkedin;
        if (data.title && !match.title) updates.title = data.title;
        if (data.work_email && !match.workEmail)
          updates.workEmail = data.work_email;
        if (data.personal_email && !match.personalEmail)
          updates.personalEmail = data.personal_email;
        if (data.twitter_url && !match.twitterUrl)
          updates.twitterUrl = data.twitter_url;

        if (Object.keys(updates).length > 0) {
          await adminDb
            .update(schema.people)
            .set(updates)
            .where(eq(schema.people.id, match.id));
        }

        return match as unknown as Person;
      }
    }
  }

  // Create new
  try {
    const [created] = await adminDb
      .insert(schema.people)
      .values({
        name: data.name,
        linkedinUrl: normalizedLinkedin ?? undefined,
        workEmail: data.work_email || null,
        personalEmail: data.personal_email || null,
        twitterUrl: data.twitter_url || null,
        title: data.title || null,
        organizationId: data.organization_id || null,
        source: data.source || null,
      })
      .returning();

    if (!created) throw new Error("Insert returned no rows");
    return created as unknown as Person;
  } catch (err: unknown) {
    // Handle race condition on linkedin_url unique constraint
    if (
      normalizedLinkedin &&
      err instanceof Error &&
      err.message.includes("23505")
    ) {
      const [existing] = await adminDb
        .select()
        .from(schema.people)
        .where(eq(schema.people.linkedinUrl, normalizedLinkedin))
        .limit(1);
      if (existing) return existing as unknown as Person;
    }
    throw new Error(
      `Failed to create person: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Link an organization to a campaign. Upserts into campaign_organizations.
 */
export async function linkOrganizationToCampaign(
  organizationId: string,
  campaignId: string,
): Promise<{ id: string }> {
  const [data] = await adminDb
    .insert(schema.campaignOrganizations)
    .values({ campaignId, organizationId })
    .onConflictDoNothing()
    .returning({ id: schema.campaignOrganizations.id });

  if (!data) {
    // Already existed — fetch the id
    const [existing] = await adminDb
      .select({ id: schema.campaignOrganizations.id })
      .from(schema.campaignOrganizations)
      .where(
        eq(schema.campaignOrganizations.campaignId, campaignId),
      )
      .limit(1);
    if (!existing) throw new Error("Failed to link organization to campaign");
    return existing;
  }
  return data;
}

/**
 * Link a person to a campaign. Upserts into campaign_people.
 */
export async function linkPersonToCampaign(
  personId: string,
  campaignId: string,
): Promise<{ id: string }> {
  const [data] = await adminDb
    .insert(schema.campaignPeople)
    .values({ campaignId, personId })
    .onConflictDoNothing()
    .returning({ id: schema.campaignPeople.id });

  if (!data) {
    const [existing] = await adminDb
      .select({ id: schema.campaignPeople.id })
      .from(schema.campaignPeople)
      .where(eq(schema.campaignPeople.campaignId, campaignId))
      .limit(1);
    if (!existing) throw new Error("Failed to link person to campaign");
    return existing;
  }
  return data;
}

/**
 * Merge new enrichment data into an existing record (additive).
 * Updates last_enriched_at and enrichment_status.
 */
export async function mergeEnrichmentData(
  table: "organizations" | "people",
  id: string,
  newData: Record<string, unknown>,
  status: "enriched" | "failed" = "enriched",
): Promise<void> {
  const tbl =
    table === "organizations" ? schema.organizations : schema.people;
  const idCol = table === "organizations" ? schema.organizations.id : schema.people.id;

  const [existing] = await adminDb
    .select({ enrichmentData: (tbl as typeof schema.organizations).enrichmentData })
    .from(tbl as typeof schema.organizations)
    .where(eq(idCol, id))
    .limit(1);

  const existingData =
    (existing?.enrichmentData as Record<string, unknown>) || {};

  const merged: Record<string, unknown> = { ...existingData };
  for (const [key, value] of Object.entries(newData)) {
    if (key === "errors") {
      const existingErrors = (existingData.errors as string[]) || [];
      const newErrors = (value as string[]) || [];
      merged.errors = [...new Set([...existingErrors, ...newErrors])];
      continue;
    }
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }

  await adminDb
    .update(tbl as typeof schema.organizations)
    .set({
      enrichmentData: merged,
      enrichmentStatus: status,
      lastEnrichedAt:
        status === "enriched" ? new Date() : undefined,
    })
    .where(eq(idCol, id));
}

/**
 * Check if a record needs re-enrichment based on last_enriched_at recency.
 * Returns true if enrichment should be skipped (data is fresh).
 */
export async function isRecentlyEnriched(
  table: "organizations" | "people",
  id: string,
  maxAgeDays: number = 7,
): Promise<boolean> {
  const tbl =
    table === "organizations" ? schema.organizations : schema.people;
  const idCol = table === "organizations" ? schema.organizations.id : schema.people.id;

  const [data] = await adminDb
    .select({ enrichmentData: (tbl as typeof schema.organizations).enrichmentData })
    .from(tbl as typeof schema.organizations)
    .where(eq(idCol, id))
    .limit(1);

  if (!data) return false;

  const enrichmentData = data.enrichmentData as Record<string, unknown> | null;
  const enrichedAt = enrichmentData?.enrichedAt as string | undefined;
  if (!enrichedAt) return false;

  const age = Date.now() - new Date(enrichedAt).getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return age < maxAgeMs;
}
