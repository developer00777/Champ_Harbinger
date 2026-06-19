import { eq } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";
import { requireSuperAdminApi } from "@/lib/admin/guard";
import { updateTeamSchema, usdToNumeric } from "@/lib/admin/schemas";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdminApi();
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const { id } = await params;

  const parsed = updateTeamSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const patch: Partial<typeof schema.teams.$inferInsert> = {
    updatedBy: userId,
    updatedAt: new Date(),
  };
  if (input.name !== undefined) patch.name = input.name;
  if ("weeklyLimitUsd" in input)
    patch.weeklyLimitUsd = usdToNumeric(input.weeklyLimitUsd);
  if ("perUserDefaultWeeklyLimitUsd" in input)
    patch.perUserDefaultWeeklyLimitUsd = usdToNumeric(
      input.perUserDefaultWeeklyLimitUsd,
    );
  if (input.hardStop !== undefined) patch.hardStop = input.hardStop;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const [team] = await adminDb
    .update(schema.teams)
    .set(patch)
    .where(eq(schema.teams.id, id))
    .returning();

  if (!team) {
    return Response.json({ error: "Team not found" }, { status: 404 });
  }
  return Response.json({ team });
}
