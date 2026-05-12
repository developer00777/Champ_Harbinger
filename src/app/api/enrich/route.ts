import { withAction } from "@/lib/services/cost-tracker";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import { ExaService } from "@/lib/services/exa-service";
import { LinkedinService } from "@/lib/services/linkedin-service";
import { XService } from "@/lib/services/x-service";
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

    const enrichmentData: Record<string, unknown> = {};
    const errors: string[] = [];
    const promises: Promise<void>[] = [];

    if (personRow.linkedinUrl) {
      promises.push(
        (async () => {
          try {
            const linkedin = new LinkedinService();
            const scrapeResult = await linkedin.scrapeProfile(
              personRow.linkedinUrl!,
            );
            enrichmentData.linkedin = {
              profileInfo: scrapeResult.profile || null,
              posts: scrapeResult.posts.slice(0, 10),
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error(`[enrich API] LinkedIn scrape failed: ${msg}`);
            errors.push(`LinkedIn: ${msg}`);
          }
        })(),
      );
    }

    if (personRow.twitterUrl) {
      promises.push(
        (async () => {
          try {
            const x = new XService();
            const result = await x.enrichTwitterProfile(personRow.twitterUrl!);
            enrichmentData.twitter = {
              user: result.user,
              tweets: result.tweets.slice(0, 10),
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error(`[enrich API] Twitter enrich failed: ${msg}`);
            errors.push(`Twitter: ${msg}`);
          }
        })(),
      );
    }

    // Exa web searches for the person
    if (contactName !== "Unknown") {
      const exa = new ExaService();

      const contactTitle = personRow.title || null;
      const queryParts = [`"${contactName}"`];
      if (companyName) queryParts.push(`"${companyName}"`);
      if (contactTitle) queryParts.push(contactTitle);
      const specificQuery = queryParts.join(" ");

      // Collect URLs already in the company's enrichment data so we don't
      // show the same links on both the company and contact cards.
      const companyUrls = new Set<string>();
      if (companyName) {
        const [orgRow] = await adminDb
          .select({ enrichmentData: schema.organizations.enrichmentData })
          .from(schema.organizations)
          .where(eq(schema.organizations.name, companyName))
          .limit(1);

        const orgEnrichment = orgRow?.enrichmentData as Record<
          string,
          unknown
        > | null;
        if (orgEnrichment) {
          const searches = orgEnrichment.searches as
            | Array<{ results: Array<{ url: string }> }>
            | undefined;
          if (searches) {
            for (const s of searches) {
              for (const r of s.results) {
                if (r.url) companyUrls.add(r.url);
              }
            }
          }
        }
      }

      const dedup = (
        results: Array<{
          title: string;
          url: string;
          publishedDate: string | null;
          text: string | null;
        }>,
      ) => results.filter((r) => !companyUrls.has(r.url));

      promises.push(
        (async () => {
          try {
            const result = await exa.search(
              `${specificQuery} news announcement`,
              { numResults: 3, includeText: true, category: "news" },
            );
            enrichmentData.news = dedup(
              result.results.map((r) => ({
                title: r.title,
                url: r.url,
                publishedDate: r.publishedDate,
                text: r.text || null,
              })),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`News: ${msg}`);
          }
        })(),
      );

      promises.push(
        (async () => {
          try {
            const result = await exa.search(
              `${specificQuery} article talk interview podcast`,
              { numResults: 3, includeText: true },
            );
            enrichmentData.articles = dedup(
              result.results.map((r) => ({
                title: r.title,
                url: r.url,
                publishedDate: r.publishedDate,
                text: r.text || null,
              })),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`Articles: ${msg}`);
          }
        })(),
      );

      promises.push(
        (async () => {
          try {
            const result = await exa.search(
              `${specificQuery} background bio profile`,
              { numResults: 3, includeText: true },
            );
            enrichmentData.background = dedup(
              result.results.map((r) => ({
                title: r.title,
                url: r.url,
                publishedDate: r.publishedDate,
                text: r.text || null,
              })),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`Background: ${msg}`);
          }
        })(),
      );
    }

    if (promises.length === 0) {
      await adminDb
        .update(schema.people)
        .set({ enrichmentStatus: "failed" })
        .where(eq(schema.people.id, personId));

      return Response.json({
        contactId: personId,
        status: "failed",
        errors: ["No enrichment sources available"],
      });
    }

    await Promise.all(promises);

    const status =
      Object.keys(enrichmentData).length > 0 ? "enriched" : "failed";

    await mergeEnrichmentData(
      "people",
      personId,
      enrichmentData,
      status as "enriched" | "failed",
    );

    return Response.json({
      contactId: personId,
      status,
      enrichmentData,
      errors: errors.length > 0 ? errors : undefined,
    });
  }); // end withAction
}
