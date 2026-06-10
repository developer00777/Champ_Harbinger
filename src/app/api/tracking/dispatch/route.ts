import { dispatchDueTrackingConfigs } from "@/lib/jobs/handlers/dispatch-tracking";
import { verifyWorkerSecret } from "@/lib/jobs/internal-auth";

export const maxDuration = 120;

/**
 * Manual / debug trigger for the tracking dispatcher. The scheduled dispatch is
 * now driven in-process by the worker (pg-boss cron); this route remains for
 * ad-hoc kicks and is guarded by the shared worker secret.
 */
export async function POST(request: Request) {
  if (!verifyWorkerSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await dispatchDueTrackingConfigs();
  return Response.json(result);
}
