import { withAction } from "@/lib/services/cost-tracker";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import { XService } from "@/lib/services/x-service";
import { enrichContact as runWaterfall } from "@/lib/enrichment/engine";
import {
  mergeEnrichmentData,
  isRecentlyEnriched,
} from "@/lib/services/knowledge-base";

export const maxDuration = 120;

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { contactId } = body as { contactId: string };
  if (!contactId) {
    return Response.json({ error: "contactId is required" }, { status: 400 });
  }

  // contactId may be a campaign_people link ID -- resolve to person.
  // Ownership check: verify the parent campaign belongs to the signed-in user.
  let personId: string;

  const [link] = await adminDb
    .select({
      personId: schema.campaignPeople.personId,
      campaignClerkUserId: schema.campaigns.clerkUserId,
    })
    .from(schema.campaignPeople)
    .innerJoin(
      schema.campaigns,
      eq(schema.campaignPeople.campaignId, schema.campaigns.id),
    )
    .where(eq(schema.campaignPeople.id, contactId))
    .limit(1);

  if (link) {
    if (link.campaignClerkUserId !== userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    personId = link.personId;
  } else {
    // Bare person ID path -- no user-scoping available without a campaign
    // context; the subsequent select is the only gate we have here.
    personId = contactId;
  }

  const [personRow] = await adminDb
    .select({
      name: schema.people.name,
      title: schema.people.title,
      linkedinUrl: schema.people.linkedinUrl,
      twitterUrl: schema.people.twitterUrl,
      enrichmentData: schema.people.enrichmentData,
      orgName: schema.organizations.name,
      orgDomain: schema.organizations.domain,
    })
    .from(schema.people)
    .leftJoin(
      schema.organizations,
      eq(schema.people.organizationId, schema.organizations.id),
    )
    .where(eq(schema.people.id, personId))
    .limit(1);

  if (!personRow) {
    return Response.json({ error: "Contact not found" }, { status: 404 });
  }

  // Check recency
  const recent = await isRecentlyEnriched("people", personId);
  if (recent) {
    const [p] = await adminDb
      .select({ enrichmentData: schema.people.enrichmentData })
      .from(schema.people)
      .where(eq(schema.people.id, personId))
      .limit(1);
    return Response.json({
      contactId: personId,
      status: "enriched",
      enrichmentData: p?.enrichmentData || {},
      skipped: true,
    });
  }

  const contactName = personRow.name || "Unknown";
  const companyName = personRow.orgName || null;
  const actionLabel = companyName
    ? `Enrich person: ${contactName} (${companyName})`
    : `Enrich person: ${contactName}`;

  return withAction(actionLabel, async () => {
    // Mark as in_progress
    await adminDb
      .update(schema.people)
      .set({ enrichmentStatus: "in_progress" })
      .where(eq(schema.people.id, personId));

    const errors: string[] = [];

    // LinkedIn + company-web + LakeB2B via the provenance-aware waterfall. It
    // resolves/scrapes the public LinkedIn profile, runs LakeB2B as the pinned
    // primary, merges by confidence/recency, and syncs an ADDITIVE,
    // source-namespaced enrichment_data (enrichment_data.linkedin / .lakeb2b /
    // .provenance) back into this person — LakeB2B and LinkedIn never clobber.
    try {
      await runWaterfall({
        name: personRow.name ?? null,
        company: personRow.orgName ?? null,
        domain: personRow.orgDomain ?? null,
        linkedin: personRow.linkedinUrl ?? null,
        clerkUserId: userId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[enrich API] Waterfall enrichment failed: ${msg}`);
      errors.push(`Enrichment: ${msg}`);
    }

    // Twitter/X is not part of the owned waterfall; enrich + merge separately
    // (additive: it lands under enrichment_data.twitter).
    if (personRow.twitterUrl) {
      try {
        const x = new XService();
        const result = await x.enrichTwitterProfile(personRow.twitterUrl);
        await mergeEnrichmentData("people", personId, {
          twitter: {
            user: result.user,
            tweets: result.tweets.slice(0, 10),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[enrich API] Twitter enrich failed: ${msg}`);
        errors.push(`Twitter: ${msg}`);
      }
    }

    const [after] = await adminDb
      .select({ enrichmentData: schema.people.enrichmentData })
      .from(schema.people)
      .where(eq(schema.people.id, personId))
      .limit(1);
    const enrichmentData =
      (after?.enrichmentData as Record<string, unknown>) || {};
    const status =
      Object.keys(enrichmentData).length > 0 ? "enriched" : "failed";

    if (status === "failed") {
      await adminDb
        .update(schema.people)
        .set({ enrichmentStatus: "failed" })
        .where(eq(schema.people.id, personId));
    }

    return Response.json({
      contactId: personId,
      status,
      enrichmentData,
      errors: errors.length > 0 ? errors : undefined,
    });
  }); // end withAction
}
