import { tool } from "ai";
import { z } from "zod";
import {
  getCompanyOrgStats,
  getCommitVelocity,
  getReleaseCadence,
  getStargazerTrend,
} from "@/lib/services/github-signals";

/**
 * Chat-facing tools that expose GitHub engineering-momentum signals.
 *
 * Each one wraps a single service function; the agent picks which to call
 * based on the question ("are they shipping?" vs "is this product trending?").
 * All four are stateless and side-effect-free — they do not write to the DB.
 */

export const getGitHubOrgStats = tool({
  description:
    "Summarize a company's GitHub footprint: public repo count, total stars, top languages, " +
    "and the 10 most-starred recent repos. Use this when the user asks 'what does company X build?' " +
    "or wants a quick view of an org's open-source presence.",
  inputSchema: z.object({
    orgSlug: z
      .string()
      .min(1)
      .describe('GitHub org or user login (e.g. "vercel", "stripe").'),
  }),
  execute: async ({ orgSlug }) => {
    try {
      const stats = await getCompanyOrgStats(orgSlug);
      return stats;
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        org: orgSlug,
      };
    }
  },
});

export const getGitHubCommitVelocity = tool({
  description:
    "Measure recent commit activity on a single repo: total commits, unique contributors, " +
    "and a weekly histogram. Use this to detect 'is this team actively coding?' — useful for " +
    "spotting hiring momentum or staffing changes.",
  inputSchema: z.object({
    orgSlug: z.string().min(1).describe("GitHub org or user login."),
    repoSlug: z.string().min(1).describe("Repository name within the org."),
    daysBack: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(90)
      .describe("How many days of history to consider (default 90)."),
  }),
  execute: async ({ orgSlug, repoSlug, daysBack }) => {
    try {
      return await getCommitVelocity(orgSlug, repoSlug, daysBack);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        repo: `${orgSlug}/${repoSlug}`,
      };
    }
  },
});

export const getGitHubReleaseCadence = tool({
  description:
    "Report how often a repo ships releases: per-month counts and the latest published release. " +
    "Use this to detect 'are they shipping product?' — companies that publish releases monthly are " +
    "actively delivering, while gaps of months hint at stalled projects.",
  inputSchema: z.object({
    orgSlug: z.string().min(1).describe("GitHub org or user login."),
    repoSlug: z.string().min(1).describe("Repository name within the org."),
    monthsBack: z
      .number()
      .int()
      .min(1)
      .max(36)
      .default(12)
      .describe("How many months of history to consider (default 12)."),
  }),
  execute: async ({ orgSlug, repoSlug, monthsBack }) => {
    try {
      return await getReleaseCadence(orgSlug, repoSlug, monthsBack);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        repo: `${orgSlug}/${repoSlug}`,
      };
    }
  },
});

export const getGitHubStarTrend = tool({
  description:
    "Track stargazer momentum for a repo over a recent window: total stars gained plus a " +
    "weekly histogram. Use this to detect 'is this product getting traction?' — a positive " +
    "delta in the last 30 days is a strong dev-attention signal.",
  inputSchema: z.object({
    orgSlug: z.string().min(1).describe("GitHub org or user login."),
    repoSlug: z.string().min(1).describe("Repository name within the org."),
    daysBack: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("How many days of star history to consider (default 30)."),
  }),
  execute: async ({ orgSlug, repoSlug, daysBack }) => {
    try {
      return await getStargazerTrend(orgSlug, repoSlug, daysBack);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        repo: `${orgSlug}/${repoSlug}`,
      };
    }
  },
});
