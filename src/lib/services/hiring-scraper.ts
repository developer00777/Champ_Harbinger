import { generateObject, jsonSchema } from "ai";
import * as cheerio from "cheerio";
import { getModelSync as getModel } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { recordAiUsage } from "@/lib/ai/usage";
import {
  obscuraFetchHtml,
  isObscuraConfigured,
} from "@/lib/services/browser-pool";
import { mergeEnrichmentData } from "@/lib/services/knowledge-base";

export interface HiringScrapeResult {
  careersUrl: string | null;
  jobs: Array<{
    title: string;
    department?: string;
    location?: string;
    url?: string;
  }>;
  totalJobs: number;
}

const CAREERS_RE = /careers|jobs|hiring|join|work.?with.?us/i;

const COMMON_CAREERS_PATHS = [
  "/careers",
  "/jobs",
  "/hiring",
  "/work-with-us",
  "/join-us",
  "/about/careers",
  "/company/careers",
];

interface ExtractedJobs {
  jobs: Array<{
    title: string;
    department?: string;
    location?: string;
    url?: string;
  }>;
}

const jobsSchema = jsonSchema<ExtractedJobs>({
  type: "object",
  properties: {
    jobs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          department: { type: "string" },
          location: { type: "string" },
          url: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  required: ["jobs"],
  additionalProperties: false,
});

/**
 * Scrape a company's careers page using the self-hosted Obscura browser plus an
 * OpenRouter LLM for structured extraction. Finds the careers page without an
 * LLM (common-path probe + anchor scan), then runs ONE generateObject pass over
 * the page HTML to pull structured job listings, and saves the hiring data to
 * the organization's enrichment_data.
 *
 * Used by both the `scrapeJobListings` agent tool and the tracking run route.
 */
export async function scrapeHiringData(
  organizationId: string,
  domain: string,
  maxJobs: number = 20,
): Promise<HiringScrapeResult> {
  if (!isObscuraConfigured()) {
    return { careersUrl: null, jobs: [], totalJobs: 0 };
  }

  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  // Step 1: Fetch the company's homepage via Obscura (rendered HTML).
  let homeHtml = "";
  try {
    homeHtml = await obscuraFetchHtml(`https://${cleanDomain}`);
  } catch {
    // homepage unreachable -- still try common paths below
  }

  // Step 2: Find the careers page WITHOUT an LLM.
  let careersUrl: string | null = null;

  // 2a. Scan anchors on the homepage for a careers-like link.
  if (homeHtml) {
    const $ = cheerio.load(homeHtml);
    let candidate: string | null = null;
    $("a[href]").each((_, el) => {
      if (candidate) return;
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (CAREERS_RE.test(href) || CAREERS_RE.test(text)) {
        candidate = href;
      }
    });
    if (candidate) {
      try {
        const resolved = new URL(
          candidate,
          `https://${cleanDomain}`,
        ).toString();
        const html = await obscuraFetchHtml(resolved);
        if (html) {
          careersUrl = resolved;
        }
      } catch {
        // fall through to common-path probe
      }
    }
  }

  // 2b. Probe common careers paths if anchor scan didn't land one.
  if (!careersUrl) {
    for (const path of COMMON_CAREERS_PATHS) {
      const url = `https://${cleanDomain}${path}`;
      try {
        const html = await obscuraFetchHtml(url);
        if (html) {
          careersUrl = url;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (!careersUrl) {
    await mergeEnrichmentData("organizations", organizationId, {
      hiring: {
        careersUrl: null,
        jobs: [],
        scrapedAt: new Date().toISOString(),
      },
    });
    return { careersUrl: null, jobs: [], totalJobs: 0 };
  }

  // Step 3: Fetch the careers page HTML and extract job listings with ONE LLM pass.
  let careersHtml: string;
  try {
    careersHtml = await obscuraFetchHtml(careersUrl);
  } catch {
    await mergeEnrichmentData("organizations", organizationId, {
      hiring: {
        careersUrl,
        jobs: [],
        scrapedAt: new Date().toISOString(),
      },
    });
    return { careersUrl, jobs: [], totalJobs: 0 };
  }

  const startedAt = Date.now();
  const result = await generateObject({
    model: getModel(Models.classification),
    schema: jobsSchema,
    prompt: `Extract up to ${maxJobs} job listings from this careers/jobs page. For each job, capture: the title; the department or category (optional); the location (optional); and the direct URL to the job posting if present (optional). Ignore navigation, marketing copy, and benefits sections.\n\n---\n\n${careersHtml.slice(0, 30_000)}`,
  });

  recordAiUsage(result, {
    operation: "scrape-hiring-jobs",
    costModel: "haiku",
    modelLabel: Models.classification,
    startedAt,
    metadata: { careersUrl },
  });

  const allJobs = result.object.jobs ?? [];
  const trimmed = allJobs.slice(0, maxJobs);

  // Step 4: Save hiring data to the organization
  await mergeEnrichmentData("organizations", organizationId, {
    hiring: {
      careersUrl,
      jobs: trimmed,
      scrapedAt: new Date().toISOString(),
    },
  });

  return { careersUrl, jobs: trimmed, totalJobs: allJobs.length };
}
