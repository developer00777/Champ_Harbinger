import type { VerifiedCompany, VerifiedPerson } from "@/lib/lakeb2b/verifier";

/**
 * A discovery provider turns natural-language criteria into ICP-verified
 * companies/people. LakeB2B (when a key is configured), Coresignal (a
 * plug-and-play stand-in for testing without LakeB2B — see
 * src/lib/discovery/coresignal-provider.ts), and public-web (SearXNG +
 * extraction) are interchangeable implementations of this interface; all
 * reuse the same verification code so results are comparable.
 */
export interface DiscoveryProvider {
  readonly name: "lakeb2b" | "coresignal" | "public-web" | "composite";
  /**
   * True when this provider is serving built-in fixture data rather than real
   * results — i.e. no LakeB2B key and no SearXNG URL is configured, so the
   * LakeB2B client silently falls back to its 20 hard-coded mock companies.
   * Callers MUST surface this; presenting fixtures as leads is worse than
   * returning nothing.
   */
  usesMockData?(): Promise<boolean>;
  discoverCompanies(criteria: string, max: number): Promise<VerifiedCompany[]>;
  discoverPeople(criteria: string, max: number): Promise<VerifiedPerson[]>;
}
