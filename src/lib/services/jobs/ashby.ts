import "server-only";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { NormalizedJob } from "./greenhouse";

interface AshbyJob {
  id: string;
  title?: string;
  locationName?: string;
  updatedAt?: string;
  jobUrl?: string;
  department?: string;
  team?: string;
  employmentType?: string;
}

interface AshbyResponse {
  jobs?: AshbyJob[];
}

const ASHBY_BASE = "https://api.ashbyhq.com/posting-api/job-board";

/**
 * Fetch open job postings from an Ashby-hosted board.
 *
 * - Returns [] on 404 (slug doesn't exist / board is private).
 * - Throws on 5xx so callers can decide to retry or fall back.
 */
export async function fetchAshbyJobs(slug: string): Promise<NormalizedJob[]> {
  const url = `${ASHBY_BASE}/${encodeURIComponent(slug)}`;
  const res = await fetchWithTimeout(url, { method: "GET" }, 10_000);

  if (res.status === 404) return [];
  if (res.status >= 500) {
    throw new Error(`Ashby API ${res.status} for slug "${slug}"`);
  }
  if (!res.ok) return [];

  const data = (await res.json()) as AshbyResponse;
  const jobs = data.jobs ?? [];

  return jobs.map((j) => ({
    id: j.id,
    title: j.title ?? "",
    location: j.locationName ?? "",
    department: j.department,
    team: j.team,
    url: j.jobUrl ?? "",
    postedAt: j.updatedAt ?? "",
    ats: "ashby" as const,
  }));
}
