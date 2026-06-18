import "server-only";
import { getUserApiKey } from "@/lib/db/user-keys";

/**
 * Resolve a provider API key: a user-stored key (via getUserApiKey) takes
 * precedence, then an environment fallback. This mirrors the rest of the repo
 * (see src/lib/lakeb2b/client.ts -> getLakeB2BClient).
 *
 * The waterfall can run with no Clerk session (e.g. from a system cron), in
 * which case clerkUserId is undefined and we fall straight back to the env var.
 * Adapters that get null no-op gracefully.
 */
export async function resolveProviderKey(
  keyName: string,
  envValue: string | undefined,
  clerkUserId?: string,
): Promise<string | null> {
  if (clerkUserId) {
    try {
      return await getUserApiKey(keyName, clerkUserId, envValue);
    } catch {
      return envValue ?? null;
    }
  }
  return envValue ?? null;
}
