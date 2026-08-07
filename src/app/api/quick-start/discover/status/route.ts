import { getCurrentUser } from "@/lib/auth";
import { getBoss, QUICK_START_DISCOVER } from "@/lib/jobs/boss";
import type { QuickStartDiscoverJob } from "@/lib/jobs/boss";
import type { RunDiscoveryResult } from "@/lib/quick-start/run-discovery";

export const dynamic = "force-dynamic";

/**
 * Poll target for a backgrounded Quick-Start discovery run.
 *
 * State comes straight from pg-boss — no extra table. The worker returns its
 * result from the handler, which pg-boss stores as the job output, so a
 * completed job carries the full company list here.
 *
 * Ownership: the job payload records the userId that enqueued it, and we refuse
 * to hand a run's results to anyone else. Without that check a job id would be
 * enough to read another user's discovery output.
 */
export async function GET(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    return Response.json({ error: "jobId is required" }, { status: 400 });
  }

  const boss = await getBoss();
  const job = await boss.getJobById(QUICK_START_DISCOVER, jobId);

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const payload = job.data as QuickStartDiscoverJob | undefined;
  if (payload?.userId && payload.userId !== userId) {
    // Don't leak that it exists.
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const state = job.state as string;

  if (state === "completed") {
    return Response.json({
      state,
      done: true,
      result: (job.output ?? null) as RunDiscoveryResult | null,
    });
  }

  if (state === "failed" || state === "cancelled" || state === "expired") {
    const out = job.output as { message?: string } | null;
    return Response.json({
      state,
      done: true,
      error:
        out?.message ??
        `Discovery ${state}. Check the worker logs for the underlying cause.`,
    });
  }

  // created / retry / active
  return Response.json({ state, done: false });
}
