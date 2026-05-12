import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [campaignRows, orgRows, peopleRows] = await Promise.all([
    sdb.raw
      .select()
      .from(schema.campaigns)
      .where(and(eq(schema.campaigns.id, id), sdb.scope(schema.campaigns)))
      .limit(1),

    sdb.raw
      .select({
        co: schema.campaignOrganizations,
        org: schema.organizations,
      })
      .from(schema.campaignOrganizations)
      .innerJoin(
        schema.organizations,
        eq(
          schema.campaignOrganizations.organizationId,
          schema.organizations.id,
        ),
      )
      .where(eq(schema.campaignOrganizations.campaignId, id))
      .orderBy(desc(schema.campaignOrganizations.relevanceScore)),

    sdb.raw
      .select({
        cp: schema.campaignPeople,
        person: schema.people,
        org: schema.organizations,
      })
      .from(schema.campaignPeople)
      .innerJoin(
        schema.people,
        eq(schema.campaignPeople.personId, schema.people.id),
      )
      .leftJoin(
        schema.organizations,
        eq(schema.people.organizationId, schema.organizations.id),
      )
      .where(eq(schema.campaignPeople.campaignId, id))
      .orderBy(
        desc(schema.campaignPeople.priorityScore),
        asc(schema.campaignPeople.createdAt),
      ),
  ]);

  if (!campaignRows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const campaign = campaignRows[0];

  const companies = orgRows.map(({ co, org }) => ({
    id: co.id,
    organization_id: co.organizationId,
    campaign_id: co.campaignId,
    name: org.name,
    domain: org.domain,
    url: org.url,
    industry: org.industry,
    location: org.location,
    description: org.description,
    relevance_score: co.relevanceScore ? Number(co.relevanceScore) : null,
    score_reason: co.scoreReason,
    status: co.status as "discovered" | "qualified" | "disqualified",
    readiness_tag: co.readinessTag as
      | "ready_to_contact"
      | "monitoring"
      | "not_ready"
      | null,
    enrichment_data: org.enrichmentData,
    source: org.source,
    created_at: co.createdAt.toISOString(),
    updated_at: co.updatedAt.toISOString(),
  }));

  const contacts = peopleRows.map(({ cp, person, org }) => ({
    id: cp.id,
    person_id: cp.personId,
    campaign_id: cp.campaignId,
    organization_id: person.organizationId ?? null,
    name: person.name,
    title: person.title,
    work_email: person.workEmail,
    personal_email: person.personalEmail,
    work_email_verified_at: person.workEmailVerifiedAt?.toISOString() ?? null,
    personal_email_verified_at:
      person.personalEmailVerifiedAt?.toISOString() ?? null,
    linkedin_url: person.linkedinUrl,
    twitter_url: person.twitterUrl,
    enrichment_status: person.enrichmentStatus as
      | "pending"
      | "in_progress"
      | "enriched"
      | "failed",
    enrichment_data: person.enrichmentData,
    outreach_status: cp.outreachStatus as
      | "not_contacted"
      | "queued"
      | "sent"
      | "delivered"
      | "opened"
      | "clicked"
      | "replied"
      | "bounced"
      | "complained",
    priority_score: cp.priorityScore ? Number(cp.priorityScore) : null,
    score_reason: cp.scoreReason,
    readiness_tag: cp.readinessTag as
      | "ready_to_contact"
      | "monitoring"
      | "not_ready"
      | null,
    source: person.source,
    created_at: cp.createdAt.toISOString(),
    updated_at: cp.updatedAt.toISOString(),
    company: org
      ? { name: org.name, domain: org.domain, industry: org.industry }
      : null,
  }));

  const campaignOut = {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    profile_id: campaign.profileId ?? null,
    icp: campaign.icp,
    offering: campaign.offering,
    positioning: campaign.positioning,
    search_criteria: campaign.searchCriteria,
    notes: campaign.notes ?? null,
    created_at: campaign.createdAt.toISOString(),
    updated_at: campaign.updatedAt.toISOString(),
  };

  return NextResponse.json({ campaign: campaignOut, companies, contacts });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;

  const patch: Partial<typeof schema.campaigns.$inferInsert> = {};
  if ("profile_id" in body) {
    patch.profileId = (body.profile_id as string | null) ?? null;
  }

  const updated = await sdb.raw
    .update(schema.campaigns)
    .set(patch)
    .where(and(eq(schema.campaigns.id, id), sdb.scope(schema.campaigns)))
    .returning();

  if (!updated[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await sdb.raw
    .delete(schema.campaigns)
    .where(and(eq(schema.campaigns.id, id), sdb.scope(schema.campaigns)));

  return NextResponse.json({ ok: true });
}
