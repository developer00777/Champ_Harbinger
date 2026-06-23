import { NextResponse } from "next/server";
import { generateObjectLimited as generateObject } from "@/lib/ai/generate";
import { z } from "zod";
import { validateApiKey } from "@/lib/api/validate-api-key";
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

  // Fetch the company homepage for enrichment data
  let combinedText = "";
  try {
    const res = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ChampHarbinger/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    combinedText = await res.text();
    // Strip HTML tags for text content
    combinedText = combinedText
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 2000);
  } catch {
    combinedText = `Company at ${domain}`;
  }
  const contacts: Array<{
    name: string;
    title: string | null;
    email: string | null;
    linkedin_url: string | null;
  }> = [];

  // LLM-based score + talking points
  const { object } = await generateObject({
    model: getModelSync(Models.cheap),
    schema: z.object({
      score: z.number().min(0).max(10),
      // No array .length()/.min()/.max() — they become JSON-schema
      // minItems/maxItems, which Anthropic/Bedrock structured output reject.
      // The prompt asks for exactly 3; we clamp in code below.
      talking_points: z.array(z.string()).describe("exactly 3 talking points"),
    }),
    prompt: `Analyze this company from a sales perspective.
Domain: ${domain}
Description: ${combinedText.slice(0, 1000)}

Generate:
1. score (0-10): how likely they need outreach right now based on signals (hiring, funding, launches)
2. talking_points: exactly 3 specific, non-generic talking points for a sales opener`,
  });

  return NextResponse.json({
    company: { domain, description: combinedText.slice(0, 300) || null },
    contacts,
    score: object.score,
    talking_points: object.talking_points.slice(0, 3),
  });
}
