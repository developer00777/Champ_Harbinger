import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { INTEGRATIONS } from "@/lib/integrations";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StatusEntry {
  id: string;
  configured: boolean;
  missingEnvVars: string[];
}

/**
 * GET /api/integrations/status
 * Reports which integrations are fully configured. Returns booleans + the
 * names of any unset env vars — never the values themselves. Authenticated
 * users only, so this can't be probed by an unauthenticated client.
 *
 * For integrations with a keyName, if the env var is missing we also check
 * the user_api_keys table — a stored BYOK key counts as configured.
 */
export async function GET() {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Collect keyNames for integrations that might be configured via BYOK
  // and where at least one env var is missing.
  const byokKeyNames = INTEGRATIONS.filter(
    (i) => i.keyName && i.envVars.some((name) => !process.env[name]),
  ).map((i) => i.keyName as string);

  // Fetch all stored BYOK keys for this user in a single query.
  let storedKeyNames = new Set<string>();
  if (byokKeyNames.length > 0) {
    const rows = await adminDb
      .select({ keyName: schema.userApiKeys.keyName })
      .from(schema.userApiKeys)
      .where(
        and(
          eq(schema.userApiKeys.clerkUserId, userId),
          inArray(schema.userApiKeys.keyName, byokKeyNames),
        ),
      );
    storedKeyNames = new Set(rows.map((r) => r.keyName));
  }

  const statuses: StatusEntry[] = INTEGRATIONS.map((integration) => {
    const missingEnvVars = integration.envVars.filter(
      (name) => !process.env[name],
    );

    // If env vars are all set, integration is configured.
    if (missingEnvVars.length === 0) {
      return { id: integration.id, configured: true, missingEnvVars: [] };
    }

    // If this integration has a keyName and the user stored a BYOK key,
    // treat it as configured even though the env var is missing.
    if (integration.keyName && storedKeyNames.has(integration.keyName)) {
      return { id: integration.id, configured: true, missingEnvVars: [] };
    }

    return {
      id: integration.id,
      configured: false,
      missingEnvVars,
    };
  });

  return NextResponse.json({ statuses });
}
