import { and, eq, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getCurrentUser } from '@/lib/auth';

/**
 * Returns a Drizzle DB whose read/write helpers are auto-scoped to the
 * current Clerk userId (and orgId, when present).
 *
 * Usage:
 *   const sdb = await getScopedDb();
 *   const myCampaigns = await sdb.raw
 *     .select()
 *     .from(schema.campaigns)
 *     .where(sdb.scope(schema.campaigns));
 *
 * For inserts, set clerk fields explicitly:
 *   await sdb.raw.insert(schema.campaigns).values({
 *     ...input,
 *     clerkUserId: sdb.userId,
 *     clerkOrgId: sdb.orgId,
 *   });
 */
export async function getScopedDb() {
  const { userId, orgId } = await getCurrentUser();

  return {
    /** Escape hatch to the raw Drizzle instance — caller owns scoping. */
    raw: db,
    userId,
    orgId,

    /**
     * Returns a `where` clause that scopes by org when the table has a
     * clerkOrgId column and orgId is set, otherwise by userId.
     */
    scope(table: { clerkUserId?: SQL | unknown; clerkOrgId?: SQL | unknown }): SQL | undefined {
      if (orgId && 'clerkOrgId' in table && table.clerkOrgId !== undefined) {
        return eq(table.clerkOrgId as Parameters<typeof eq>[0], orgId);
      }
      if ('clerkUserId' in table && table.clerkUserId !== undefined) {
        return eq(table.clerkUserId as Parameters<typeof eq>[0], userId);
      }
      return undefined;
    },

    /**
     * Combines an external `where` predicate with the tenant scope.
     */
    scoped(table: { clerkUserId?: SQL | unknown; clerkOrgId?: SQL | unknown }, where?: SQL): SQL | undefined {
      const s = this.scope(table);
      if (!where) return s;
      if (!s) return where;
      return and(s, where);
    },
  };
}

export type ScopedDb = Awaited<ReturnType<typeof getScopedDb>>;

// Re-export schema for convenience so callers don't need two imports.
export { schema };
