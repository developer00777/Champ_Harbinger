import { getAppBaseUrl, workerHeaders } from "@/lib/jobs/internal-auth";

/**
 * Worker-side half of GET /api/internal/worker-config. The worker (Coolify)
 * has no provider keys of its own — it pulls them from the app (Vercel) so
 * "put the keys in the Vercel environment variables, and that's it" holds
 * even for the background jobs that don't run in the Next.js process.
 *
 * The same allowlist as the route — kept in sync manually since the route
 * lives in the Next.js app and this module is imported by the standalone
 * worker script (scripts/run-worker.ts), which does not share a build with
 * API route files.
 */
const ALLOWED_KEYS = new Set([
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
  "INBOXKIT_MAILBOX_PLATFORM",
  "INBOXKIT_DEFAULT_REDIRECT_URL",
  "INBOXKIT_CONTACT_FIRST_NAME",
  "INBOXKIT_CONTACT_LAST_NAME",
  "INBOXKIT_CONTACT_EMAIL",
  "INBOXKIT_CONTACT_PHONE",
  "INBOXKIT_CONTACT_ADDRESS",
  "INBOXKIT_CONTACT_CITY",
  "INBOXKIT_CONTACT_STATE",
  "INBOXKIT_CONTACT_ZIP",
  "INBOXKIT_CONTACT_COUNTRY",
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
]);

const POLL_INTERVAL_MS = 60_000;

/** Apply a fetched config bundle into process.env, allowlisted keys only. */
export function applyWorkerConfig(config: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(config)) {
    if (!ALLOWED_KEYS.has(key)) continue; // ignore anything unexpected
    if (typeof value !== "string") continue;
    process.env[key] = value;
  }
}

async function fetchWorkerConfig(): Promise<Record<string, unknown> | null> {
  const base = getAppBaseUrl();
  try {
    const res = await fetch(`${base}/api/internal/worker-config`, {
      headers: workerHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(
        `[worker-config] fetch failed: ${res.status} ${res.statusText}`,
      );
      return null;
    }
    const body = (await res.json()) as { config?: Record<string, unknown> };
    return body.config ?? null;
  } catch (err) {
    console.error("[worker-config] fetch error:", err);
    return null;
  }
}

/**
 * Fetch once and apply. On failure, logs and leaves process.env untouched —
 * whatever was applied by the previous successful poll (or the worker's own
 * local env, on the very first failed attempt) stays in effect. Never throws:
 * a config-pull hiccup must not crash the worker or block job processing.
 */
export async function refreshWorkerConfig(): Promise<void> {
  const config = await fetchWorkerConfig();
  if (!config) return; // keep last-good bundle
  applyWorkerConfig(config);
}

/**
 * Start polling for config in the background. Call once at worker boot,
 * after an initial refreshWorkerConfig() so the first job has real keys
 * whenever possible.
 */
export function startWorkerConfigPolling(): NodeJS.Timeout {
  return setInterval(() => {
    void refreshWorkerConfig();
  }, POLL_INTERVAL_MS);
}
