import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  fetchJobsForCompany,
  type ATSProvider,
  type NormalizedJob,
} from "@/lib/services/jobs";

const atsSchema = z
  .enum(["greenhouse", "lever", "ashby", "all"])
  .default("all")
  .optional();

function atsTried(ats: ATSProvider | "all" | undefined): string[] {
  if (!ats || ats === "all") return ["greenhouse", "lever", "ashby"];
  return [ats];
}

export const getCompanyJobs = tool({
  description:
    "Fetch open job postings from Greenhouse, Lever, or Ashby for a company. " +
    "Use the company's ATS slug (e.g. for Stripe's Greenhouse: 'stripe'). " +
    "Pass `ats: 'all'` (default) to try all three providers in parallel and " +
    "combine the results — useful when you don't know which ATS a company uses. " +
    "Works without any API keys; data comes from each ATS's public job board API.",
  inputSchema: z.object({
    companySlug: z
      .string()
      .describe(
        "The company's ATS board slug — usually the subdomain or path segment " +
          "on their hosted careers page (e.g. 'stripe', 'palantir', 'ashby').",
      ),
    ats: atsSchema.describe(
      "Which ATS to query. Defaults to 'all' (Greenhouse + Lever + Ashby in parallel).",
    ),
  }),
  execute: async ({ companySlug, ats }) => {
    const provider = (ats ?? "all") as ATSProvider | "all";
    const jobs = await fetchJobsForCompany(companySlug, provider);
    return {
      company: companySlug,
      ats_tried: atsTried(provider),
      jobs,
      total: jobs.length,
    };
  },
});

export const detectHiringSignal = tool({
  description:
    "Detect hiring signals at a company by fetching open jobs from Greenhouse, " +
    "Lever, or Ashby and filtering by title and/or department keywords. " +
    "Use this to answer questions like 'is this company hiring engineers?' or " +
    "'are they expanding sales?'. Returns only matching postings; an empty list " +
    "means no current signal.",
  inputSchema: z.object({
    companySlug: z
      .string()
      .describe(
        "The company's ATS board slug (e.g. 'stripe' for Stripe's Greenhouse board).",
      ),
    ats: atsSchema.describe(
      "Which ATS to query. Defaults to 'all' (tries Greenhouse + Lever + Ashby).",
    ),
    titleKeywords: z
      .array(z.string())
      .optional()
      .describe(
        "Case-insensitive substrings to match against job titles. " +
          "ANY match counts. Example: ['engineer', 'developer'].",
      ),
    departmentKeywords: z
      .array(z.string())
      .optional()
      .describe(
        "Case-insensitive substrings to match against the department or team field. " +
          "ANY match counts. Example: ['engineering', 'platform'].",
      ),
  }),
  execute: async ({ companySlug, ats, titleKeywords, departmentKeywords }) => {
    const provider = (ats ?? "all") as ATSProvider | "all";
    const jobs = await fetchJobsForCompany(companySlug, provider);

    const titles = (titleKeywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
    const depts = (departmentKeywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);

    const matches = jobs.filter((job: NormalizedJob) => {
      const titleHit =
        titles.length === 0 ||
        titles.some((k) => job.title.toLowerCase().includes(k));
      const deptText = `${job.department ?? ""} ${job.team ?? ""}`.toLowerCase();
      const deptHit =
        depts.length === 0 || depts.some((k) => deptText.includes(k));
      return titleHit && deptHit;
    });

    return {
      company: companySlug,
      ats_tried: atsTried(provider),
      filters: {
        titleKeywords: titles,
        departmentKeywords: depts,
      },
      matched: matches.length,
      total_scanned: jobs.length,
      hiring_signal: matches.length > 0,
      jobs: matches,
    };
  },
});
