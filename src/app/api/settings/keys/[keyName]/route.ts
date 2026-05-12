import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ keyName: string }> },
) {
  const { userId } = await getCurrentUser();
  const { keyName } = await params;
  await adminDb
    .delete(schema.userApiKeys)
    .where(
      and(
        eq(schema.userApiKeys.clerkUserId, userId),
        eq(schema.userApiKeys.keyName, keyName),
      ),
    );
  return NextResponse.json({ deleted: true });
}
