import "server-only";
import { and, eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { decryptApiKey } from "@/lib/crypto";

/**
 * Returns the decrypted API key for a user, or null if not set.
 * Falls back to the provided env var value if the user has not stored their own.
 */
export async function getUserApiKey(
  keyName: string,
  clerkUserId: string,
  envFallback?: string,
): Promise<string | null> {
  const [row] = await adminDb
    .select({ keyValueEncrypted: schema.userApiKeys.keyValueEncrypted })
    .from(schema.userApiKeys)
    .where(
      and(
        eq(schema.userApiKeys.clerkUserId, clerkUserId),
        eq(schema.userApiKeys.keyName, keyName),
      ),
    )
    .limit(1);

  if (row) {
    try {
      return decryptApiKey(row.keyValueEncrypted);
    } catch {
      return envFallback ?? null;
    }
  }
  return envFallback ?? null;
}
