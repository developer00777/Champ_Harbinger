import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { ExaService } from "@/lib/services/exa-service";
import { getModelSync } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { db, schema } from "@/db";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await validateApiKey(request);
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

  const queryParts = [
    body.icp,
    body.industry ? `industry: ${body.industry}` : "",
    body.location ? `location: ${body.location}` : "",
    body.size ? `${body.size} employees` : "",
  ].filter(Boolean);

  const exa = new ExaService();
  const response = await exa.search(queryParts.join(" "), {
    numResults: 20,
    searchType: "neural",
  });

  const companies = response.results.flatMap((r) => {
    try {
      return [
        {
          name: r.title ?? r.url,
          domain: new URL(r.url).hostname.replace(/^www\./, ""),
          url: r.url,
          description:
            r.text?.slice(0, 300) ?? r.summary?.slice(0, 300) ?? null,
        },
      ];
    } catch {
      return [];
    }
  });

  // ICP scoring: run all in parallel, then filter + sort
  const scored = await Promise.all(
    companies.map(async (co) => {
      const { object } = await generateObject({
        model: getModelSync(Models.classification),
        schema: z.object({
          score: z.number().min(0).max(10).describe("ICP match score 0-10"),
          reason: z.string().describe("One sentence explaining the score"),
        }),
        prompt: `Rate how well this company matches the ICP: "${body.icp}"
Company: ${co.name}
Description: ${co.description ?? "unknown"}
Domain: ${co.domain}

Score 0-10 where 10 = perfect ICP match. Be concise.`,
      });
      return { ...co, score: object.score, score_reason: object.reason };
    }),
  );

  const results = scored
    .filter((c) => c.score >= 4)
    .sort((a, b) => b.score - a.score);

  // Persist discovered companies to organizations for the API key owner
  await Promise.allSettled(
    results.map(async (co) => {
      // Upsert by domain — if already exists, skip
      const existing = await db.query.organizations.findFirst({
        where: (orgs, { eq }) => eq(orgs.domain, co.domain),
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

  return NextResponse.json({ companies: results });
}
