import { NextResponse } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

function mapSkill(s: typeof schema.emailSkills.$inferSelect) {
  return {
    id: s.id,
    user_id: s.clerkUserId,
    name: s.name,
    slug: s.slug,
    description: s.description,
    instructions: s.instructions,
    is_builtin: s.isBuiltin,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

/**
 * PATCH /api/email-skills/[id]
 * Updates a custom (non-builtin) email skill owned by the current user.
 *
 * Body: { name?: string; description?: string | null; instructions?: string }
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
    name?: string;
    description?: string | null;
    instructions?: string;
  };

  const patch: Partial<typeof schema.emailSkills.$inferInsert> & {
    updatedAt?: Date;
  } = { updatedAt: new Date() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.instructions !== undefined) patch.instructions = body.instructions;

  const updated = await sdb.raw
    .update(schema.emailSkills)
    .set(patch)
    .where(
      and(
        eq(schema.emailSkills.id, id),
        // Only allow editing skills owned by this user (not built-ins)
        or(
          eq(schema.emailSkills.clerkUserId, sdb.userId),
          isNull(schema.emailSkills.clerkUserId),
        ),
      ),
    )
    .returning();

  if (!updated[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(mapSkill(updated[0]));
}

/**
 * DELETE /api/email-skills/[id]
 * Deletes a custom email skill owned by the current user.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await sdb.raw
    .delete(schema.emailSkills)
    .where(
      and(
        eq(schema.emailSkills.id, id),
        eq(schema.emailSkills.clerkUserId, sdb.userId),
      ),
    );

  return NextResponse.json({ ok: true });
}
