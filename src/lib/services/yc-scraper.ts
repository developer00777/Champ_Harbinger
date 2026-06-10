import * as cheerio from "cheerio";
import {
  obscuraFetchHtml,
  isObscuraConfigured,
} from "@/lib/services/browser-pool";

// ── Types ────────────────────────────────────────────────────────────────

export interface YCCompanyRaw {
  name: string;
  oneLiner: string | null;
  ycUrl: string;
  batch: string | null;
  industry: string | null;
  location: string | null;
}

export interface YCCompanyDetail {
  name: string;
  oneLiner: string | null;
  longDescription: string | null;
  url: string | null;
  ycUrl: string;
  batch: string | null;
  industry: string | null;
  location: string | null;
  teamSize: string | null;
  founders: Array<{
    name: string;
    title: string | null;
    linkedin: string | null;
  }>;
  isHiring: boolean;
}

export interface YCScrapeResult {
  companies: YCCompanyDetail[];
  totalCards: number;
  directoryUrl: string;
}

export interface YCFilters {
  batch?: string;
  industry?: string;
  region?: string;
  teamSize?: string;
  isHiring?: boolean;
  query?: string;
}

// ── URL builder ──────────────────────────────────────────────────────────

/**
 * Build the YC directory URL with query-param filters.
 */
