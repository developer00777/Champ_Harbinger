import { getCurrentUser } from "@/lib/auth";
import { runAction } from "@/lib/api/guarded-action";
import { enqueueQuickStartDiscover } from "@/lib/jobs/boss";
import { assertCampaignOwned } from "@/lib/quick-start/run-discovery";

/**
 * Quick-Start "Describe criteria" entry point.
 *
 * ENQUEUES ONLY — it does not run discovery. The pipeline (LLM query-gen →
 * SearXNG → fetch dozens of homepages → LLM-normalise → ICP verify) routinely
 * runs for several minutes. Running it inline here starved the backend: on a
 * 512 MiB / 0.75 CPU container a single discovery request made every other
 * route (/api/campaigns, /api/dashboard, /api/me/provision) return 504 until it
 * finished, and killing the request restored the API instantly.
 *
 * So the work moved to the pg-boss worker, which exists for exactly this and is
 * already fair-dispatched and budget-guarded. This route returns 202 with a
 * jobId; the client polls GET /api/quick-start/discover/status?jobId=...
 *
 * maxDuration is now small on purpose — enqueueing is a couple of DB writes.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    criteria,
    campaignId,
    limit: rawLimit,
  } = body as {
    criteria?: string;
    targetType?: string;
    campaignId?: string;
    limit?: number;
  };

  // * Was a hard-coded 20 at the discoverCompanies call. The provider now
  // * paginates upstream, so this is a real target rather than one page.
  const limit = Math.min(Math.max(Number(rawLimit) || 200, 1), 1000);

  if (!criteria || !criteria.trim()) {
    return Response.json({ error: "criteria is required" }, { status: 400 });
  }

  if (campaignId) {
    const owned = await assertCampaignOwned(campaignId, userId);
    if (owned === "not_found") {
      return Response.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (owned === "forbidden") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return runAction(
    `Quick-Start discover (enqueue): ${criteria.slice(0, 60)}`,
    async () => {
      const jobId = await enqueueQuickStartDiscover({
        criteria: criteria.trim(),
        userId,
        campaignId: campaignId ?? null,
        limit,
      });

      if (!jobId) {
        // pg-boss returns null when a singletonKey collides — a run for this
        // user+campaign is already in flight. Not an error; say so plainly.
        return Response.json(
          {
            queued: false,
            alreadyRunning: true,
            campaignId: campaignId ?? null,
            message:
              "A discovery run is already in progress for this campaign.",
          },
          { status: 202 },
        );
      }

      return Response.json(
        { queued: true, jobId, campaignId: campaignId ?? null },
        { status: 202 },
      );
    },
  );
}
