import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { encryptApiKey, maskApiKey } from "@/lib/crypto";

export async function POST() {
  const { userId } = await getCurrentUser();

  const token = `chh_${randomBytes(32).toString("hex")}`;
  const { keyPrefix, keySuffix } = maskApiKey(token);
  const keyValueEncrypted = encryptApiKey(token);

  await adminDb
    .insert(schema.userApiKeys)
    .values({
      clerkUserId: userId,
      keyName: "champiq_api_key",
      keyValueEncrypted,
      keyPrefix,
      keySuffix,
    })
    .onConflictDoUpdate({
      target: [schema.userApiKeys.clerkUserId, schema.userApiKeys.keyName],
      set: { keyValueEncrypted, keyPrefix, keySuffix, updatedAt: new Date() },
    });

  // Return plaintext token once — it won't be shown again
  return NextResponse.json({ token, keyPrefix, keySuffix });
}

export async function DELETE() {
  const { userId } = await getCurrentUser();

  await adminDb
    .delete(schema.userApiKeys)
    .where(
      and(
        eq(schema.userApiKeys.clerkUserId, userId),
        eq(schema.userApiKeys.keyName, "champiq_api_key"),
      ),
    );

  return NextResponse.json({ ok: true });
}
