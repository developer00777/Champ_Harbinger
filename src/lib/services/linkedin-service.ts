import * as cheerio from "cheerio";
import {
  obscuraFetchHtml,
  isObscuraConfigured,
} from "@/lib/services/browser-pool";
import {
  brightDataFetchHtml,
  isBrightDataConfigured,
} from "@/lib/services/brightdata-client";

export interface LinkedInPost {
  id: string;
  text: string;
  url: string;
  created_at: string;
  likes: number;
  comments: number;
  reposts: number;
  is_repost: boolean;
}

export interface LinkedInProfile {
  username: string;
  name: string;
  headline: string;
  /**
   * Cleaned, readable text of the rendered public profile (about, experience,
   * education, activity — whatever the unauthenticated page exposes). Passed to
   * the LLM extractor for structured personalization fields rather than parsed
   * with brittle selectors. Absent when the page rendered no usable body.
   */
  rawText?: string;
}

export interface LinkedInScrapeResult {
  profile: LinkedInProfile | null;
  posts: LinkedInPost[];
}

function cleanLinkedInUsername(input: string): string {
  return input
    .replace(/^@/, "")
    .replace(/.*linkedin\.com\/in\//, "")
    .replace(/.*linkedin\.com\/company\//, "")
    .replace(/\/$/, "")
    .replace(/\?.*$/, "");
}

/**
 * Parse rendered LinkedIn profile HTML into a profile + body text, or null when
 * the page is empty or an auth/login wall. Pure — no network. Shared by every
 * retrieval source so the parsing (and blocked-detection) lives in one place.
 */
function parseProfileHtml(
  html: string,
  username: string,
): LinkedInScrapeResult | null {
  if (!html) return null;

  const $ = cheerio.load(html);
  // Drop non-content nodes before reading name/headline or body text.
  $("script, style, noscript, template").remove();

  const name = $("h1").first().text().trim();
  const headline = $(
    '[class*="headline"], [data-test*="headline"], .top-card-layout__headline',
  )
    .first()
    .text()
    .trim();

  // LinkedIn auth walls render generic titles with no real name; treat those as
  // "blocked" so the caller can try the next source.
  if (!name || /sign in|join linkedin|log in/i.test(name)) {
    return null;
  }

  // Cleaned body text for the LLM extractor. Prefer the main content region when
  // present; fall back to the whole body. Collapse whitespace so the model reads
  // dense, low-noise text.
  const bodyText = ($("main").text() || $("body").text() || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const rawText = bodyText ? bodyText.slice(0, 12000) : undefined;

  // Unauthenticated profile pages don't expose post feeds; return profile (with
  // rich body text) and an empty posts array.
  return { profile: { username, name, headline, rawText }, posts: [] };
}

interface ProfileSource {
  name: string;
  fetchHtml: (url: string) => Promise<string>;
}

export class LinkedinService {
  extractUsername(linkedinUrl: string): string {
    return cleanLinkedInUsername(linkedinUrl);
  }

  /**
   * Best-effort fetch of a public LinkedIn profile. Retrieval is tried source by
   * source, in order: Bright Data Web Unlocker first (residential IPs, gets past
   * the auth wall), then the self-hosted Obscura browser as a fallback. The HTML
   * is parsed in-house — only the public profile URL ever leaves.
   *
   * LinkedIn aggressively blocks unauthenticated access, so this can still return
   * empty when no source is configured or all are blocked. It NEVER throws —
   * callers get the same `{ profile, posts }` shape with empty arrays.
   */
  async scrapeProfile(linkedinUrl: string): Promise<LinkedInScrapeResult> {
    const username = cleanLinkedInUsername(linkedinUrl);
    const profileUrl = `https://www.linkedin.com/in/${username}/`;

    const sources: ProfileSource[] = [];
    if (isBrightDataConfigured()) {
      sources.push({ name: "brightdata", fetchHtml: brightDataFetchHtml });
    }
    if (isObscuraConfigured()) {
      sources.push({ name: "obscura", fetchHtml: obscuraFetchHtml });
    }
    if (sources.length === 0) {
      return { profile: null, posts: [] };
    }

    for (const source of sources) {
      console.log(
        `[LinkedIn] Attempting fetch via ${source.name}: ${profileUrl}`,
      );
      try {
        const html = await source.fetchHtml(profileUrl);
        const parsed = parseProfileHtml(html, username);
        if (parsed) return parsed;
        console.log(
          `[LinkedIn] ${source.name} returned no usable profile (blocked/empty); trying next source.`,
        );
      } catch (err) {
        console.warn(
          `[LinkedIn] ${source.name} fetch failed (expected when blocked): ${
            err instanceof Error ? err.message : "unknown"
          }`,
        );
      }
    }

    return { profile: null, posts: [] };
  }
}
