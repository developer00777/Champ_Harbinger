import { eq, or, and } from "drizzle-orm";
import { db, schema } from "@/db";
import type { EmailSkill } from "@/lib/types/email-skill";

export interface LoadSkillsInput {
  userId: string;
  profileId?: string | null;
  campaignId?: string | null;
}

/**
 * Load all enabled email skills attached to the caller's user, the campaign's
 * sender profile, and the campaign itself. Returns a de-duped list (same skill
 * attached at multiple scopes only shows up once). Order: campaign → profile →
 * user, so the most specific attachment wins in the de-dupe.
 */
export async function loadActiveEmailSkills(
  _unused: unknown,
  { userId, profileId, campaignId }: LoadSkillsInput,
): Promise<EmailSkill[]>;
export async function loadActiveEmailSkills(
  { userId, profileId, campaignId }: LoadSkillsInput,
): Promise<EmailSkill[]>;
export async function loadActiveEmailSkills(
  firstArg: unknown,
  secondArg?: LoadSkillsInput,
): Promise<EmailSkill[]> {
  // Support both (db, opts) and (opts) call signatures
  const opts: LoadSkillsInput = secondArg ?? (firstArg as LoadSkillsInput);
  const { userId, profileId, campaignId } = opts;

  const conditions = [
    and(
      eq(schema.emailSkillAttachments.scopeType, "user"),
      eq(schema.emailSkillAttachments.scopeId, userId),
    ),
  ];

  if (profileId) {
    conditions.push(
      and(
        eq(schema.emailSkillAttachments.scopeType, "profile"),
        eq(schema.emailSkillAttachments.scopeId, profileId),
      ),
    );
  }

  if (campaignId) {
    conditions.push(
      and(
        eq(schema.emailSkillAttachments.scopeType, "campaign"),
        eq(schema.emailSkillAttachments.scopeId, campaignId),
      ),
    );
  }

  const rows = await db
    .select({
      scopeType: schema.emailSkillAttachments.scopeType,
      skill: schema.emailSkills,
    })
    .from(schema.emailSkillAttachments)
    .innerJoin(
      schema.emailSkills,
      eq(schema.emailSkillAttachments.skillId, schema.emailSkills.id),
    )
    .where(
      and(
        eq(schema.emailSkillAttachments.enabled, true),
        or(...conditions),
      ),
    );

  const priority: Record<string, number> = { campaign: 0, profile: 1, user: 2 };
  const sorted = rows.sort(
    (a, b) =>
      (priority[a.scopeType] ?? 99) - (priority[b.scopeType] ?? 99),
  );

  const byId = new Map<string, EmailSkill>();
  for (const row of sorted) {
    if (!byId.has(row.skill.id)) {
      byId.set(row.skill.id, row.skill as unknown as EmailSkill);
    }
  }

  return Array.from(byId.values());
}
