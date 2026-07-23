import { NextResponse } from "next/server";

import { verifyWorkerSecret } from "@/lib/jobs/internal-auth";
import { requireSuperAdmin } from "@/lib/auth";
import { processPendingReplies } from "@/lib/aisdr/process";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/aisdr/process
 *
 * Runs the reply-detection batch driver (processPendingReplies). Callable
 * two ways, matching the existing internal-job convention (see
 * src/app/api/admin/alerts/run/route.ts):
 *  - by the internal worker with the x-worker-secret header, or
 *  - by a signed-in super-admin (manual trigger).
 *
 * NOTE for the coordinator: this route intentionally does not register a
 * pg-boss job — schedule a recurring job in src/lib/jobs/** that POSTs here
 * with workerHeaders() from src/lib/jobs/internal-auth.
 */
export async function POST(request: Request) {
  const hasWorkerHeader = request.headers.get("x-worker-secret") != null;
  const workerOk = hasWorkerHeader && verifyWorkerSecret(request);
  if (!workerOk) {
    try {
      await requireSuperAdmin();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await processPendingReplies();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/aisdr/process] failed:", err);
    return NextResponse.json({ error: "Process run failed" }, { status: 500 });
  }
}
