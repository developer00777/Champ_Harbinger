import { hasLakeB2BKey } from "@/lib/lakeb2b/client";
import { isSearxConfigured } from "@/lib/search/searxng-client";
import { makeLakeB2BProvider } from "./lakeb2b-provider";
import { makePublicWebProvider } from "./public-web-provider";
import type { DiscoveryProvider } from "./types";

export type { DiscoveryProvider } from "./types";

/**
 * Pick a discovery provider. Public-web is the default; LakeB2B is used as an
 * add-on when a real key is configured. Ordering:
 *   1. real LakeB2B key  → LakeB2B (best data)
 *   2. SearXNG configured → public web (the self-hosted default)
 *   3. neither            → LakeB2B mock client (keeps local dev usable)
 */
export async function getDiscoveryProvider(
  clerkUserId?: string,
): Promise<DiscoveryProvider> {
  if (await hasLakeB2BKey(clerkUserId)) {
    return makeLakeB2BProvider(clerkUserId);
  }
  if (isSearxConfigured()) {
    return makePublicWebProvider();
  }
  return makeLakeB2BProvider(clerkUserId); // mock fallback (no real key/URL)
}
