import { NextResponse } from "next/server";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { findEmailForPerson } from "@/lib/tools/email-tools";

export const runtime = "nodejs";
export const maxDuration = 300;

// Hard cap to bound Exa cost per click. Each call may fire one Exa search
// (~$0.007) for the first contact at a brand-new org; the rest derive from
// the now-cached pattern. 50 covers typical mid-sized companies and keeps a
// runaway click bounded to ~$0.35.
const MAX_TARGETS_PER_REQUEST = 50;

/**
 * Bulk "Find emails" — runs `findEmailForPerson` for every contact at one
 * organization in a campaign that's missing a work_email. Sequential by
 * design so the first lookup at a brand-new org caches the pattern, and
 * subsequent ones at the same org derive for free.
 *
 * `organizationId` is required: this matches the per-company UI button (one
 * click = one company) and prevents accidental campaign-wide Exa fanout.
 */
export async function POST(req: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  let body: { campaignId?: string; organizationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { campaignId, organizationId } = body;
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  }
  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId required (one company per request)" },
      { status: 400 },
    );
  }

  // Ownership check on the campaign.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("user_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pull every campaign_person → person where work_email is missing, scoped
  // to the requested organization.
  const { data: rows, error } = await supabase
    .from("campaign_people")
    .select("person:people!inner(id, work_email, organization_id)")
    .eq("campaign_id", campaignId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const targets: string[] = [];
  let pendingTotal = 0;
  for (const row of rows ?? []) {
    const person = row.person as unknown as {
      id: string;
      work_email: string | null;
      organization_id: string | null;
    } | null;
    if (!person) continue;
    if (person.work_email) continue;
    if (person.organization_id !== organizationId) continue;
    pendingTotal++;
    if (targets.length < MAX_TARGETS_PER_REQUEST) {
      targets.push(person.id);
    }
  }

  const found: Array<{ personId: string; email: string; confidence?: number }> =
    [];
  const notFound: Array<{ personId: string; reason?: string }> = [];

  for (const personId of targets) {
    try {
      const result = await findEmailForPerson(personId);
      if (result.email) {
        found.push({
          personId,
          email: result.email,
          confidence: result.confidence,
        });
      } else {
        notFound.push({ personId, reason: result.reason });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      notFound.push({ personId, reason: msg });
    }
  }

  const remaining = Math.max(0, pendingTotal - targets.length);
  const truncated = remaining > 0;

  return NextResponse.json({
    total: targets.length,
    pendingTotal,
    remaining,
    truncated,
    found,
    notFound,
    summary: truncated
      ? `Found ${found.length} of ${targets.length} (${remaining} more pending — click again).`
      : `Found ${found.length} of ${targets.length} emails. ${notFound.length} not found.`,
  });
}
