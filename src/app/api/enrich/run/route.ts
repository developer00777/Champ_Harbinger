import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { assertWithinBudget } from "@/lib/budget/guard";
import { budgetErrorResponse } from "@/lib/budget/respond";
import { enrichContact } from "@/lib/enrichment/engine";
import { Tier } from "@/lib/enrichment/types";

export const maxDuration = 300;

const TierValues = [
  "T0_master",
  "T1_lakestream",
  "T2_person",
  "T3_heavy",
  "T4_reseller",
] as const;

const BodySchema = z.object({
  name: z.string().optional(),
  company: z.string().optional(),
  domain: z.string().optional(),
  email: z.string().optional(),
  linkedin: z.string().optional(),
  externalRef: z.string().optional(),
  requiredFields: z.array(z.string()).max(20).optional(),
  budgetUsd: z.number().min(0).nullable().optional(),
  maxTier: z.enum(TierValues).optional(),
});

/**
 * POST /api/enrich/run
 *
 * Clerk-gated, single-contact waterfall run for the live Enrich screen. The UI
 * drives a campaign's candidates through this one at a time (bounded
 * concurrency) and renders each row as it resolves — which tier filled each
 * field, confidence, and spend so far. Reuses the same engine as the v1 batch
 * API; enrichContact persists the contact + provenance + master build-up.
 */
export async function POST(request: Request) {
  let userId: string;
  let orgId: string | null;
  try {
    ({ userId, orgId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid body";
    return Response.json({ error: `Invalid body: ${msg}` }, { status: 400 });
  }

  if (
    !body.name &&
    !body.company &&
    !body.domain &&
    !body.email &&
    !body.linkedin
  ) {
    return Response.json(
      { error: "Provide at least one identifier (name, company, domain, …)." },
      { status: 400 },
    );
  }

  try {
    await assertWithinBudget({ userId });
  } catch (err) {
    const blocked = budgetErrorResponse(err);
    if (blocked) return blocked;
    throw err;
  }

  try {
    const result = await enrichContact({
      name: body.name,
      company: body.company,
      domain: body.domain,
      email: body.email,
      linkedin: body.linkedin,
      externalRef: body.externalRef,
      requiredFields: body.requiredFields,
      budgetUsd: body.budgetUsd ?? null,
      maxTier: body.maxTier as Tier | undefined,
      clerkUserId: userId,
      clerkOrgId: orgId,
    });
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Enrichment failed: ${msg}` },
      { status: 500 },
    );
  }
}
