import { redirect } from "next/navigation";

import { requireSuperAdmin } from "@/lib/auth";
import { buildAdminOverview } from "@/lib/admin/overview";
import { AdminConsole } from "@/components/admin/admin-console";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin · ChampHarbinger",
};

export default async function AdminPage() {
  try {
    await requireSuperAdmin();
  } catch {
    redirect("/dashboard");
  }

  const overview = await buildAdminOverview();

  return (
    <div className="flex-1 overflow-y-auto">
      <AdminConsole initial={overview} />
    </div>
  );
}
