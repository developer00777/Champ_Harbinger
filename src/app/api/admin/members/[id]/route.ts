import { eq } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";
import { requireSuperAdminApi } from "@/lib/admin/guard";
import { updateMemberSchema, usdToNumeric } from "@/lib/admin/schemas";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdminApi();
  if (guard instanceof Response) return guard;

  const { id } = await params;

  const parsed = updateMemberSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const patch: Partial<typeof schema.teamMembers.$inferInsert> = {
    updatedAt: new Date(),
  };
  if ("perUserWeeklyLimitUsd" in input)
    patch.perUserWeeklyLimitUsd = usdToNumeric(input.perUserWeeklyLimitUsd);
  if ("perUserDailyLimitUsd" in input)
    patch.perUserDailyLimitUsd = usdToNumeric(input.perUserDailyLimitUsd);
  if (input.status !== undefined) patch.status = input.status;

  const [member] = await adminDb
    .update(schema.teamMembers)
    .set(patch)
    .where(eq(schema.teamMembers.id, id))
    .returning();

  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  return Response.json({ member });
}
