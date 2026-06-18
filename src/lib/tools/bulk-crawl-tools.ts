import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  bulkCrawl,
  crawlPages,
  type CrawlResult,
} from "@/lib/services/crawl4ai-client";

/**
 * Resolve a bare domain ("acme.com") into a fully qualified URL. Leaves
 * already-qualified URLs untouched.
 */
function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function summarizeMarkdown(
  md: string | null | undefined,
  maxChars = 4000,
): string {
  if (!md) return "";
  return md.length <= maxChars ? md : `${md.slice(0, maxChars)}…[truncated]`;
}

export const bulkCrawlDomains = tool({
  description:
    "Crawl up to 50 company websites in one call via the self-hosted Crawl4AI " +
    "microservice. Returns markdown for each domain — ideal for value-prop " +
    "extraction, product/feature discovery, or any bulk research task where " +
    "Browserbase would be too expensive. Hands back per-domain markdown plus " +
    "a success flag so you can summarise / extract afterwards.",
  inputSchema: z.object({
    domains: z
      .array(z.string().min(3))
      .min(1)
      .max(50)
      .describe(
        "List of company domains or full URLs to crawl (max 50). " +
          "Bare domains like 'acme.com' are auto-prefixed with https://.",
      ),
    extractionPrompt: z
      .string()
      .optional()
      .describe(
        "Optional follow-up note about what you're going to extract from " +
          "the markdown. Recorded in the response so downstream tools can " +
          "reuse the same instruction.",
      ),
  }),
  execute: async ({ domains, extractionPrompt }) => {
    const urls = domains.map(normalizeDomain);
    const results = await bulkCrawl(urls, 5);

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    return {
      total: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
      extractionPrompt: extractionPrompt ?? null,
      pages: results.map((r: CrawlResult) => ({
        url: r.url,
        success: r.success,
        markdown: summarizeMarkdown(r.markdown),
        status_code: r.status_code ?? null,
        error: r.error ?? null,
      })),
    };
  },
});

export const crawlPageWithLLM = tool({
  description:
    "Crawl a single page and run an LLM extraction against it to return " +
    "structured JSON. Use for queries like 'extract every job listing on " +
    "this careers page' or 'pull the pricing tiers as an array'. Backed by " +
    "the self-hosted Crawl4AI service — no Browserbase cost.",
  inputSchema: z.object({
    url: z.string().url().describe("Fully qualified URL to crawl"),
    query: z
      .string()
      .min(5)
      .describe(
        "Natural-language description of what to extract. Treated as the " +
          "LLM instruction / target schema for crawl4ai's extraction strategy.",
      ),
  }),
  execute: async ({ url, query }) => {
    const [result] = await crawlPages([url], {
      extractStrategy: "json",
      query,
    });

    if (!result) {
      return {
        url,
        success: false,
        error: "no result returned from crawl4ai",
        data: null,
        markdown: null,
      };
    }

    return {
      url: result.url,
      success: result.success,
      status_code: result.status_code ?? null,
      error: result.error ?? null,
      data: result.data ?? null,
      markdown: summarizeMarkdown(result.markdown),
    };
  },
});
