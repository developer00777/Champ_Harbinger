import "server-only";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * Normalized job posting shape, identical across all three ATS providers.
 * Letting downstream tools treat ATS-sourced jobs uniformly.
 */
export interface NormalizedJob {
  id: string;
  title: string;
  location?: string;
  department?: string;
  team?: string;
  url: string;
  postedAt?: string;
  ats: "greenhouse" | "lever" | "ashby";
}

interface GreenhouseJob {
  id: number | string;
  title?: string;
  location?: { name?: string };
  updated_at?: string;
  absolute_url?: string;
  departments?: Array<{ name?: string }>;
  offices?: Array<{ name?: string }>;
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
}

const GREENHOUSE_BASE = "https://boards-api.greenhouse.io/v1/boards";

/**
 * Fetch open job postings from a Greenhouse-hosted board.
 *
 * - Returns [] on 404 (slug doesn't exist / board is private).
 * - Throws on 5xx so callers can decide to retry or fall back.
 */
export async function fetchGreenhouseJobs(
  slug: string,
): Promise<NormalizedJob[]> {
  const url = `${GREENHOUSE_BASE}/${encodeURIComponent(slug)}/jobs`;
  const res = await fetchWithTimeout(url, { method: "GET" }, 10_000);

  if (res.status === 404) return [];
  if (res.status >= 500) {
    throw new Error(`Greenhouse API ${res.status} for slug "${slug}"`);
  }
  if (!res.ok) return [];

  const data = (await res.json()) as GreenhouseResponse;
  const jobs = data.jobs ?? [];

  return jobs.map((j) => ({
    id: String(j.id),
    title: j.title ?? "",
    location: j.location?.name ?? "",
    department: j.departments?.[0]?.name,
    team: j.offices?.[0]?.name,
    url: j.absolute_url ?? "",
    postedAt: j.updated_at ?? "",
    ats: "greenhouse" as const,
  }));
}
