import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { getDiscoveryProvider } from "@/lib/discovery";
import { db, schema } from "@/db";

export const maxDuration = 60;

/** Companies requested when the caller doesn't specify. */
const DEFAULT_LIMIT = 200;
/** Upper bound so one request can't run the provider indefinitely. */
const MAX_LIMIT = 1000;

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
    limit?: number;
  };

  if (!body.icp) {
    return NextResponse.json({ error: "icp is required" }, { status: 400 });
  }

  // * Was a hard-coded 20. Now caller-controlled: the provider paginates the
  // * upstream API, so this is a real target rather than a single page.
  const limit = Math.min(
    Math.max(Number(body.limit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  // Build natural language criteria from ICP fields
  const criteriaParts = [
    body.icp,
    body.industry ? `industry: ${body.industry}` : "",
    body.location ? `location: ${body.location}` : "",
    body.size ? `company size: ${body.size} employees` : "",
  ].filter(Boolean);
  const criteria = criteriaParts.join(", ");

  const provider = await getDiscoveryProvider(ctx.userId);
  const usesMockData = (await provider.usesMockData?.()) ?? false;
  const verified = await provider.discoverCompanies(criteria, limit);

  // * The ICP verifier is deliberately strict and fails closed, so it can
  // * reject an entire batch (e.g. on a JSON parse error) and leave nothing.
  // * Mirror quick-start/discover's behaviour: if verification eliminated
  // * everything, fall back to the unverified rows rather than returning an
  // * empty list that looks like "no companies exist".
  const passing = verified.filter((co) => co.passes);
  const usable = passing.length > 0 ? passing : verified;

  const companies = usable.map((co) => ({
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

  return NextResponse.json({
    companies,
    // Never let fixture data pass for real leads — see DiscoveryProvider.usesMockData.
    ...(usesMockData
      ? {
          warning:
            "MOCK DATA — no LakeB2B key and no SEARXNG_URL configured. " +
            "These are built-in fixture companies, not real results.",
          mock: true,
        }
      : {}),
  });
}
