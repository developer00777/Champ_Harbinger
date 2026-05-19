import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  webSearch,
  newsSearch,
  isSearXNGConfigured,
  SearXNGError,
} from "@/lib/services/searxng-client";

const TIME_RANGE = z.enum(["day", "week", "month", "year"]);

/**
 * General web search via the self-hosted SearXNG meta-engine. Aggregates
 * Google, Bing, DuckDuckGo, Brave, Qwant, and Startpage in one call. Use
 * this whenever you need "find articles / pages about X" or "research
 * company Y online" — it's the default web research tool.
 */
export const searchWeb = tool({
  description:
    "Run a general web search across multiple engines (Google, Bing, DuckDuckGo, Brave, Qwant, Startpage) " +
    "via the self-hosted SearXNG aggregator. Use for open-ended research, finding articles, surfacing " +
    "company pages, or any time you'd otherwise reach for a search box. Returns title, URL, snippet, " +
    "engine, and a confidence score per result.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("The search query — write it the way you'd type into Google."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(10)
      .optional()
      .describe("Maximum number of results to return (default 10)."),
    timeRange: TIME_RANGE.optional().describe(
      "Restrict to results published within the last day / week / month / year.",
    ),
  }),
  execute: async ({ query, limit = 10, timeRange }) => {
    if (!isSearXNGConfigured()) {
      return {
        ok: false as const,
        error: "not_configured",
        message:
          "SearXNG is not configured. Set SEARXNG_BASE_URL in .env.local and run `docker compose up -d searxng`.",
        results: [],
      };
    }
    try {
      const results = await webSearch(query, { limit, timeRange });
      return {
        ok: true as const,
        query,
        count: results.length,
        results,
      };
    } catch (err) {
      const message =
        err instanceof SearXNGError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        ok: false as const,
        error: "search_failed",
        message: `Web search failed: ${message}`,
        results: [],
      };
    }
  },
});

/**
 * News-focused search via SearXNG (Google News, Bing News, DDG News).
 * Best for tracking timely events: funding rounds, product launches,
 * leadership changes, acquisitions.
 */
export const searchNews = tool({
  description:
    "Search recent news articles across Google News, Bing News, and DuckDuckGo News via SearXNG. " +
    "Use to track funding announcements, product launches, leadership changes, partnerships, " +
    "acquisitions, or any time-sensitive corporate event. Pass `timeRange` to restrict recency.",
  inputSchema: z.object({
    query: z.string().min(1).describe("News search query."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(10)
      .optional()
      .describe("Maximum number of results to return (default 10)."),
    timeRange: TIME_RANGE.optional().describe(
      "Restrict to news published within the last day / week / month / year. " +
        "Recommended for fresh events.",
    ),
  }),
  execute: async ({ query, limit = 10, timeRange }) => {
    if (!isSearXNGConfigured()) {
      return {
        ok: false as const,
        error: "not_configured",
        message:
          "SearXNG is not configured. Set SEARXNG_BASE_URL in .env.local and run `docker compose up -d searxng`.",
        results: [],
      };
    }
    try {
      const results = await newsSearch(query, { limit, timeRange });
      return {
        ok: true as const,
        query,
        timeRange: timeRange ?? null,
        count: results.length,
        results,
      };
    } catch (err) {
      const message =
        err instanceof SearXNGError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        ok: false as const,
        error: "search_failed",
        message: `News search failed: ${message}`,
        results: [],
      };
    }
  },
});
