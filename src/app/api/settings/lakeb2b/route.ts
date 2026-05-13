import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await getCurrentUser();
  const [settings] = await adminDb
    .select({ lakeb2bBaseUrl: schema.userSettings.lakeb2bBaseUrl })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.clerkUserId, userId))
    .limit(1);
  return NextResponse.json({ baseUrl: settings?.lakeb2bBaseUrl ?? null });
}

export async function PATCH(request: Request) {
  const { userId } = await getCurrentUser();
  const { baseUrl } = (await request.json()) as { baseUrl: string };
  await adminDb
    .insert(schema.userSettings)
    .values({ clerkUserId: userId, lakeb2bBaseUrl: baseUrl || null })
    .onConflictDoUpdate({
      target: [schema.userSettings.clerkUserId],
      set: { lakeb2bBaseUrl: baseUrl || null },
    });
  return NextResponse.json({ saved: true });
}
