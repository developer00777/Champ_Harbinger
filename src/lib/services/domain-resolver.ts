/**
 * Resolve a company's primary domain from just its name via web search.
 *
 * A list of company NAMES (Excel upload / Champ Sets) has no domains, but the
 * team-page scrape + email-pattern logic need one. This finds it: search the
 * company name, take the first non-aggregator result whose domain matches the
 * name. Depends on a working search backend (SearXNG + proxies) — returns null
 * when search is down or nothing matches, and contact-finding degrades to
 * search-only.
 */
import { webSearch } from "@/lib/search/web-search";

// Directories / social / data sites that show up for company queries but are
// never the company's own domain.
const AGGREGATOR_DOMAINS = [
  "linkedin.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "crunchbase.com",
  "wikipedia.org",
  "bloomberg.com",
  "glassdoor.com",
  "indeed.com",
  "zoominfo.com",
  "apollo.io",
  "pitchbook.com",
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "yelp.com",
  "medium.com",
  "github.com",
  "reddit.com",
  "quora.com",
  "wellfound.com",
  "angel.co",
];

const TWO_PART_TLDS = new Set([
  "co.uk",
  "com.au",
  "co.nz",
  "co.in",
  "com.br",
  "co.za",
]);

/** Registrable domain from a hostname (drops subdomains; handles co.uk etc). */
function registrableDomain(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".");
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

function isAggregator(domain: string): boolean {
  return AGGREGATOR_DOMAINS.some(
    (a) => domain === a || domain.endsWith(`.${a}`),
  );
}

/** Alphanumeric core of a string, for fuzzy name↔domain matching. */
function core(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function resolveDomain(name: string): Promise<string | null> {
  const q = name.trim();
  if (!q) return null;
  const nameCore = core(q.replace(/\b(inc|llc|ltd|corp|co|company)\b/gi, ""));

  const candidates: string[] = [];
  for (const query of [`${q} official website`, q]) {
    const results = await webSearch(query, 8);
    for (const r of results) {
      let domain: string;
      try {
        domain = registrableDomain(new URL(r.url).hostname);
      } catch {
        continue;
      }
      if (!domain || isAggregator(domain)) continue;
      // Strong match: the domain's core overlaps the company-name core.
      const dCore = core(domain.split(".")[0]);
      if (
        dCore &&
        nameCore &&
        (dCore.includes(nameCore) || nameCore.includes(dCore))
      ) {
        return domain;
      }
      candidates.push(domain);
    }
    if (candidates.length > 0) break;
  }
  // No name match — best-effort first non-aggregator result.
  return candidates[0] ?? null;
}
