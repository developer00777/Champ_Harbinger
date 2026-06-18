import "server-only";

/**
 * LinkedIn URL resolution - the universal join key.
 *
 * The LinkedIn profile URL is the canonical match key between Harbinger, the
 * owned master DB, and the LakeB2B API. This module resolves a profile URL for a
 * seed (using owned web search when one is not supplied) and normalizes it to a
 * canonical form so matching is deterministic.
 *
 * Search is INJECTED (deps.search, defaulting to SearXNG) so this is unit
 * testable without network. No external scraping vendor is used.
 */

export interface LinkedInSeed {
  fullName?: string | null;
  company?: string | null;
  domain?: string | null;
  linkedinUrl?: string | null;
}

type SearchFn = (
  query: string,
  n?: number,
) => Promise<Array<{ url?: string; title?: string; content?: string }>>;

export interface ResolveDeps {
  search?: SearchFn;
}

/**
 * Canonicalize any LinkedIn profile reference to https://www.linkedin.com/in/<slug>.
 * Returns null when the input is not a recognizable /in/ profile URL.
 */
export function normalizeLinkedInUrl(input: string): string | null {
  if (!input) return null;
  const m = input.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m || !m[1]) return null;
  const slug = m[1].replace(/\/+$/, "").toLowerCase();
  if (!slug) return null;
  return `https://www.linkedin.com/in/${slug}`;
}

function surname(fullName: string): string | null {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return null;
  return parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Heuristic: does a profile URL plausibly belong to the seed person? Used by the
 * LakeB2B matching phase to sanity-check a URL-keyed lookup. Conservative: true
 * when the slug contains the seed surname.
 */
export function linkedinUrlMatchesSeed(
  url: string,
  seed: LinkedInSeed,
): boolean {
  const norm = normalizeLinkedInUrl(url);
  if (!norm || !seed.fullName) return false;
  const sn = surname(seed.fullName);
  if (!sn) return false;
  const slug = norm.replace("https://www.linkedin.com/in/", "");
  return slug.includes(sn);
}

const lazySearx: () => Promise<SearchFn> = async () => {
  const { searxSearch } = await import("@/lib/search/searxng-client");
  return (q: string, n?: number) => searxSearch(q, n ?? 10);
};

/**
 * Resolve a canonical LinkedIn profile URL for a seed.
 * Order: an existing seed URL (normalized) wins; otherwise search the web for
 * "<name> <company|domain> linkedin" and take the first /in/ result. Returns
 * null when nothing is found.
 */
export async function resolveLinkedInUrl(
  seed: LinkedInSeed,
  deps: ResolveDeps = {},
): Promise<string | null> {
  if (seed.linkedinUrl) {
    const norm = normalizeLinkedInUrl(seed.linkedinUrl);
    if (norm) return norm;
  }
  if (!seed.fullName) return null;

  const search = deps.search ?? (await lazySearx());
  const companyHint = seed.company ?? seed.domain ?? "";
  const query = `${seed.fullName} ${companyHint} site:linkedin.com/in`.trim();
  let results: Array<{ url?: string }> = [];
  try {
    results = await search(query, 10);
  } catch {
    return null;
  }
  for (const r of results) {
    const norm = r.url ? normalizeLinkedInUrl(r.url) : null;
    if (norm) return norm;
  }
  return null;
}
