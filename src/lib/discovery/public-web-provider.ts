import { generateObjectLimited as generateObject } from "@/lib/ai/generate";
import { z } from "zod";

import { getModelSync } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { recordAiUsage } from "@/lib/ai/usage";
import { searxSearch } from "@/lib/search/searxng-client";
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import { verifyCompanies } from "@/lib/lakeb2b/verifier";
import type { Company } from "@/lib/lakeb2b/schemas";
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

async function generateSearchQueries(criteria: string): Promise<string[]> {
  // NOTE: do not put array .min()/.max() here — they become JSON-schema
  // minItems/maxItems, which Anthropic/Bedrock structured output reject
  // ("For 'array' type, property 'maxItems' is not supported"). Keep the
  // count guidance in the prompt and enforce the cap in code below.
  const schema = z.object({
    queries: z.array(z.string()).describe("3 to 5 web search queries"),
  });
  const startedAt = Date.now();
  const result = await generateObject({
    model: getModelSync(Models.classification),
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
      model: getModelSync(Models.classification),
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

/**
 * Public-web discovery: LLM query-gen → SearXNG → dedupe to company domains →
 * extract each homepage → LLM-normalize into Company → ICP-verify (reusing the
 * same verifier as LakeB2B). Returns [] gracefully when SearXNG is unconfigured.
 *
 * People discovery from public web is unreliable without authenticated profile
 * access, so discoverPeople returns [] (LakeB2B is the people path when keyed).
 */
export function makePublicWebProvider(): DiscoveryProvider {
  const extractor = new WebExtractionService();
  return {
    name: "public-web",
    async discoverCompanies(criteria, max) {
      const queries = await generateSearchQueries(criteria);
      const seen = new Set<string>();
      const domains: string[] = [];
      const domainCap = max * 3;

      for (const q of queries) {
        const results = await searxSearch(q, 10);
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
        const company = await normalizeCompany(d, ex.data.content, criteria);
        if (company) candidates.push(company);
      }

      return verifyCompanies(candidates, criteria);
    },
    async discoverPeople() {
      return [];
    },
  };
}
