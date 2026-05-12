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

  type SearchResult = {
    title: string;
    url: string;
    publishedDate: string | null;
    author: string | null;
    text: string | null;
    summary: string | null;
  };

  // Seniority score based on title
  const seniorityScore = (() => {
    const t = (body.title ?? "").toLowerCase();
    if (/\b(ceo|cto|coo|cfo|founder|president)\b/.test(t)) return 9;
    if (/\bvp\b|vice president/.test(t)) return 7;
    if (/\bdirector\b/.test(t)) return 5;
    if (/\bmanager\b/.test(t)) return 3;
    return 2;
  })();

  // Run general search and LinkedIn search in parallel
  const [generalResult, linkedinResult] = await Promise.allSettled([
    exa.search(`"${body.name}" ${body.domain} ${body.title ?? ""}`.trim(), {
      numResults: 5,
      searchType: "neural",
      includeText: true,
    }),
    exa
      .search(`site:linkedin.com/in "${body.name}" ${body.domain}`, {
        numResults: 1,
        searchType: "neural",
      })
      .catch(() => ({ results: [] as SearchResult[] })),
  ]);

  const generalResults =
    generalResult.status === "fulfilled" ? generalResult.value.results : [];

  const allText = generalResults.map((r) => r.text ?? "").join(" ");

  // Try to find email — look in all result text
  const emailMatch = allText.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  );

  // Try to infer email from domain pattern if direct match found a company email
  let inferredEmail: string | null = null;
  if (!emailMatch) {
    // Look for any @domain.com pattern to infer the format
    const domainEmails = allText.match(
      new RegExp(`[a-zA-Z0-9._%+-]+@${body.domain.replace(/\./g, "\\.")}`, "g"),
    );
    if (domainEmails && domainEmails.length > 0) {
      // Try to infer pattern from examples: first.last@domain or f.last@domain
      const nameParts = body.name.toLowerCase().split(/\s+/);
      const firstName = nameParts[0] ?? "";
      const lastName = nameParts[nameParts.length - 1] ?? "";
      const sampleEmail = domainEmails[0];
      const sampleLocal = sampleEmail.split("@")[0] ?? "";

      // Detect pattern from sample
      if (sampleLocal.includes(".")) {
        // first.last or f.last style
        if (sampleLocal.split(".")[0]?.length === 1) {
          inferredEmail = `${firstName[0]}.${lastName}@${body.domain}`;
        } else {
          inferredEmail = `${firstName}.${lastName}@${body.domain}`;
        }
      } else {
        inferredEmail = `${firstName}${lastName}@${body.domain}`;
      }
    }
  }

  // LinkedIn URL
  const linkedinResults =
    linkedinResult.status === "fulfilled" ? linkedinResult.value.results : [];
  const linkedin_url = linkedinResults[0]?.url?.includes("linkedin")
    ? linkedinResults[0].url
    : null;

  return NextResponse.json({
    contact: {
      name: body.name,
      domain: body.domain,
      title: body.title ?? null,
      email: emailMatch?.[0] ?? inferredEmail ?? null,
      linkedin_url,
    },
    score: seniorityScore,
  });
}
