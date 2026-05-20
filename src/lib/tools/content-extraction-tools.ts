import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  extractFromUrl,
  extractBatch,
  type ExtractedContent,
} from "@/lib/services/trafilatura-client";

/**
 * Trim long text bodies so we don't blow the model's context window when
 * the chat agent calls these tools on a 50k-word blog post.
 */
const MAX_BODY_CHARS = 12_000;

function shapeForChat(c: ExtractedContent) {
  const body = c.markdown ?? c.text ?? "";
  const truncated = body.length > MAX_BODY_CHARS;
  return {
    url: c.url,
    success: c.success,
    title: c.title,
    author: c.author,
    date: c.date,
    language: c.language,
    content: truncated
      ? body.slice(0, MAX_BODY_CHARS) + "\n…[truncated]"
      : body,
    contentLength: body.length,
    truncated,
    error: c.error,
  };
}

export const extractArticle = tool({
  description:
    "Extract clean article content from a blog post, news article, or documentation page. " +
    "Uses Trafilatura (the same extractor used by Common Crawl and HuggingFace dataset pipelines) — " +
    "significantly better than regex HTML stripping at separating real article body from navigation, " +
    "ads, related-content widgets, and footer noise. " +
    "Returns title, author, publication date, language, and the cleaned body text/markdown. " +
    "Use this when the user says things like 'summarize this blog post', 'extract content from this article', " +
    "or 'what does this URL say'. Returns { success: false, error: 'not_configured' } if the Trafilatura " +
    "microservice isn't running — fall back to the existing extractWebContent tool in that case.",
  inputSchema: z.object({
    url: z.string().url().describe("Full URL of the article/blog/news page"),
    format: z
      .enum(["text", "markdown"])
      .default("markdown")
      .optional()
      .describe(
        "Output format. 'markdown' preserves headings and lists; 'text' is a flat plain-text dump.",
      ),
  }),
  execute: async ({ url, format }) => {
    const result = await extractFromUrl(url, {
      format: format ?? "markdown",
    });
    return shapeForChat(result);
  },
});

export const extractArticleBatch = tool({
  description:
    "Extract clean article content from multiple URLs in parallel using Trafilatura. " +
    "Use this when the user asks to summarize/compare/digest a set of news articles or blog posts, " +
    "e.g. 'extract content from these 20 news articles' or 'pull the bodies of all these competitor blog posts'. " +
    "Per-URL failures are returned inline as { success: false, error: ... } rather than crashing the batch.",
  inputSchema: z.object({
    urls: z
      .array(z.string().url())
      .min(1)
      .max(30)
      .describe("List of article URLs (max 30 per call)"),
    format: z
      .enum(["text", "markdown"])
      .default("markdown")
      .optional()
      .describe("Output format applied to every URL in the batch"),
    maxConcurrent: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .optional()
      .describe("How many URLs to fetch in parallel (default 5, max 10)"),
  }),
  execute: async ({ urls, format, maxConcurrent }) => {
    const results = await extractBatch(urls, {
      format: format ?? "markdown",
      maxConcurrent: maxConcurrent ?? 5,
    });
    const shaped = results.map(shapeForChat);
    return {
      total: shaped.length,
      successful: shaped.filter((r) => r.success).length,
      failed: shaped.filter((r) => !r.success).length,
      results: shaped,
    };
  },
});
