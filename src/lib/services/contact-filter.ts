import { getModelSync as getModel } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { generateObjectLimited as generateObject } from "@/lib/ai/generate";
import { z } from "zod";
import { WebExtractionService } from "@/lib/services/web-extraction-service";
import { recordAiUsage } from "@/lib/ai/usage";
import { searxSearch } from "@/lib/search/searxng-client";
import {
  UNTRUSTED_NOTICE,
  stringify,
  wrapUntrusted,
} from "@/lib/prompt-safety";

// ── Types ────────────────────────────────────────────────────────────────

export interface CompanyContext {
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  description: string | null;
}

export interface CandidateContact {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  rawHeadline: string | null;
}

export interface VerifiedContact {
  index: number;
  name: string;
  title: string | null;
}

export interface DomainPerson {
  name: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
}

// ── Team page paths to try ───────────────────────────────────────────────

const TEAM_KEYWORDS = [
  "team",
  "our-team",
  "meet-the-team",
  "about",
  "about-us",
  "staff",
  "people",
  "leadership",
  "management",
  "who-we-are",
  "contact",
  "contact-us",
];

/**
 * Fetch sitemap.xml and return the list of URLs.
 * Returns empty array on failure (no sitemap = fall back to guessing).
 */
async function fetchSitemapUrls(domain: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://${domain}/sitemap.xml`, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return [];
    const xml = await response.text();
    const urls: string[] = [];
    const locRegex = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = locRegex.exec(xml)) !== null) {
      urls.push(match[1]);
    }
    return urls;
  } catch {
    return [];
  }
}

// ── Domain-based people finding ──────────────────────────────────────────

/**
 * Scrape a company's website for team/about/staff pages and extract people.
 * Fetches the sitemap first to find real URLs instead of guessing paths.
 * Falls back to a short guess list if no sitemap exists.
 */
