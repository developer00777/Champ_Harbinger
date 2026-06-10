import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { getDiscoveryProvider } from "@/lib/discovery";
import { db, schema } from "@/db";

export const maxDuration = 60;

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const body = (await request.json()) as {
    icp?: string;
    industry?: string;
    location?: string;
    size?: string;
  };

  if (!body.icp) {
    return NextResponse.json({ error: "icp is required" }, { status: 400 });
  }

  // Build natural language criteria from ICP fields
  const criteriaParts = [
    body.icp,
    body.industry ? `industry: ${body.industry}` : "",
    body.location ? `location: ${body.location}` : "",
    body.size ? `company size: ${body.size} employees` : "",
  ].filter(Boolean);
  const criteria = criteriaParts.join(", ");

  const provider = await getDiscoveryProvider(ctx.userId);
  const verified = await provider.discoverCompanies(criteria, 20);

  const companies = verified
    .filter((co) => co.passes)
    .map((co) => ({
      name: co.name,
      domain: co.domain ?? null,
      url: co.website ?? null,
      description: co.description ?? null,
      score: co.funding_stage ? 7 : 5,
      score_reason:
        co.reason ??
        `${co.industry ?? "Company"} in ${co.location?.country ?? "unknown location"}`,
    }));

  // Persist discovered companies
  await Promise.allSettled(
    companies.map(async (co) => {
      if (!co.domain) return;
      const existing = await db.query.organizations.findFirst({
        where: (orgs, { eq }) => eq(orgs.domain, co.domain!),
        columns: { id: true },
      });
      if (!existing) {
        await db.insert(schema.organizations).values({
          name: co.name,
          domain: co.domain,
          url: co.url,
          description: co.description,
          source: "champiq_discover",
          enrichmentStatus: "pending",
        });
      }
    }),
  );

  return NextResponse.json({ companies });
}
