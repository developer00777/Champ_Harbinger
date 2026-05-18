import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";

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

  // Seniority score based on title
  const seniorityScore = (() => {
    const t = (body.title ?? "").toLowerCase();
    if (/\b(ceo|cto|coo|cfo|founder|president)\b/.test(t)) return 9;
    if (/\bvp\b|vice president/.test(t)) return 7;
    if (/\bdirector\b/.test(t)) return 5;
    if (/\bmanager\b/.test(t)) return 3;
    return 2;
  })();

  return NextResponse.json({
    contact: {
      name: body.name,
      domain: body.domain,
      title: body.title ?? null,
      email: null,
      linkedin_url: null,
    },
    score: seniorityScore,
  });
}
