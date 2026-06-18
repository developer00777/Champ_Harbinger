import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";
import { requireSuperAdminApi } from "@/lib/admin/guard";
import { createTeamSchema, usdToNumeric } from "@/lib/admin/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireSuperAdminApi();
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const parsed = createTeamSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const [team] = await adminDb
    .insert(schema.teams)
    .values({
      name: input.name,
      weeklyLimitUsd: usdToNumeric(input.weeklyLimitUsd),
      perUserDefaultWeeklyLimitUsd: usdToNumeric(
        input.perUserDefaultWeeklyLimitUsd,
      ),
      hardStop: input.hardStop ?? true,
      updatedBy: userId,
    })
    .returning();

  return Response.json({ team }, { status: 201 });
}
