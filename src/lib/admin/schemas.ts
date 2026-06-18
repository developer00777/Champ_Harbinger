import { z } from "zod";

/**
 * Numeric columns are Postgres `numeric` → Drizzle returns/accepts strings.
 * Limits are dollars with 2dp; we accept a number from the client and store
 * its `.toFixed(2)` string. `null` clears the cap (unlimited).
 */
const usdLimit = z
  .number()
  .nonnegative()
  .max(1_000_000)
  .nullable()
  .optional();

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(120),
  weeklyLimitUsd: usdLimit,
  perUserDefaultWeeklyLimitUsd: usdLimit,
  hardStop: z.boolean().optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    weeklyLimitUsd: usdLimit,
    perUserDefaultWeeklyLimitUsd: usdLimit,
    hardStop: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No fields to update",
  });
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  teamId: z.string().uuid(),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const updateMemberSchema = z
  .object({
    perUserWeeklyLimitUsd: usdLimit,
    status: z.enum(["invited", "active", "disabled"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No fields to update",
  });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** USD number → Postgres numeric string (2dp), preserving null. */
export function usdToNumeric(v: number | null | undefined): string | null {
  return v == null ? null : v.toFixed(2);
}
