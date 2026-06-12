import { generateObject } from "ai";
import { z } from "zod";

import { getModelSync } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { recordAiUsage } from "@/lib/ai/usage";
import { searxSearch } from "@/lib/search/searxng-client";
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import type { GoogleReviewsResult } from "@/lib/services/google-places-service";

/**
 * Self-hosted, open-source replacement for the Google Places reviews enricher.
 * Finds public review pages (Trustpilot, G2, Glassdoor, etc.) via SearXNG,
 * fetches them through the extraction stack (Obscura/Trafilatura), and LLM-
 * extracts a normalized rating + review highlights. Returns the same
 * GoogleReviewsResult shape so it's a drop-in for getPlaceReviews.
 *
 * No API key, no metered SaaS — only OpenRouter + the self-hosted services.
 */

const REVIEW_DOMAINS = [
  "trustpilot.com",
  "g2.com",
  "capterra.com",
  "glassdoor.com",
  "yelp.com",
  "sitejabber.com",
  "trustradius.com",
  "getapp.com",
  "producthunt.com",
];

function notFound(): GoogleReviewsResult {
  return {
    found: false,
    placeId: null,
    displayName: null,
    rating: null,
    userRatingCount: 0,
    formattedAddress: null,
    googleMapsUri: null,
    websiteUri: null,
    reviews: [],
  };
}

function isReviewSite(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return REVIEW_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function getWebReviews(
  companyName: string,
  _location?: string,
  domain?: string,
): Promise<GoogleReviewsResult> {
  // 1) Find review-site pages for the company.
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const q of [
    `${companyName} reviews`,
    `${companyName} trustpilot g2 glassdoor reviews`,
  ]) {
    for (const r of await searxSearch(q, 10)) {
      if (isReviewSite(r.url) && !seen.has(r.url)) {
        seen.add(r.url);
        candidates.push(r.url);
      }
    }
    if (candidates.length >= 3) break;
  }
  if (candidates.length === 0) return notFound();

  // 2) Fetch the top couple of pages.
  const extractor = new WebExtractionService();
  let content = "";
  let sourceUrl: string | null = null;
  for (const url of candidates.slice(0, 2)) {
    const ex = await extractor.extract(url, { timeout: 12000 });
    if (ex.success && ex.data.content.length > 200) {
      content += `\n--- ${url} ---\n${ex.data.content.slice(0, 6000)}`;
      sourceUrl = sourceUrl ?? url;
    }
  }
  if (!content.trim()) return notFound();

  // 3) LLM-extract a normalized rating + a few reviews.
  const startedAt = Date.now();
  try {
    const result = await generateObject({
      model: getModelSync(Models.classification),
      schema: z.object({
        found: z
          .boolean()
          .describe("Whether these pages are reviews of the target company"),
        rating: z
          .number()
          .nullable()
          .describe("Average rating normalized to a 0-5 scale"),
        reviewCount: z.number().nullable().describe("Total number of reviews"),
        reviews: z
          .array(
            z.object({
              authorName: z.string().nullable(),
              rating: z.number().nullable(),
              text: z.string(),
            }),
          )
          .max(5),
      }),
      prompt: `Summarize the customer reviews of "${companyName}" from these review-site pages. Normalize the average rating to a 0-5 scale. Pull up to 5 representative review snippets. If the pages are NOT reviews of ${companyName}, set found=false.\n\n${content.slice(0, 12000)}`,
    });
    recordAiUsage(result, {
      operation: "web-reviews-extract",
      costModel: "haiku",
      modelLabel: Models.classification,
      startedAt,
      metadata: { company: companyName, source: sourceUrl },
    });

    const o = result.object;
    if (!o.found || o.rating == null) return notFound();
    return {
      found: true,
      placeId: null,
      displayName: companyName,
      rating: o.rating,
      userRatingCount: o.reviewCount ?? 0,
      formattedAddress: null,
      googleMapsUri: sourceUrl, // "where the reviews live" — a review-site URL
      websiteUri: domain ? `https://${domain}` : null,
      reviews: o.reviews.map((r) => ({
        authorName: r.authorName ?? "Reviewer",
        rating: r.rating ?? 0,
        text: r.text,
        relativePublishTime: "",
      })),
    };
  } catch {
    return notFound();
  }
}
