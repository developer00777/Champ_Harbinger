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
    name?: string;
    domain?: string;
    title?: string;
  };

  if (!body.name || !body.domain) {
    return NextResponse.json(
      { error: "name and domain are required" },
      { status: 400 },
    );
  }

  const exa = new ExaService();
  const response = await exa.search(
    `"${body.name}" ${body.domain} ${body.title ?? ""}`.trim(),
    { numResults: 5, searchType: "neural", includeText: true },
  );

  const allText = response.results.map((r) => r.text ?? "").join(" ");
  const emailMatch = allText.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  );

  return NextResponse.json({
    contact: {
      name: body.name,
      domain: body.domain,
      title: body.title ?? null,
      email: emailMatch?.[0] ?? null,
      linkedin_url: null,
    },
    score: null,
  });
}
