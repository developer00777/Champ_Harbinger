import * as cheerio from "cheerio";
import {
  obscuraFetchHtml,
  isObscuraConfigured,
} from "@/lib/services/browser-pool";

export interface XUser {
  id: string;
  username: string;
  name: string;
  description?: string;
  followers_count?: number;
  following_count?: number;
  tweet_count?: number;
  verified?: boolean;
  profile_image_url?: string;
}

export interface XTweet {
  id: string;
  text: string;
  created_at: string;
  url?: string;
  public_metrics?: {
    retweet_count?: number;
    like_count?: number;
    reply_count?: number;
    quote_count?: number;
    view_count?: number;
  };
  is_reply?: boolean;
  lang?: string;
}

export interface XEnrichment {
  url: string;
  username: string;
  user: XUser | null;
  tweets: XTweet[];
  totalTweets: number;
}

export class XService {
  extractUsername(twitterUrl: string): string {
    const cleaned = twitterUrl.trim().replace(/\/+$/, "");
    const match = cleaned.match(/(?:twitter\.com|x\.com)\/([^\/\?\s]+)/);
    if (!match || !match[1]) {
      const directMatch = cleaned.match(/^([^\/\?\s]+)$/);
      if (directMatch && directMatch[1]) return directMatch[1];
      throw new Error(`Invalid Twitter/X URL format: ${twitterUrl}`);
    }
    return match[1];
  }

  /**
   * Best-effort public fetch of an X/Twitter profile via the self-hosted
   * Obscura browser. X blocks most unauthenticated access, so this is expected
   * to return no tweets in most cases. It NEVER throws — callers get an empty
   * tweet array when blocked or when Obscura is not configured.
   */
  async getUserTweetsAndReplies(
    username: string,
  ): Promise<{ tweets: XTweet[]; rawResults: unknown[] }> {
    if (!isObscuraConfigured()) {
      return { tweets: [], rawResults: [] };
    }

    const profileUrl = `https://x.com/${username}`;
    console.log(`[X] Attempting public fetch: ${profileUrl}`);

    try {
      const html = await obscuraFetchHtml(profileUrl);

      // X requires auth for the timeline; we can only read public profile
      // meta tags when available. Tweets are not accessible unauthenticated.
      const meta = html
        ? (() => {
            const $ = cheerio.load(html);
            const ogTitle =
              $('meta[property="og:title"]').attr("content") || "";
            const ogDesc =
              $('meta[property="og:description"]').attr("content") || "";
            const ogImage =
              $('meta[property="og:image"]').attr("content") || "";
            return { ogTitle, ogDesc, ogImage };
          })()
        : null;

      // We can surface basic profile meta via rawResults, but no tweets are
      // available without authentication.
      const rawResults = meta ? [{ author: { profileMeta: meta } }] : [];
      return { tweets: [], rawResults };
    } catch (err) {
      console.warn(
        `[X] Public fetch failed (expected when blocked): ${
          err instanceof Error ? err.message : "unknown"
        }`,
      );
      return { tweets: [], rawResults: [] };
    }
  }

  async enrichTwitterProfile(twitterUrl: string): Promise<XEnrichment> {
    console.log(`[X] Enriching profile: ${twitterUrl}`);

    const username = this.extractUsername(twitterUrl);
    const { tweets } = await this.getUserTweetsAndReplies(username);
    console.log(`[X] Found ${tweets.length} tweets/replies`);

    return {
      url: twitterUrl,
      username,
      user: null,
      tweets,
      totalTweets: tweets.length,
    };
  }
}