export function buildYCDirectoryUrl(filters: YCFilters): string {
  const base = "https://www.ycombinator.com/companies";
  const params = new URLSearchParams();

  if (filters.batch) params.set("batch", filters.batch);
  if (filters.industry) params.set("industry", filters.industry);
  if (filters.region) params.set("regions", filters.region);
  if (filters.teamSize) params.set("team_size", filters.teamSize);
  if (filters.isHiring) params.set("is_hiring", "true");
  if (filters.query) params.set("q", filters.query);

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// ── Phase 1: Directory listing ───────────────────────────────────────────

/**
 * Scrape the YC directory listing page via a one-shot Obscura fetch, then
 * extract card data from the rendered HTML with cheerio.
 *
 * NOTE: Obscura fetch returns a single rendered snapshot with no scrolling, so
 * the directory's lazy-loaded cards beyond the first viewport(s) won't be
 * present — expect fewer cards than the old Playwright scroll-loop produced.
 * This is acceptable/expected.
 */
async function scrapeDirectoryListing(filters: YCFilters): Promise<{
  cards: YCCompanyRaw[];
  directoryUrl: string;
}> {
  const directoryUrl = buildYCDirectoryUrl(filters);
  const html = await obscuraFetchHtml(directoryUrl);

  const $ = cheerio.load(html);
  const cards: YCCompanyRaw[] = [];
  const seen = new Set<string>();

  $('a[href^="/companies/"]').each((_, anchor) => {
    const href = $(anchor).attr("href") || "";
    if (href.includes("?") || href === "/companies/" || href === "/companies") {
      return;
    }
    if (seen.has(href)) return;
    seen.add(href);

    // cheerio has no innerText; approximate line breaks by splitting on the
    // element's text. We collect text from block-ish descendants to recover the
    // line structure the old DOM extraction relied on.
    const parts: string[] = [];
    $(anchor)
      .find("*")
      .addBack()
      .contents()
      .each((__, node) => {
        if (node.type === "text") {
          const t = $(node).text().trim();
          if (t) parts.push(t);
        }
      });
    const lines = parts.map((l) => l.trim()).filter(Boolean);

    if (lines.length === 0) return;

    // The first line often has name + location concatenated, e.g.
    // "Paratus HealthMenlo Park, CA, USA". Split on the location pattern.
    let name = lines[0];
    let location: string | null = null;

    // Match a city/state/country suffix like "San Francisco, CA, USA"
    const locMatch = name.match(
      /^(.+?)([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2}(?:,\s*\w+)?)$/,
    );
    if (locMatch) {
      name = locMatch[1].trim();
      location = locMatch[2].trim();
    }

    // Also check if there's a standalone location line
    if (!location) {
      const locationLine = lines.find(
        (l) =>
          l !== lines[0] &&
          (/,\s*[A-Z]{2}/.test(l) || /,\s*\w+,\s*\w+/.test(l)),
      );
      if (locationLine) location = locationLine;
    }

    const oneLiner = lines.length > 1 ? lines[1] : null;

    // Batch: "WINTER 2025", "SUMMER 2024", etc.
    const batchLine = lines.find((l) =>
      /^(WINTER|SUMMER|SPRING|FALL)\s+\d{4}$/i.test(l),
    );

    // Industry: uppercase lines that aren't batch tags
    const industryLines = lines
      .slice(2)
      .filter(
        (l) =>
          l === l.toUpperCase() &&
          l.length > 2 &&
          !/^(WINTER|SUMMER|SPRING|FALL)\s+\d{4}$/i.test(l),
      );

    cards.push({
      name,
      oneLiner,
      ycUrl: `https://www.ycombinator.com${href}`,
      batch: batchLine || null,
      industry: industryLines[0] || null,
      location,
    });
  });

  return { cards, directoryUrl };
}

// ── Phase 2: Company detail pages ────────────────────────────────────────

/**
 * Visit each company's YC profile page to extract website URL,
 * long description, founders, team size, and hiring status.
 */
async function scrapeCompanyDetails(
  cards: YCCompanyRaw[],
  maxDetails: number = 50,
): Promise<{ details: YCCompanyDetail[] }> {
  const details: YCCompanyDetail[] = [];
  const toVisit = cards.slice(0, maxDetails);

  const excludedDomains = [
    "ycombinator.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "github.com",
    "facebook.com",
    "instagram.com",
    "startupschool.org",
    "workatastartup.com",
    "bookface.ycombinator.com",
  ];

  for (const card of toVisit) {
    try {
      const html = await obscuraFetchHtml(card.ycUrl);
      const $ = cheerio.load(html);

      // Website URL: first external link that isn't social/nav
      let url: string | null = null;
      $("a[href]").each((_, a) => {
        if (url) return;
        const href = $(a).attr("href") || "";
        if (!href.startsWith("http")) return;
        try {
          const hostname = new URL(href).hostname.toLowerCase();
          if (
            !excludedDomains.some(
              (d) => hostname === d || hostname.endsWith(`.${d}`),
            )
          ) {
            url = href;
          }
        } catch {
          // ignore malformed hrefs
        }
      });

      // Long description
      const descEl = $("[class*='prose']").first().length
        ? $("[class*='prose']").first()
        : $("section p").first();
      const longDescription = descEl.text().trim() || null;

      // Team size
      const bodyText = $("body").text();
      const teamMatch = bodyText.match(
        /(?:Team Size|Employees?):\s*(\d[\d\-+]*)/i,
      );
      const teamSize = teamMatch ? teamMatch[1] : null;

      // Hiring
      const isHiring =
        $('[href*="jobs"], [href*="careers"], [class*="hiring"]').length > 0 ||
        /currently hiring/i.test(bodyText);

      // Founders
      const founders: Array<{
        name: string;
        title: string | null;
        linkedin: string | null;
      }> = [];

      // Try founder/team sections first
      const founderSections = $('[class*="founder"], [class*="team"] > div');
      if (founderSections.length > 0) {
        founderSections.each((_, section) => {
          const $section = $(section);
          const name = $section
            .find("h3, h4, [class*='name']")
            .first()
            .text()
            .trim();
          if (!name || name.length < 2 || name.length > 60) return;
          const title =
            $section
              .find("p, [class*='title'], [class*='role']")
              .first()
              .text()
              .trim() || null;
          const linkedin =
            $section.find('a[href*="linkedin.com"]').first().attr("href") ||
            null;
          founders.push({ name, title, linkedin });
        });
      }

      // Fallback: look for "Founders" heading
      if (founders.length === 0) {
        $("h2, h3, h4").each((_, h) => {
          if (founders.length > 0) return;
          if (!$(h).text().toLowerCase().includes("founder")) return;
          const container = $(h).parent();
          if (!container.length) return;
          container.find("a, h3, h4, [class*='name']").each((__, el) => {
            const n = $(el).text().trim();
            if (
              n &&
              n.length > 2 &&
              n.length < 60 &&
              !n.toLowerCase().includes("founder")
            ) {
              const li = $(el)
                .closest("div")
                .find('a[href*="linkedin.com"]')
                .first()
                .attr("href");
              founders.push({
                name: n,
                title: null,
                linkedin: li || null,
              });
            }
          });
        });
      }

      details.push({
        name: card.name,
        oneLiner: card.oneLiner,
        longDescription,
        url,
        ycUrl: card.ycUrl,
        batch: card.batch,
        industry: card.industry,
        location: card.location,
        teamSize,
        founders,
        isHiring,
      });
    } catch {
      // Single company failure -> continue with fallback data
      details.push({
        name: card.name,
        oneLiner: card.oneLiner,
        longDescription: null,
        url: null,
        ycUrl: card.ycUrl,
        batch: card.batch,
        industry: card.industry,
        location: card.location,
        teamSize: null,
        founders: [],
        isHiring: false,
      });
    }
  }

  return { details };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Scrape YC's company directory and detail pages.
 *
 * Phase 1: Directory listing -- one-shot Obscura fetch, extract cards with cheerio.
 * Phase 2: Detail pages -- fetch each company's YC profile for website, founders, etc.
 *
 * NOTE: Obscura fetch is a single rendered snapshot (no scrolling), so the
 * directory yields fewer cards than the old scroll-loop. This is expected.
 */
export async function scrapeYCCompanies(
  filters: YCFilters,
  maxCompanies: number = 50,
): Promise<YCScrapeResult> {
  if (!isObscuraConfigured()) {
    return {
      companies: [],
      totalCards: 0,
      directoryUrl: buildYCDirectoryUrl(filters),
    };
  }

  // Phase 1: Directory listing
  const listing = await scrapeDirectoryListing(filters);

  const cardsToDetail = listing.cards.slice(0, maxCompanies);

  if (cardsToDetail.length === 0) {
    return {
      companies: [],
      totalCards: 0,
      directoryUrl: listing.directoryUrl,
    };
  }

  // Phase 2: Company detail pages
  const detailResult = await scrapeCompanyDetails(cardsToDetail, maxCompanies);

  return {
    companies: detailResult.details,
    totalCards: listing.cards.length,
    directoryUrl: listing.directoryUrl,
  };
}
