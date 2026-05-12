import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const { userId } = await getCurrentUser();

  const [row] = await adminDb
    .select({
      champiqUrl: schema.userSettings.champiqUrl,
      champiqHandoffMode: schema.userSettings.champiqHandoffMode,
      champiqSignalConfig: schema.userSettings.champiqSignalConfig,
    })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.clerkUserId, userId))
    .limit(1);

  const [apiKeyRow] = await adminDb
    .select({
      keyPrefix: schema.userApiKeys.keyPrefix,
      keySuffix: schema.userApiKeys.keySuffix,
    })
    .from(schema.userApiKeys)
    .where(
      and(
        eq(schema.userApiKeys.clerkUserId, userId),
        eq(schema.userApiKeys.keyName, "champiq_api_key"),
      ),
    )
    .limit(1);

  return NextResponse.json({
    champiq_url: row?.champiqUrl ?? null,
    handoff_mode: row?.champiqHandoffMode ?? "review",
    signal_config: row?.champiqSignalConfig ?? {},
    api_key_configured: !!apiKeyRow,
    api_key_prefix: apiKeyRow?.keyPrefix ?? null,
    api_key_suffix: apiKeyRow?.keySuffix ?? null,
  });
}

export async function POST(request: Request) {
  const { userId } = await getCurrentUser();

  const body = (await request.json()) as {
    champiq_url?: string;
    handoff_mode?: string;
    signal_config?: Record<
      string,
      { mode: "auto" | "review"; min_score: number }
    >;
  };

  await adminDb
    .insert(schema.userSettings)
    .values({
      clerkUserId: userId,
      champiqUrl: body.champiq_url,
      champiqHandoffMode: body.handoff_mode,
      champiqSignalConfig: body.signal_config,
    })
    .onConflictDoUpdate({
      target: [schema.userSettings.clerkUserId],
      set: {
        ...(body.champiq_url !== undefined && { champiqUrl: body.champiq_url }),
        ...(body.handoff_mode !== undefined && {
          champiqHandoffMode: body.handoff_mode,
        }),
        ...(body.signal_config !== undefined && {
          champiqSignalConfig: body.signal_config,
        }),
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}
