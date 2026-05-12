import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  recordVerifiedEmail,
  makeEmailPatternDb,
} from "@/lib/services/email-pattern";

export const runtime = "nodejs";

/**
 * Record that a user manually confirmed (typed) an email for a person. The
 * server-side `recordVerifiedEmail` does role-prefix filtering and recomputes
 * the org's email pattern. The page calls this in addition to its own
 * email_drafts update, so the agent (and other contacts) benefit from the
 * confirmation.
 */
export async function POST(req: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { personId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { personId, email } = body;
  if (!personId || !email) {
    return NextResponse.json(
      { error: "personId and email are required" },
      { status: 400 },
    );
  }

  // Ownership: person must be linked to a campaign owned by this user. Without
  // this check any logged-in user could overwrite anyone's work_email and
  // poison the org's email_pattern (cross-tenant).
  const [ownership] = await adminDb
    .select({ clerkUserId: schema.campaigns.clerkUserId })
    .from(schema.campaignPeople)
    .innerJoin(
      schema.campaigns,
      eq(schema.campaignPeople.campaignId, schema.campaigns.id),
    )
    .where(eq(schema.campaignPeople.personId, personId))
    .limit(1);

  if (!ownership || ownership.clerkUserId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const epDb = makeEmailPatternDb(adminDb);
  await recordVerifiedEmail(epDb, {
    personId,
    email,
    source: "user_entered",
  });

  return NextResponse.json({ ok: true });
}
