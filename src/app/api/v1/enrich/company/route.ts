import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { ExaService } from "@/lib/services/exa-service";
import { normalizeDomain } from "@/lib/services/knowledge-base";
import { getModelSync } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const body = (await request.json()) as { domain?: string };
  if (!body.domain) {
    return NextResponse.json({ error: "domain is required" }, { status: 400 });
  }

  const domain = normalizeDomain(body.domain);
  const exa = new ExaService();

  type SearchResult = {
    title: string;
    url: string;
    publishedDate: string | null;
    author: string | null;
    text: string | null;
    summary: string | null;
  };

  const [productResult, fundingResult, teamResult, contactsResult] =
    await Promise.allSettled([
      exa.search(`site:${domain} product features OR pricing OR integrations`, {
        numResults: 3,
        searchType: "neural",
        includeText: true,
      }),
      exa.search(`${domain} funding round OR investment OR Series`, {
        numResults: 3,
        searchType: "neural",
        includeText: true,
      }),
      exa.search(`site:${domain} team OR about OR leadership`, {
        numResults: 3,
        searchType: "neural",
        includeText: true,
      }),
      exa
        .search(`${domain} executive OR CEO OR VP OR Director OR Head Of`, {
          numResults: 5,
          searchType: "neural",
          category: "people",
          includeText: true,
        })
        .catch(() => ({ results: [] as SearchResult[] })),
    ]);

  const snippets = [productResult, fundingResult, teamResult]
    .flatMap((r) => (r.status === "fulfilled" ? r.value.results : []))
    .map((r) => r.text?.slice(0, 400) ?? r.summary?.slice(0, 400) ?? "")
    .filter(Boolean);

  const combinedText = snippets.join(" ");

  // Extract contacts from people search
  const contactsRaw =
    contactsResult.status === "fulfilled" ? contactsResult.value.results : [];

  const contacts = contactsRaw
    .flatMap((r) => {
      const name = r.title?.split(" - ")[0]?.split(" | ")[0]?.trim() ?? null;
      const emailMatch = r.text?.match(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      );
      if (!name) return [];
      return [
        {
          name,
          title: r.title ?? null,
          email: emailMatch?.[0] ?? null,
          linkedin_url: r.url?.includes("linkedin") ? r.url : null,
        },
      ];
    })
    .slice(0, 5);

  // LLM-based score + talking points
  const { object } = await generateObject({
    model: getModelSync(Models.cheap),
    schema: z.object({
      score: z.number().min(0).max(10),
      talking_points: z.array(z.string()).length(3),
    }),
    prompt: `Analyze this company from a sales perspective.
Domain: ${domain}
Description: ${combinedText.slice(0, 1000)}

Generate:
1. score (0-10): how likely they need outreach right now based on signals (hiring, funding, launches)
2. talking_points: exactly 3 specific, non-generic talking points for a sales opener`,
  });

  return NextResponse.json({
    company: { domain, description: snippets[0] ?? null },
    contacts,
    score: object.score,
    talking_points: object.talking_points,
  });
}
