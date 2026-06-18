import { requireSuperAdminApi } from "@/lib/admin/guard";
import { buildAdminOverview } from "@/lib/admin/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireSuperAdminApi();
  if (guard instanceof Response) return guard;

  const overview = await buildAdminOverview();
  return Response.json(overview);
}
