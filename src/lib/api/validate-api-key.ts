import { eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { decryptApiKey } from "@/lib/crypto";

export interface ApiKeyContext {
  userId: string;
}

/**
 * Validates a `chh_` Bearer token against the userApiKeys table.
 * Returns the workspace userId on success, throws a Response on failure.
 * Used by all /api/v1/* route handlers.
 */
export async function validateApiKey(request: Request): Promise<ApiKeyContext> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token.startsWith("chh_")) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = await adminDb
    .select()
    .from(schema.userApiKeys)
    .where(eq(schema.userApiKeys.keyName, "champiq_api_key"));

  for (const row of rows) {
    try {
      const decrypted = decryptApiKey(row.keyValueEncrypted);
      if (decrypted === token) {
        return { userId: row.clerkUserId };
      }
    } catch {
      // Decryption failed for this row — try next
    }
  }

  throw new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
