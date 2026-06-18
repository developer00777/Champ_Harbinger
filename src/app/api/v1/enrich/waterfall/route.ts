import { NextResponse } from "next/server";
import { z } from "zod";

import { validateApiKey } from "@/lib/api/validate-api-key";
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
  external_ref: z.string().optional(),
  required_fields: z.array(z.string()).max(20).optional(),
  max_tier: z.enum(TierValues).optional(),
  budget_usd: z.number().min(0).optional(),
  write_back: z.boolean().optional(),
});

/**
 * POST /api/v1/enrich/waterfall
 *
 * Owned-first waterfall enrichment for ONE contact. Bearer chh_ auth (same as
 * the other v1 routes). Returns the structured EnrichmentResult + summary.
 * Runs on one OpenRouter key; LakeB2B + paid vendors engage only when configured.
 */
export async function POST(request: Request) {
  let ctx: { userId: string };
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid body";
    return NextResponse.json(
      { error: `Invalid request body: ${msg}` },
      { status: 400 },
    );
  }

  if (
    !body.name &&
    !body.company &&
    !body.domain &&
    !body.email &&
    !body.linkedin
  ) {
    return NextResponse.json(
      {
        error:
          "Provide at least one identifier: name, company, domain, email, or linkedin.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await enrichContact({
      name: body.name,
      company: body.company,
      domain: body.domain,
      email: body.email,
      linkedin: body.linkedin,
      externalRef: body.external_ref,
      requiredFields: body.required_fields,
      maxTier: body.max_tier as Tier | undefined,
      budgetUsd: body.budget_usd ?? null,
      writeBack: body.write_back,
      clerkUserId: ctx.userId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Enrichment failed: ${msg}` },
      { status: 500 },
    );
  }
}