/** Normalize a URL to a canonical LinkedIn profile (https://www.linkedin.com/in/...). */
function toLinkedInProfile(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    if (!/^\/in\//i.test(u.pathname)) return null;
    return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Find a person's LinkedIn profile URL via web search (SearXNG). LinkedIn is the
 * join key we use to map a contact onto LakeB2B, so we want it on every contact
 * even when the company page doesn't link it. Returns null when SearXNG is
 * unconfigured or nothing matches.
 */
export async function findLinkedInUrl(
  name: string,
  orgName: string,
): Promise<string | null> {
  if (!name.trim()) return null;
  // Plain queries surface LinkedIn profiles via the metasearch engines; the
  // `site:` operator does NOT work through SearXNG/DuckDuckGo, so avoid it.
  for (const q of [
    `"${name}" ${orgName} linkedin`,
    `${name} ${orgName} linkedin.com/in`,
  ]) {
    const results = await searxSearch(q, 8);
    for (const r of results) {
      const profile = toLinkedInProfile(r.url);
      if (profile) return profile;
    }
  }
  return null;
}

export async function findPeopleOnDomain(
  domain: string,
  orgName: string,
): Promise<DomainPerson[]> {
  const extractor = new WebExtractionService();
  const scrapedContent: Array<{ url: string; content: string }> = [];

  // Step 1: Try sitemap to find team/about pages
  const sitemapUrls = await fetchSitemapUrls(domain);
  let urlsToTry: string[];

  if (sitemapUrls.length > 0) {
    // Filter sitemap URLs to only those matching team-related keywords
    const lowerKeywords = TEAM_KEYWORDS;
    urlsToTry = sitemapUrls.filter((url) => {
      const path = url.toLowerCase();
      return lowerKeywords.some((kw) => path.includes(`/${kw}`));
    });
    console.log(
      `[contact-filter] Sitemap found ${sitemapUrls.length} URLs, ${urlsToTry.length} match team keywords`,
    );
  } else {
    // No sitemap -- fall back to top 4 most common paths only
    urlsToTry = ["/team", "/about", "/about-us", "/people"].map(
      (p) => `https://${domain}${p}`,
    );
    console.log(
      `[contact-filter] No sitemap for ${domain}, trying ${urlsToTry.length} common paths`,
    );
  }

  // Step 2: Fetch matching URLs (cap at 4 to avoid spraying requests)
  const toFetch = urlsToTry.slice(0, 4);
  const results = await Promise.allSettled(
    toFetch.map(async (url) => {
      const result = await extractor.extract(url, {
        includeLinks: false,
        timeout: 8000,
      });
      if (
        result.success &&
        result.data.content.length > 200 &&
        !result.url.includes("/404")
      ) {
        return { url: result.url, content: result.data.content };
      }
      return null;
    }),
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      scrapedContent.push(r.value);
    }
  }

  if (scrapedContent.length === 0) return [];

  // Use Haiku to extract people from the scraped content
  const combinedContent = scrapedContent
    .map((s) => `--- ${s.url} ---\n${s.content.slice(0, 4000)}`)
    .join("\n\n");

  try {
    const startedAt = Date.now();
    const aiResult = await generateObject({
      model: getModel(Models.classification),
      schema: z.object({
        people: z.array(
          z.object({
            name: z.string().describe("Full name of the person"),
            title: z
              .string()
              .nullable()
              .describe("Job title or role at the company"),
            email: z
              .string()
              .nullable()
              .describe("Work email if found on the page"),
            linkedinUrl: z
              .string()
              .nullable()
              .describe("LinkedIn profile URL if found"),
          }),
        ),
      }),
      prompt: `Extract all staff members / team members from scraped website pages for a specific company.

${UNTRUSTED_NOTICE}

Target company name: ${stringify(orgName)}
Target domain: ${stringify(domain)}

Rules:
- Only extract REAL people who work at this company (not testimonials, clients, or partners)
- Each person should have a real human name (skip generic entries like "The Team" or company names)
- Clean up names: remove credentials/suffixes unless they're part of how the person is known
- Extract their job title/role at this company
- Extract their work email if listed
- Extract their LinkedIn URL if linked
- Skip duplicate people (same name appearing on multiple pages)

Scraped page content:
${wrapUntrusted(combinedContent.slice(0, 12000))}`,
    });
    const { object } = aiResult;

    recordAiUsage(aiResult, {
      operation: "domain-people-extract",
      costModel: "haiku",
      modelLabel: Models.classification,
      startedAt,
      metadata: {
        model: "claude-haiku-4-5",
        domain,
        pagesScraped: scrapedContent.length,
        peopleFound: object.people.length,
      },
    });

    // Backfill LinkedIn URLs (the LakeB2B join key) for anyone the page didn't
    // link, via web search — 3 at a time to bound latency.
    const people = object.people;
    const missing = people.filter((p) => !p.linkedinUrl && p.name?.trim());
    for (let i = 0; i < missing.length; i += 3) {
      const batch = missing.slice(i, i + 3);
      await Promise.all(
        batch.map(async (p) => {
          try {
            const li = await findLinkedInUrl(p.name, orgName);
            if (li) p.linkedinUrl = li;
          } catch {
            // best-effort
          }
        }),
      );
    }

    return people;
  } catch (err) {
    console.error("[contact-filter] Domain people extraction failed:", err);
    return [];
  }
}

/** Parse a person's name from a LinkedIn search-result title, e.g.
 *  "Jane Doe - VP Engineering - Acme | LinkedIn" → "Jane Doe". */
function parseLinkedInName(title: string | null): string | null {
  if (!title) return null;
  let t = title.replace(/\s*[|\-–—]\s*LinkedIn.*$/i, "").trim();
  // The name is the first segment before a " - " / " | " separator.
  t = t.split(/\s+[-–—|]\s+/)[0].trim();
  if (!/[a-zA-Z]/.test(t) || t.length < 3 || t.length > 60) return null;
  if (t.split(/\s+/).length < 2) return null; // need at least first + last
  return t;
}

const DEFAULT_DECISION_MAKER_TITLES = [
  "CEO",
  "Founder",
  "CTO",
  "VP Engineering",
  "Head of Product",
  "Director",
];

/**
 * Phase 2: find people at a company via web/LinkedIn search, role-filtered.
 * This is what surfaces people for companies whose own site has no scrapable
 * team page (most of them). Builds plain-text queries per target role (the
 * `site:` operator does NOT work through SearXNG), collects LinkedIn /in/
 * profiles, and verifies each against the company with the existing LLM filter.
 * Returns [] when SearXNG is unconfigured (searxSearch no-ops).
 */
export async function findPeopleViaSearch(
  company: CompanyContext,
  targetTitles: string[],
): Promise<DomainPerson[]> {
  const titles = targetTitles.length
    ? targetTitles
    : DEFAULT_DECISION_MAKER_TITLES;

  const candidates: CandidateContact[] = [];
  const seen = new Set<string>();
  for (const title of titles.slice(0, 8)) {
    for (const q of [
      `"${company.name}" ${title} linkedin`,
      `${company.name} ${title} linkedin.com/in`,
    ]) {
      const results = await searxSearch(q, 8);
      for (const r of results) {
        const li = toLinkedInProfile(r.url);
        if (!li || seen.has(li)) continue;
        seen.add(li);
        const name = parseLinkedInName(r.title);
        if (!name) continue;
        candidates.push({
          name,
          title: null,
          linkedinUrl: li,
          rawHeadline: r.title || r.content || null,
        });
      }
    }
  }
  if (candidates.length === 0) return [];

  const verified = await filterContactsByCompany(company, candidates);
  return verified
    .map((v): DomainPerson | null => {
      const c = candidates[v.index];
      if (!c) return null;
      return {
        name: v.name || c.name,
        title: v.title,
        email: null,
        linkedinUrl: c.linkedinUrl,
      };
    })
    .filter((p): p is DomainPerson => p !== null);
}

/**
 * Find as many people as possible at a company, role-filtered. Runs the
 * team-page scrape (Phase 1) and the LinkedIn/web search (Phase 2) in parallel
 * and merges + dedupes by LinkedIn URL (falling back to name). This is what
 * find-contacts calls: it returns people even when the company site has no team
 * page, and biases toward the requested roles.
 */
export async function findPeopleForCompany(
  company: CompanyContext,
  targetTitles: string[] = [],
): Promise<DomainPerson[]> {
  const [scraped, searched] = await Promise.all([
    company.domain
      ? findPeopleOnDomain(company.domain, company.name)
      : Promise.resolve<DomainPerson[]>([]),
    findPeopleViaSearch(company, targetTitles),
  ]);

  const byKey = new Map<string, DomainPerson>();
  for (const p of [...scraped, ...searched]) {
    if (!p.name?.trim()) continue;
    const key = (p.linkedinUrl || p.name.toLowerCase()).trim();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, p);
    } else {
      byKey.set(key, {
        name: existing.name || p.name,
        title: existing.title || p.title,
        email: existing.email || p.email,
        linkedinUrl: existing.linkedinUrl || p.linkedinUrl,
      });
    }
  }
  return [...byKey.values()];
}

