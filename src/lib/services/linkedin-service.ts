import * as cheerio from "cheerio";
import {
  obscuraFetchHtml,
  isObscuraConfigured,
} from "@/lib/services/browser-pool";

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

export class LinkedinService {
  extractUsername(linkedinUrl: string): string {
    return cleanLinkedInUsername(linkedinUrl);
  }

  /**
   * Best-effort fetch of a public LinkedIn profile via the self-hosted Obscura
   * browser. LinkedIn aggressively blocks unauthenticated access, so this is
   * expected to return empty data in most cases. It NEVER throws — callers get
   * the same `{ profile, posts }` shape with empty arrays when blocked or when
   * Obscura is not configured.
   */
  async scrapeProfile(linkedinUrl: string): Promise<LinkedInScrapeResult> {
    const username = cleanLinkedInUsername(linkedinUrl);

    if (!isObscuraConfigured()) {
      return { profile: null, posts: [] };
    }

    const profileUrl = `https://www.linkedin.com/in/${username}/`;
    console.log(`[LinkedIn] Attempting public fetch: ${profileUrl}`);

    try {
      const html = await obscuraFetchHtml(profileUrl);

      // Empty render / blocked => return empty gracefully.
      if (!html) {
        return { profile: null, posts: [] };
      }

      const $ = cheerio.load(html);
      const name = $("h1").first().text().trim();
      const headline = $(
        '[class*="headline"], [data-test*="headline"], .top-card-layout__headline',
      )
        .first()
        .text()
        .trim();

      // LinkedIn auth walls render generic titles with no real name; treat
      // those as "blocked" and return an empty result.
      if (!name || /sign in|join linkedin|log in/i.test(name)) {
        return { profile: null, posts: [] };
      }

      const profile: LinkedInProfile = {
        username,
        name,
        headline,
      };

      // Unauthenticated profile pages don't expose post feeds; return profile
      // only with an empty posts array.
      return { profile, posts: [] };
    } catch (err) {
      console.warn(
        `[LinkedIn] Public fetch failed (expected when blocked): ${
          err instanceof Error ? err.message : "unknown"
        }`,
      );
      return { profile: null, posts: [] };
    }
  }
}
