import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { ExaService } from "@/lib/services/exa-service";
import { normalizeDomain } from "@/lib/services/knowledge-base";

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

  const [productResult, fundingResult, teamResult] = await Promise.allSettled([
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
  ]);

  const snippets = [productResult, fundingResult, teamResult]
    .flatMap((r) => (r.status === "fulfilled" ? r.value.results : []))
    .map((r) => r.text?.slice(0, 400) ?? r.summary?.slice(0, 400) ?? "")
    .filter(Boolean);

  const combinedText = snippets.join(" ");
  const talkingPoints: string[] = [];
  if (/series [a-e]/i.test(combinedText))
    talkingPoints.push("Recently raised funding");
  if (/hir(ing|ed)/i.test(combinedText)) talkingPoints.push("Actively hiring");
  if (/launch(ed|ing)/i.test(combinedText))
    talkingPoints.push("Recent product launch");

  return NextResponse.json({
    company: { domain, description: snippets[0] ?? null },
    contacts: [],
    score: null,
    talking_points: talkingPoints,
  });
}
