import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { ExaService } from "@/lib/services/exa-service";

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

  return NextResponse.json({ companies });
}
