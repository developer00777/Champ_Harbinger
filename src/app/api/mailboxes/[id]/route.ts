import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { and, eq } from "drizzle-orm";

async function ownConnection(id: string, userId: string) {
  const [row] = await adminDb
    .select({ id: schema.mailboxConnections.id })
    .from(schema.mailboxConnections)
    .where(
      and(
        eq(schema.mailboxConnections.id, id),
        eq(schema.mailboxConnections.clerkUserId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await ownConnection(id, userId))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await adminDb
    .delete(schema.mailboxConnections)
    .where(eq(schema.mailboxConnections.id, id));
  return Response.json({ ok: true });
}

/** Set this mailbox as the default for the user. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await ownConnection(id, userId))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    isDefault?: boolean;
  };
  if (body.isDefault) {
    await adminDb
      .update(schema.mailboxConnections)
      .set({ isDefault: false })
      .where(eq(schema.mailboxConnections.clerkUserId, userId));
    await adminDb
      .update(schema.mailboxConnections)
      .set({ isDefault: true, status: "active" })
      .where(eq(schema.mailboxConnections.id, id));
  }
  return Response.json({ ok: true });
}
