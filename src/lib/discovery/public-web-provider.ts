import { generateObjectLimited as generateObject } from "@/lib/ai/generate";
import { z } from "zod";

import { getClassificationModel } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { recordAiUsage } from "@/lib/ai/usage";
import { webSearch } from "@/lib/search/web-search";
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import { verifyCompanies, verifyPeople } from "@/lib/lakeb2b/verifier";
import type { Company, Person } from "@/lib/lakeb2b/schemas";
import { normalizeLinkedInUrl } from "@/lib/enrichment/providers/linkedinResolver";
import type { DiscoveryProvider } from "./types";

// Directories / social / aggregators that aren't a company's own site.
const AGGREGATOR_DOMAINS = [
  "linkedin.com",
  "crunchbase.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "wikipedia.org",
  "glassdoor.com",
  "indeed.com",
  "ycombinator.com",
  "reddit.com",
  "medium.com",
  "github.com",
  "youtube.com",
  "instagram.com",
  "bloomberg.com",
  "pitchbook.com",
  "g2.com",
  "capterra.com",
];

function registrableDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isAggregator(domain: string): boolean {
  return AGGREGATOR_DOMAINS.some(
    (a) => domain === a || domain.endsWith(`.${a}`),
  );
}

async function generateSearchQueries(
  criteria: string,
  clerkUserId?: string,
): Promise<string[]> {
  // NOTE: do not put array .min()/.max() here — they become JSON-schema
  // minItems/maxItems, which Anthropic/Bedrock structured output reject
  // ("For 'array' type, property 'maxItems' is not supported"). Keep the
  // count guidance in the prompt and enforce the cap in code below.
  const schema = z.object({
    queries: z.array(z.string()).describe("3 to 5 web search queries"),
  });
  const startedAt = Date.now();
  const result = await generateObject({
    model: await getClassificationModel(clerkUserId),
    schema,
    prompt: `Turn this prospecting criteria into 3-5 web search queries likely to surface the HOMEPAGES of companies that match it (not directories or listicles). Vary the angle (industry terms, location, product category).\n\nCriteria: ${criteria}`,
  });
  recordAiUsage(result, {
    operation: "discovery-query-gen",
    costModel: "haiku",
    modelLabel: Models.classification,
    startedAt,
  });
  return result.object.queries.filter((q) => q.trim()).slice(0, 5);
}

async function normalizeCompany(
  domain: string,
  text: string,
  criteria: string,
  clerkUserId?: string,
): Promise<Company | null> {
  const schema = z.object({
    isCompany: z.boolean(),
    name: z.string(),
    description: z.string().optional(),
    industry: z.string().optional(),
  });
  const startedAt = Date.now();
  try {
    const result = await generateObject({
      model: await getClassificationModel(clerkUserId),
      schema,
      prompt: `From this website's text, decide if it is a single company's own site (not a directory/blog/marketplace). If so, extract the company name, a one-line description, and its industry.\n\nCriteria context: ${criteria}\nDomain: ${domain}\n\nText:\n${text.slice(0, 6000)}`,
    });
    recordAiUsage(result, {
      operation: "discovery-normalize",
      costModel: "haiku",
      modelLabel: Models.classification,
      startedAt,
    });
    if (!result.object.isCompany || !result.object.name.trim()) return null;
    return {
      id: `web-${domain}`,
      name: result.object.name,
      domain,
      website: `https://${domain}`,
      description: result.object.description,
      industry: result.object.industry,
    } as Company;
  } catch {
    return null;
  }
}

