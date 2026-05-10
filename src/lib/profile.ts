import { eq } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";
import type { UserProfile } from "@/lib/types/profile";

/**
 * Load the profile for the system prompt.
 * If a campaignId is provided and the campaign has a linked profile, use that.
 * Otherwise fall back to the most recently created profile.
 */
export async function getProfileForPrompt(
  campaignId?: string | null,
): Promise<UserProfile | null> {
  const sdb = await getScopedDb();

  // If campaign has a linked profile, use it
  if (campaignId) {
    const [campaign] = await sdb.raw
      .select({ profileId: schema.campaigns.profileId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (campaign?.profileId) {
      const [profile] = await sdb.raw
        .select()
        .from(schema.userProfile)
        .where(eq(schema.userProfile.id, campaign.profileId))
        .limit(1);

      if (profile) return profile as unknown as UserProfile;
    }
  }

  // Fallback: most recent profile owned by this user
  const [data] = await sdb.raw
    .select()
    .from(schema.userProfile)
    .where(sdb.scope(schema.userProfile))
    .orderBy(schema.userProfile.createdAt)
    .limit(1);

  if (!data) return null;
  return data as unknown as UserProfile;
}
