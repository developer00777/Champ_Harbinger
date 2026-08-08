import { timingSafeEqual } from "node:crypto";

/**
 * Lets the standalone worker (Coolify) pull provider config from the app
 * (Vercel) instead of keeping its own copy. This is what makes "put the keys
 * in the Vercel environment variables, and that's it" literally true even
 * though the worker is a separate process/host: rotate a key in Vercel and
 * the worker picks it up on its next poll (see src/lib/jobs/worker-config.ts),
 * no worker redeploy required.
 *
 * Only an explicit allowlist is ever returned. Infra secrets the worker
 * already has locally (DATABASE_URL, WORKER_SECRET, HARBINGER_SECRET,
 * CLERK_SECRET_KEY) are never included here, even if someone adds them to
 * ALLOWED_KEYS by mistake — see the EXCLUDED check below.
 *
 * Unlike verifyWorkerSecret()'s dev-friendly "unset → allow" behaviour, this
 * route 404s (not 401 — don't even confirm it exists) whenever WORKER_SECRET
 * is unset, because a leak here hands out live provider keys.
 */

const HEADER = "x-worker-secret";

const ALLOWED_KEYS = [
  "OPENROUTER_API_KEY",
  "HARBINGER_DEFAULT_MODEL",
  "PDL_API_KEY",
  "PDL_MIN_LIKELIHOOD",
  "APOLLO_API_KEY",
  "CORESIGNAL_API_KEY",
  "COST_CORESIGNAL",
  "LAKEB2B_API_KEY",
  "LAKEB2B_API_URL",
  "INBOXKIT_API_KEY",
  "INBOXKIT_WORKSPACE_ID",
  "INBOXKIT_BASE_URL",
  "INBOXKIT_WEBHOOK_SECRET",
  "CHAMPMAIL_API_KEY",
  "CHAMPMAIL_BASE_URL",
  "CHAMPMAIL_DOMAIN_ID",
  "CHAMPMAIL_WEBHOOK_SECRET",
  "EMAIL_PROVIDER",
  "PROVIDER_PRIORITY",
  "COST_PDL",
  "COST_APOLLO",
  "COST_LAKEB2B",
  "GOOGLE_API_KEY",
] as const;

// Belt-and-suspenders: these must never leave this process, no matter what
// ALLOWED_KEYS says. Checked at request time, not just by code review.
const NEVER_INCLUDE = new Set([
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "WORKER_SECRET",
  "HARBINGER_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

function verifyWorkerSecretStrict(request: Request): boolean {
  const expected = process.env.WORKER_SECRET;
  if (!expected) return false; // unset → deny (this route returns secrets)
  const got = request.headers.get(HEADER) ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!verifyWorkerSecretStrict(request)) {
    // 404, not 401 — don't confirm this route does anything to an
    // unauthenticated caller.
    return new Response(null, { status: 404 });
  }

  const config: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) {
    if (NEVER_INCLUDE.has(key)) continue; // defense in depth, see above
    const value = process.env[key];
    if (value !== undefined && value !== "") {
      config[key] = value;
    }
  }

  return Response.json({ config });
}