/** Turn a linkedin slug ("jane-doe-1a2b") into a display name ("Jane Doe"). */
function slugToName(slug: string): string {
  return slug
    .replace(/-?[0-9a-f]{6,}$/i, "") // drop the trailing hash LinkedIn appends
    .replace(/-\d+$/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
}

/**
 * Best-effort parse of a person from a LinkedIn search hit. Search engines
 * render LinkedIn /in/ results as "First Last - Title - Company | LinkedIn",
 * which we split into name/title/company. Returns null for non-/in/ results
 * (company pages, posts) so only real people flow through.
 */
function parsePersonFromResult(r: {
  url?: string;
  title?: string;
  content?: string;
}): Person | null {
  if (!r.url) return null;
  const linkedin = normalizeLinkedInUrl(r.url);
  if (!linkedin) return null;
  const slug = linkedin.replace("https://www.linkedin.com/in/", "");

  const cleaned = (r.title ?? "").replace(/\s*[|·-]\s*LinkedIn.*$/i, "").trim();
  const segments = cleaned
    .split(/\s+[-–—|·]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const fullName = segments[0] || slugToName(slug);
  if (!fullName) return null;

  return {
    id: `web-${slug}`,
    full_name: fullName,
    title: segments[1] || undefined,
    company_name: segments[2] || undefined,
    linkedin_url: linkedin,
  } as Person;
}

async function generatePeopleSearchQueries(
  criteria: string,
  clerkUserId?: string,
): Promise<string[]> {
  const schema = z.object({
    queries: z.array(z.string()).describe("3 to 5 web search queries"),
  });
  const startedAt = Date.now();
  const result = await generateObject({
    model: await getClassificationModel(clerkUserId),
    schema,
    prompt: `Turn this prospecting criteria into 3-5 web search queries that surface INDIVIDUAL people's public LinkedIn profiles (linkedin.com/in/...) matching it. Include role/title terms and company or industry context; vary the angle.\n\nCriteria: ${criteria}`,
  });
  recordAiUsage(result, {
    operation: "discovery-people-query-gen",
    costModel: "haiku",
    modelLabel: Models.classification,
    startedAt,
  });
  return result.object.queries
    .filter((q) => q.trim())
    .map((q) =>
      /site:linkedin\.com\/in/i.test(q) ? q : `${q} site:linkedin.com/in`,
    )
    .slice(0, 5);
}

/**
 * Public-web discovery: LLM query-gen → SearXNG → dedupe to company domains →
 * extract each homepage → LLM-normalize into Company → ICP-verify (reusing the
 * same verifier as LakeB2B). Returns [] gracefully when SearXNG is unconfigured.
 *
 * People discovery is best-effort: it mines public LinkedIn /in/ search hits,
 * parses name/title/company from the result, dedupes, and ICP-verifies them.
 * Lower reliability than a keyed data provider, but it lets discovery work
 * without a LakeB2B key and composes additively with LakeB2B when both exist.
 */
/**
 * `clerkUserId` is REQUIRED for BYOK to work. Without it every LLM call falls
 * back to the server env key, so a key the user saved under Settings → Keys is
 * silently ignored. getDiscoveryProvider() already has the id — pass it.
 */
export function makePublicWebProvider(clerkUserId?: string): DiscoveryProvider {
  const extractor = new WebExtractionService();
  return {
    name: "public-web",
    async discoverCompanies(criteria, max) {
      const queries = await generateSearchQueries(criteria, clerkUserId);
      const seen = new Set<string>();
      const domains: string[] = [];
      const domainCap = max * 3;

      for (const q of queries) {
        const results = await webSearch(q, 10);
        for (const r of results) {
          const d = registrableDomain(r.url);
          if (!d || seen.has(d) || isAggregator(d)) continue;
          seen.add(d);
          domains.push(d);
        }
        if (domains.length >= domainCap) break;
      }

      const candidates: Company[] = [];
      for (const d of domains.slice(0, domainCap)) {
        if (candidates.length >= max) break;
        const ex = await extractor.extract(`https://${d}`, {
          includeMetadata: true,
        });
        if (!ex.success || ex.data.content.length < 100) continue;
        const company = await normalizeCompany(
          d,
          ex.data.content,
          criteria,
          clerkUserId,
        );
        if (company) candidates.push(company);
      }

      return verifyCompanies(candidates, criteria);
    },
    async discoverPeople(criteria, max) {
      const queries = await generatePeopleSearchQueries(criteria, clerkUserId);
      const seen = new Set<string>();
      const candidates: Person[] = [];
      const cap = max * 3;

      for (const q of queries) {
        const results = await webSearch(q, 10);
        for (const r of results) {
          const person = parsePersonFromResult(r);
          if (!person || !person.linkedin_url) continue;
          if (seen.has(person.linkedin_url)) continue;
          seen.add(person.linkedin_url);
          candidates.push(person);
        }
        if (candidates.length >= cap) break;
      }

      if (candidates.length === 0) return [];
      return verifyPeople(candidates.slice(0, cap), criteria);
    },
  };
}
