import "server-only";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { NormalizedJob } from "./greenhouse";

interface LeverPosting {
  id: string;
  text?: string;
  hostedUrl?: string;
  createdAt?: number | string;
  categories?: {
    team?: string;
    location?: string;
    commitment?: string;
    department?: string;
  };
}

const LEVER_BASE = "https://api.lever.co/v0/postings";

/**
 * Fetch open job postings from a Lever-hosted board.
 *
 * - Returns [] on 404 (slug doesn't exist).
 * - Throws on 5xx so callers can decide to retry or fall back.
 */
export async function fetchLeverJobs(slug: string): Promise<NormalizedJob[]> {
  const url = `${LEVER_BASE}/${encodeURIComponent(slug)}?mode=json`;
  const res = await fetchWithTimeout(url, { method: "GET" }, 10_000);

  if (res.status === 404) return [];
  if (res.status >= 500) {
    throw new Error(`Lever API ${res.status} for slug "${slug}"`);
  }
  if (!res.ok) return [];

  const data = (await res.json()) as LeverPosting[] | null;
  if (!Array.isArray(data)) return [];

  return data.map((j) => ({
    id: j.id,
    title: j.text ?? "",
    location: j.categories?.location ?? "",
    department: j.categories?.department,
    team: j.categories?.team,
    url: j.hostedUrl ?? "",
    postedAt:
      typeof j.createdAt === "number"
        ? new Date(j.createdAt).toISOString()
        : (j.createdAt ?? ""),
    ats: "lever" as const,
  }));
}
