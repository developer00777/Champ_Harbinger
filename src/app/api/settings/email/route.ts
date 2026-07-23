import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getEmailProvider } from "@/lib/email/provider";

export async function GET() {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [settings] = await adminDb
    .select({
      fromName: schema.userSettings.fromName,
      replyToEmail: schema.userSettings.replyToEmail,
      warmIntroEmail: schema.userSettings.warmIntroEmail,
      warmIntroName: schema.userSettings.warmIntroName,
      aisdrMode: schema.userSettings.aisdrMode,
    })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.clerkUserId, userId))
    .limit(1);

  const provider = getEmailProvider();

  return NextResponse.json({
    settings: settings
      ? {
          from_name: settings.fromName ?? null,
          reply_to_email: settings.replyToEmail ?? null,
          warm_intro_email: settings.warmIntroEmail ?? null,
          warm_intro_name: settings.warmIntroName ?? null,
          aisdr_mode: settings.aisdrMode ?? "review",
        }
      : {
          from_name: null,
          reply_to_email: null,
          warm_intro_email: null,
          warm_intro_name: null,
          aisdr_mode: "review",
        },
    is_configured: provider.enabled,
    provider_name: provider.name,
  });
}

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    from_name,
    reply_to_email,
    warm_intro_email,
    warm_intro_name,
    aisdr_mode,
  } = body as {
    from_name?: string | null;
    reply_to_email?: string | null;
    warm_intro_email?: string | null;
    warm_intro_name?: string | null;
    aisdr_mode?: "review" | "auto" | null;
  };

  if (aisdr_mode && aisdr_mode !== "review" && aisdr_mode !== "auto") {
    return NextResponse.json({ error: "Invalid aisdr_mode" }, { status: 400 });
  }

  const now = new Date();

  try {
    await adminDb
      .insert(schema.userSettings)
      .values({
        clerkUserId: userId,
        fromName: from_name ?? null,
        replyToEmail: reply_to_email ?? null,
        warmIntroEmail: warm_intro_email ?? null,
        warmIntroName: warm_intro_name ?? null,
        aisdrMode: aisdr_mode ?? "review",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.userSettings.clerkUserId,
        set: {
          fromName: from_name ?? null,
          replyToEmail: reply_to_email ?? null,
          warmIntroEmail: warm_intro_email ?? null,
          warmIntroName: warm_intro_name ?? null,
          aisdrMode: aisdr_mode ?? "review",
          updatedAt: now,
        },
      });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to save settings: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ saved: true });
}
