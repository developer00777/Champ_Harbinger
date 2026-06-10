import { timingSafeEqual } from "node:crypto";

/**
 * Shared-secret auth for internal job-triggered routes (replaces QStash request
 * signatures). The worker attaches WORKER_SECRET; the routes verify it. When
 * WORKER_SECRET is unset (local dev), verification is skipped — matching the
 * prior behaviour where these routes were only reachable via the scheduler.
 */

const HEADER = "x-worker-secret";

export function workerHeaders(): Record<string, string> {
  const secret = process.env.WORKER_SECRET;
  return secret ? { [HEADER]: secret } : {};
}

export function verifyWorkerSecret(request: Request): boolean {
  const expected = process.env.WORKER_SECRET;
  if (!expected) return true; // unset → allow (dev)
  const got = request.headers.get(HEADER) ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Base URL the worker uses to reach the running app (compose: http://app:3000). */
export function getAppBaseUrl(): string {
  return (
    process.env.WORKER_TARGET_URL ||
    process.env.NEXT_PUBLIC_HARBINGER_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}