// ── Company name matching ────────────────────────────────────────────────

/**
 * Normalize a company name for comparison: lowercase, strip common suffixes
 * (Ltd, Inc, LLC, etc.), and collapse whitespace/punctuation.
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(ltd|limited|inc|incorporated|llc|plc|corp|corporation|co|company|group|holdings)\b\.?/g,
      "",
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check whether a LinkedIn headline references the target company name.
 * Uses normalized substring matching — the headline must contain the core
 * company name (minus legal suffixes) to pass.
 */
function headlineMentionsCompany(
  headline: string | null,
  companyName: string,
): boolean {
  if (!headline) return false;
  const normHeadline = normalizeCompanyName(headline);
  const normCompany = normalizeCompanyName(companyName);
  if (!normCompany) return false;
  return normHeadline.includes(normCompany);
}

// ── LLM-based LinkedIn result filtering ──────────────────────────────────

/**
 * Filter LinkedIn search results to only include people who genuinely work
 * at the target company. Pre-filters by company name in headline, then uses
 * Haiku to disambiguate similarly-named companies.
 */
export async function filterContactsByCompany(
  company: CompanyContext,
  candidates: CandidateContact[],
): Promise<VerifiedContact[]> {
  if (candidates.length === 0) return [];

  // Pre-filter: only keep candidates whose headline mentions the company.
  // This catches obvious mismatches (completely different companies) cheaply
  // before we spend tokens on the LLM call.
  const preFiltered = candidates
    .map((c, originalIndex) => ({ ...c, originalIndex }))
    .filter((c) => headlineMentionsCompany(c.rawHeadline, company.name));

  console.log(
    `[contact-filter] Pre-filter: ${candidates.length} candidates → ${preFiltered.length} mention "${company.name}"`,
  );

  if (preFiltered.length === 0) return [];

  const summaries = preFiltered
    .map(
      (c, i) =>
        `[${i}] ${c.rawHeadline || c.name}${c.title ? ` (parsed: ${c.title})` : ""}`,
    )
    .join("\n");

  try {
    const startedAt = Date.now();
    const result = await generateObject({
      model: getModel(Models.classification),
      schema: z.object({
        verified: z.array(
          z.object({
            index: z
              .number()
              .int()
              .describe("Index of the candidate from the input list"),
            name: z.string().describe("Cleaned full name"),
            title: z
              .string()
              .nullable()
              .describe("Cleaned job title without company name"),
          }),
        ),
      }),
      prompt: `You are filtering LinkedIn search results to find people who actually work at a specific company.

${UNTRUSTED_NOTICE}

Target company:
- Name: ${stringify(company.name)}
- Domain: ${stringify(company.domain || "unknown")}
- Industry: ${stringify(company.industry || "unknown")}
- Location: ${stringify(company.location || "unknown")}

Candidates (scraped from LinkedIn results):
${wrapUntrusted(summaries)}

Rules:
- ONLY include people who genuinely work at the target company specifically
- Reject people at similarly-named but DIFFERENT companies (e.g., "Dixons Carphone" is NOT "Dixons Estate Agents", "Miller Rose" is NOT "Miller & Carter")
- Use the domain and industry to disambiguate -- if the target is an estate agent, reject people from retail/electronics companies with similar names
- If a person's headline has no company reference and their role doesn't match the industry, EXCLUDE them
- Clean up names: remove LinkedIn suffixes, emoji, excessive credentials
- Clean up titles: extract just the role (e.g., "Branch Manager" not "Branch Manager at Dixons")`,
    });
    const { object } = result;

    recordAiUsage(result, {
      operation: "contact-filter",
      costModel: "haiku",
      modelLabel: Models.classification,
      startedAt,
      metadata: {
        model: "claude-haiku-4-5",
        companyName: company.name,
        candidateCount: preFiltered.length,
        verifiedCount: object.verified.length,
      },
    });

    // Map LLM indices (which reference preFiltered) back to original candidate indices
    return object.verified.map((v) => ({
      ...v,
      index: preFiltered[v.index]?.originalIndex ?? v.index,
    }));
  } catch (err) {
    console.error(
      "[contact-filter] LLM filter failed, rejecting all candidates (safe fallback):",
      err,
    );
    // Safe fallback: reject all rather than adding wrong people
    return [];
  }
}
