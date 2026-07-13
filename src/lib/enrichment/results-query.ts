import "server-only";
import { and, desc, eq, gte, inArray, type SQL } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import type { FieldCell, ResultRecord } from "./results-export";

/**
 * Read the persisted waterfall results (enrichment_contacts + per-field
 * provenance) for the Results screen and the CSV export. User-scoped; optionally
 * filtered to one campaign's people and/or a minimum completeness. Returns the
 * full provenance-bearing record so the list view and the export share one query.
 */

export interface FetchResultsInput {
  clerkUserId: string;
  campaignId?: string | null;
  minCompleteness?: number | null;
  limit?: number;
}

export interface ResultRow extends ResultRecord {
  contactId: string;
  email: string | null;
  title: string | null;
  phone: string | null;
  seniority: string | null;
  linkedin: string | null;
  updatedAt: Date | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchResults(
  input: FetchResultsInput,
): Promise<ResultRow[]> {
  const conds: SQL[] = [
    eq(schema.enrichmentContacts.clerkUserId, input.clerkUserId),
  ];

  if (input.minCompleteness != null) {
    conds.push(
      gte(
        schema.enrichmentContacts.completenessScore,
        String(input.minCompleteness),
      ),
    );
  }

  if (input.campaignId) {
    const people = await adminDb
      .select({ personId: schema.campaignPeople.personId })
      .from(schema.campaignPeople)
      .where(eq(schema.campaignPeople.campaignId, input.campaignId));
    const personIds = people.map((p) => p.personId).filter(Boolean);
    if (personIds.length === 0) return [];
    conds.push(inArray(schema.enrichmentContacts.externalRef, personIds));
  }

  const contacts = await adminDb
    .select({
      contactId: schema.enrichmentContacts.id,
      fullName: schema.enrichmentContacts.fullName,
      company: schema.enrichmentContacts.company,
      domain: schema.enrichmentContacts.domain,
      email: schema.enrichmentContacts.email,
      phone: schema.enrichmentContacts.phone,
      title: schema.enrichmentContacts.title,
      seniority: schema.enrichmentContacts.seniority,
      linkedin: schema.enrichmentContacts.linkedin,
      completenessScore: schema.enrichmentContacts.completenessScore,
      confidenceScore: schema.enrichmentContacts.confidenceScore,
      status: schema.enrichmentContacts.status,
      updatedAt: schema.enrichmentContacts.updatedAt,
    })
    .from(schema.enrichmentContacts)
    .where(and(...conds))
    .orderBy(desc(schema.enrichmentContacts.updatedAt))
    .limit(input.limit ?? 500);

  if (contacts.length === 0) return [];

  const ids = contacts.map((c) => c.contactId);
  const prov = await adminDb
    .select({
      contactId: schema.enrichmentFieldProvenance.contactId,
      field: schema.enrichmentFieldProvenance.field,
      value: schema.enrichmentFieldProvenance.value,
      source: schema.enrichmentFieldProvenance.source,
      confidence: schema.enrichmentFieldProvenance.confidence,
      verified: schema.enrichmentFieldProvenance.verified,
    })
    .from(schema.enrichmentFieldProvenance)
    .where(inArray(schema.enrichmentFieldProvenance.contactId, ids));

  const byContact = new Map<string, Record<string, FieldCell>>();
  for (const p of prov) {
    const map = byContact.get(p.contactId) ?? {};
    map[p.field] = {
      value: p.value,
      source: p.source,
      confidence: num(p.confidence),
      verified: Boolean(p.verified),
    };
    byContact.set(p.contactId, map);
  }

  return contacts.map((c) => ({
    contactId: c.contactId,
    name: c.fullName,
    company: c.company,
    domain: c.domain,
    email: c.email,
    phone: c.phone,
    title: c.title,
    seniority: c.seniority,
    linkedin: c.linkedin,
    status: c.status,
    completenessScore: num(c.completenessScore),
    confidenceScore: num(c.confidenceScore),
    fields: byContact.get(c.contactId) ?? {},
    updatedAt: c.updatedAt,
  }));
}
