import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";

/**
 * Public marketing layout — no Clerk auth required.
 * This route group intentionally omits DashboardShell and any auth gates.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <MarketingHeader />
      <main className="min-h-screen">{children}</main>
      <MarketingFooter />
    </>
  );
}
