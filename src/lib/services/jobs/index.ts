import "server-only";
import { fetchGreenhouseJobs, type NormalizedJob } from "./greenhouse";
import { fetchLeverJobs } from "./lever";
import { fetchAshbyJobs } from "./ashby";

export type ATSProvider = "greenhouse" | "lever" | "ashby";
export type { NormalizedJob } from "./greenhouse";
export { fetchGreenhouseJobs } from "./greenhouse";
export { fetchLeverJobs } from "./lever";
export { fetchAshbyJobs } from "./ashby";

/**
 * Fetch open jobs for a company from one or all known ATS providers.
 *
 * - `ats: "all"` (default) fans out to all three in parallel; any single
 *   provider failure is logged and treated as no results, so a single slow
 *   ATS can't block the others.
 * - Passing a single provider returns just that one (and propagates 5xx).
 */
export async function fetchJobsForCompany(
  slug: string,
  ats: ATSProvider | "all" = "all",
): Promise<NormalizedJob[]> {
  if (ats === "greenhouse") return fetchGreenhouseJobs(slug);
  if (ats === "lever") return fetchLeverJobs(slug);
  if (ats === "ashby") return fetchAshbyJobs(slug);

  const results = await Promise.allSettled([
    fetchGreenhouseJobs(slug),
    fetchLeverJobs(slug),
    fetchAshbyJobs(slug),
  ]);

  const seen = new Set<string>();
  const combined: NormalizedJob[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const job of r.value) {
      const key = `${job.ats}:${job.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(job);
    }
  }
  return combined;
}

/**
 * Detect which ATS hosts a given careers URL based on hostname/path patterns.
 * Returns null when the URL is unparseable or doesn't match any known ATS.
 */
export function detectATSFromCareersUrl(url: string): ATSProvider | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const full = `${host}${path}`;

  if (host.includes("greenhouse.io") || full.includes("/boards.greenhouse.io/")) {
    return "greenhouse";
  }
  if (host.includes("lever.co")) return "lever";
  if (host.includes("ashbyhq.com")) return "ashby";

  return null;
}
