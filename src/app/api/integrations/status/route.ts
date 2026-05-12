import { NextResponse } from "next/server";
import { INTEGRATIONS } from "@/lib/integrations";
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
 */
export async function GET() {
  try {
    await getCurrentUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statuses: StatusEntry[] = INTEGRATIONS.map((integration) => {
    const missingEnvVars = integration.envVars.filter(
      (name) => !process.env[name],
    );
    return {
      id: integration.id,
      configured: missingEnvVars.length === 0,
      missingEnvVars,
    };
  });

  return NextResponse.json({ statuses });
}
