import { NextResponse } from "next/server";

/**
 * Delivery tracking endpoint.
 *
 * Previously polled AgentMail for delivery status. AgentMail has been removed
 * and replaced with a stub email provider (ChampMail integration planned
 * post-v1). Status updates now arrive via provider-specific webhooks once a
 * real provider is configured.
 *
 * This endpoint is retained as a no-op so existing cron/QStash schedules do
 * not error out. It will be wired to the active provider's tracking API when
 * ChampMail (or another provider) is integrated.
 */
export async function POST() {
  return NextResponse.json({
    checked: 0,
    updated: 0,
    note: "Delivery tracking is pending ChampMail integration. Configure an email provider to enable.",
  });
}
