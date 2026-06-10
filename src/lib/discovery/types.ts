import type { VerifiedCompany, VerifiedPerson } from "@/lib/lakeb2b/verifier";

/**
 * A discovery provider turns natural-language criteria into ICP-verified
 * companies/people. LakeB2B (when a key is configured) and public-web (SearXNG +
 * extraction) are interchangeable implementations of this interface; both reuse
 * the same criteria-translation and verification code so results are comparable.
 */
export interface DiscoveryProvider {
  readonly name: "lakeb2b" | "public-web";
  discoverCompanies(criteria: string, max: number): Promise<VerifiedCompany[]>;
  discoverPeople(criteria: string, max: number): Promise<VerifiedPerson[]>;
}
