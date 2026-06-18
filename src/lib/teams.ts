import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";

export type TeamMember = typeof schema.teamMembers.$inferSelect;
export type Team = typeof schema.teams.$inferSelect;

export interface MemberContext {
  membership: TeamMember | null;
  team: Team | null;
}

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The team + membership for a signed-in user (null if not assigned to a team). */
export async function getMemberContext(
  clerkUserId: string,
): Promise<MemberContext> {
  const [membership] = await adminDb
    .select()
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, clerkUserId))
    .limit(1);
  if (!membership) return { membership: null, team: null };
  const [team] = await adminDb
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, membership.teamId))
    .limit(1);
  return { membership, team: team ?? null };
}

/**
 * Effective weekly per-user limit in USD: the member override, else the team
 * default, else null (no per-user cap — only the team/global caps apply).
 */
export function effectiveUserWeeklyLimitUsd(ctx: MemberContext): number | null {
  const override = ctx.membership?.perUserWeeklyLimitUsd;
  if (override != null) return Number(override);
  const teamDefault = ctx.team?.perUserDefaultWeeklyLimitUsd;
  if (teamDefault != null) return Number(teamDefault);
  return null;
}

/**
 * First-login provisioning: link a freshly signed-in user's clerkUserId to the
 * pending invite row matched by email (status invited -> active). Idempotent and
 * safe to call on every authed request — it no-ops once the user is linked.
 */
export async function ensureProvisioned(
  clerkUserId: string,
  email: string | null | undefined,
): Promise<void> {
  const [existing] = await adminDb
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, clerkUserId))
    .limit(1);
  if (existing) return; // already linked
  if (!email) return;
  await adminDb
    .update(schema.teamMembers)
    .set({ clerkUserId, status: "active", updatedAt: new Date() })
    .where(
      and(
        eq(schema.teamMembers.email, normEmail(email)),
        isNull(schema.teamMembers.clerkUserId),
      ),
    );
}
