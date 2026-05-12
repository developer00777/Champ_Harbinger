import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

/**
 * PATCH /api/people/[id]
 * Updates mutable fields on a person record, and optionally cascades an email
 * change to matching draft rows.
 *
 * Body: {
 *   field: "work_email" | "personal_email";
 *   value: string | null;
 *   oldEmail?: string | null;   // when provided, cascade update to matching drafts
 * }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    field: "work_email" | "personal_email";
    value: string | null;
    oldEmail?: string | null;
  };

  if (!body.field || !["work_email", "personal_email"].includes(body.field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const now = new Date();
  const patch =
    body.field === "work_email"
      ? { workEmail: body.value ?? null, updatedAt: now }
      : { personalEmail: body.value ?? null, updatedAt: now };

  await sdb.raw
    .update(schema.people)
    .set(patch)
    .where(eq(schema.people.id, id));

  // Cascade email change to draft rows that still carry the old address
  if (body.oldEmail) {
    const newEmail = body.value ?? body.oldEmail;
    await sdb.raw
      .update(schema.emailDrafts)
      .set({ toEmail: newEmail, updatedAt: now })
      .where(
        and(
          eq(schema.emailDrafts.personId, id),
          eq(schema.emailDrafts.status, "draft"),
          eq(schema.emailDrafts.toEmail, body.oldEmail),
        ),
      );
  }

  return NextResponse.json({ ok: true });
}
