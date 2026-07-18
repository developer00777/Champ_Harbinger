import { requireSuperAdminApi } from "@/lib/admin/guard";
import { runUsageAlerts } from "@/lib/admin/alerts";
import { verifyWorkerSecret } from "@/lib/jobs/internal-auth";

export const dynamic = "force-dynamic";

/**
 * Runs the usage-alert sweep. Callable two ways so it can be cron'd:
 *  - by the internal worker with the x-worker-secret header (see
 *    src/lib/jobs/internal-auth.ts), or
 *  - by a signed-in super-admin (manual trigger from the console / curl).
 *
 * NOTE for the coordinator: schedule a recurring job (e.g. hourly) in
 * src/lib/jobs/** that POSTs here with workerHeaders() — this module does not
 * touch the jobs tree.
 */
export async function POST(request: Request) {
  // The worker authenticates with the shared-secret header; anything else
  // (including a wrong secret) falls through to the super-admin session check.
  const hasWorkerHeader = request.headers.get("x-worker-secret") != null;
  const workerOk = hasWorkerHeader && verifyWorkerSecret(request);
  if (!workerOk) {
    const guard = await requireSuperAdminApi();
    if (guard instanceof Response) return guard;
  }

  try {
    const result = await runUsageAlerts();
    return Response.json(result);
  } catch (err) {
    console.error("[alerts] run failed:", err);
    return Response.json({ error: "Alert run failed" }, { status: 500 });
  }
}
