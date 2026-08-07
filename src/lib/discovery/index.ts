import { hasLakeB2BKey } from "@/lib/lakeb2b/client";
import { isSearxConfigured } from "@/lib/search/searxng-client";
import { normalizeDomain } from "@/lib/services/knowledge-base";
import { normalizeLinkedInUrl } from "@/lib/enrichment/providers/linkedinResolver";
import type { VerifiedCompany, VerifiedPerson } from "@/lib/lakeb2b/verifier";
import { makeLakeB2BProvider } from "./lakeb2b-provider";
import { makePublicWebProvider } from "./public-web-provider";
import type { DiscoveryProvider } from "./types";

export type { DiscoveryProvider } from "./types";

function dedupeCompanies(list: VerifiedCompany[]): VerifiedCompany[] {
  const seen = new Set<string>();
  const out: VerifiedCompany[] = [];
  for (const c of list) {
    const key = c.domain
      ? normalizeDomain(c.domain)
      : c.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function dedupePeople(list: VerifiedPerson[]): VerifiedPerson[] {
  const seen = new Set<string>();
  const out: VerifiedPerson[] = [];
  for (const p of list) {
    const key = p.linkedin_url
      ? (normalizeLinkedInUrl(p.linkedin_url) ?? p.linkedin_url)
      : `${p.full_name.trim().toLowerCase()}|${(p.company_name ?? "").toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Run two providers and union their results, primary first so it wins on
 * dedupe. Used to compose LakeB2B (best data) with public-web (broader reach)
 * so the two are ADDITIVE — web-found prospects augment LakeB2B rather than
 * being skipped. Each side degrades to [] independently, so a failure in one
 * never drops the other's results.
 */
function makeCompositeProvider(
  primary: DiscoveryProvider,
  secondary: DiscoveryProvider,
): DiscoveryProvider {
  return {
    name: primary.name,
    // Composite only forms when a real key exists, so it is never mock — but
    // defer to the members rather than hard-coding that assumption.
    async usesMockData() {
      const [a, b] = await Promise.all([
        primary.usesMockData?.() ?? false,
        secondary.usesMockData?.() ?? false,
      ]);
      return a && b;
    },
    async discoverCompanies(criteria, max) {
      const [a, b] = await Promise.all([
        primary.discoverCompanies(criteria, max).catch(() => []),
        secondary.discoverCompanies(criteria, max).catch(() => []),
      ]);
      return dedupeCompanies([...a, ...b]);
    },
    async discoverPeople(criteria, max) {
      const [a, b] = await Promise.all([
        primary.discoverPeople(criteria, max).catch(() => []),
        secondary.discoverPeople(criteria, max).catch(() => []),
      ]);
      return dedupePeople([...a, ...b]);
    },
  };
}

/**
 * Pick a discovery provider. Ordering:
 *   1. real LakeB2B key + SearXNG → COMPOSITE (LakeB2B primary + public web),
 *      so the two sources are additive.
 *   2. real LakeB2B key only      → LakeB2B (best data).
 *   3. SearXNG only               → public web (the self-hosted default).
 *   4. neither                    → LakeB2B mock client (keeps local dev usable).
 */
export async function getDiscoveryProvider(
  clerkUserId?: string,
): Promise<DiscoveryProvider> {
  const keyed = await hasLakeB2BKey(clerkUserId);
  const searx = isSearxConfigured();

  if (keyed && searx) {
    return makeCompositeProvider(
      makeLakeB2BProvider(clerkUserId),
      makePublicWebProvider(clerkUserId),
    );
  }
  if (keyed) {
    return makeLakeB2BProvider(clerkUserId);
  }
  if (searx) {
    return makePublicWebProvider(clerkUserId);
  }

  // * No LakeB2B key AND no SearXNG URL. The LakeB2B client silently swaps in
  // * its mock implementation here, which returns 20 hard-coded fixture
  // * companies (and falls back to the first 10 whenever filters match
  // * nothing). That is fine for local dev and actively dangerous anywhere
  // * else — it looks exactly like a real-but-thin result set. Warn loudly;
  // * callers additionally surface it via provider.usesMockData().
  console.warn(
    "[discovery] No LAKEB2B key and no SEARXNG_URL configured — " +
      "falling back to MOCK data. Results are fixtures, not real companies. " +
      "Set SEARXNG_URL (free, self-hosted) or a LakeB2B key to get real results.",
  );
  return makeLakeB2BProvider(clerkUserId); // mock fallback (no real key/URL)
}
