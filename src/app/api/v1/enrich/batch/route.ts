import { NextResponse } from "next/server";
import { z } from "zod";

import { validateApiKey } from "@/lib/api/validate-api-key";
import { enrichSet } from "@/lib/enrichment/engine";
import { Tier } from "@/lib/enrichment/types";

export const maxDuration = 300;

const TierValues = [
  "T0_master",
  "T1_lakestream",
  "T2_person",
  "T3_heavy",
  "T4_reseller",
] as const;

const ContactSchema = z.object({
  name: z.string().optional(),
  company: z.string().optional(),
  domain: z.string().optional(),
  email: z.string().optional(),
  linkedin: z.string().optional(),
  external_ref: z.string().optional(),
});

const BodySchema = z.object({
  contacts: z.array(ContactSchema).min(1).max(200),
  required_fields: z.array(z.string()).max(20).optional(),
  max_tier: z.enum(TierValues).optional(),
  budget_usd: z.number().min(0).optional(),
  write_back: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

function hasIdentifier(c: z.infer<typeof ContactSchema>): boolean {
  return Boolean(c.name || c.company || c.domain || c.email || c.linkedin);
}

/**
 * POST /api/v1/enrich/batch
 *
 * Owned-first waterfall enrichment for a LIST of contacts in one call — the
 * inbound seam for a Champ Sets "Send to Harbinger" 1-click push. Bearer chh_
 * auth (same as the other v1 routes). Each contact carries an optional
 * `external_ref` (the ChampSet row id) echoed back so the caller can reconcile.
 *
 * Processes a page (`limit`, default 25) starting at `offset` and returns
 * pagination metadata (`hasMore`, `nextOffset`) so large universes are pulled
 * through in bounded chunks that stay under the 300s route budget. Runs on one
 * OpenRouter key; LakeB2B + paid vendors engage only when configured.
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

  const missing = body.contacts.filter((c) => !hasIdentifier(c));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `${missing.length} contact(s) have no identifier. Each needs at least one of: name, company, domain, email, or linkedin.`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await enrichSet({
      contacts: body.contacts.map((c) => ({
        name: c.name,
        company: c.company,
        domain: c.domain,
        email: c.email,
        linkedin: c.linkedin,
        externalRef: c.external_ref,
      })),
      requiredFields: body.required_fields,
      maxTier: body.max_tier as Tier | undefined,
      budgetUsd: body.budget_usd ?? null,
      writeBack: body.write_back,
      limit: body.limit,
      offset: body.offset,
      clerkUserId: ctx.userId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Batch enrichment failed: ${msg}` },
      { status: 500 },
    );
  }
}
