import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import { findEmailForPerson } from "@/lib/tools/email-tools";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * User-triggered "Find email" for a single contact. Wraps the same
 * findEmailForPerson logic the agent uses, with an ownership check so users
 * can only resolve emails for people in their own campaigns.
 */
export async function POST(req: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { personId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const personId = body.personId;
  if (!personId) {
    return NextResponse.json({ error: "personId required" }, { status: 400 });
  }

  // Ownership check: person must be linked to a campaign owned by this user.
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

  const result = await findEmailForPerson(personId);
  return NextResponse.json(result);
}
