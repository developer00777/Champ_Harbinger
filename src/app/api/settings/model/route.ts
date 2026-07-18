import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { CURATED_MODELS, resolveModelForUser } from "@/lib/ai/models";
import { getAppSettingString } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

/**
 * Per-user model preference. GET returns the saved preference, the effective
 * model (preference → admin default → env default), where the effective value
 * came from, and the curated pick list. POST saves/clears the preference
 * (null = "Use admin default").
 */

export async function GET() {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await adminDb
    .select({ preferredModel: schema.userSettings.preferredModel })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.clerkUserId, userId))
    .limit(1);

  const preferredModel = row?.preferredModel?.trim() || null;
  const [effectiveModel, adminDefault] = await Promise.all([
    resolveModelForUser(userId),
    getAppSettingString("default_model"),
  ]);

  return NextResponse.json({
    preferredModel,
    effectiveModel,
    effectiveSource: preferredModel ? "user" : adminDefault ? "admin" : "env",
    models: CURATED_MODELS,
  });
}

const bodySchema = z.object({
  // null = clear the preference (use the admin/env default).
  preferredModel: z.string().trim().min(1).max(200).nullable(),
});

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const preferredModel = parsed.data.preferredModel;

  const now = new Date();
  try {
    await adminDb
      .insert(schema.userSettings)
      .values({
        clerkUserId: userId,
        preferredModel,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.userSettings.clerkUserId,
        set: { preferredModel, updatedAt: now },
      });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to save model preference: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 500 },
    );
  }

  const effectiveModel = await resolveModelForUser(userId);
  return NextResponse.json({ saved: true, preferredModel, effectiveModel });
}
