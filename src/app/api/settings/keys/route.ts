import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { encryptApiKey, maskApiKey } from "@/lib/crypto";

export async function GET() {
  const { userId } = await getCurrentUser();
  const rows = await adminDb
    .select({
      keyName: schema.userApiKeys.keyName,
      keyPrefix: schema.userApiKeys.keyPrefix,
      keySuffix: schema.userApiKeys.keySuffix,
      updatedAt: schema.userApiKeys.updatedAt,
    })
    .from(schema.userApiKeys)
    .where(eq(schema.userApiKeys.clerkUserId, userId));

  return NextResponse.json(rows.map((r) => ({ ...r, configured: true })));
}

export async function POST(request: Request) {
  const { userId } = await getCurrentUser();
  const { keyName, keyValue } = (await request.json()) as {
    keyName: string;
    keyValue: string;
  };

  if (!keyName || !keyValue) {
    return NextResponse.json(
      { error: "keyName and keyValue are required" },
      { status: 400 },
    );
  }

  const { keyPrefix, keySuffix } = maskApiKey(keyValue);
  const keyValueEncrypted = encryptApiKey(keyValue);

  await adminDb
    .insert(schema.userApiKeys)
    .values({
      clerkUserId: userId,
      keyName,
      keyValueEncrypted,
      keyPrefix,
      keySuffix,
    })
    .onConflictDoUpdate({
      target: [schema.userApiKeys.clerkUserId, schema.userApiKeys.keyName],
      set: { keyValueEncrypted, keyPrefix, keySuffix, updatedAt: new Date() },
    });

  return NextResponse.json({ keyName, keyPrefix, keySuffix, configured: true });
}
