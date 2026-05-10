import { db } from '@/db';

/**
 * Unscoped DB instance for system tasks: migrations, cron jobs, webhooks
 * where there is no Clerk session.
 *
 * NEVER import this from a route handler that responds to user requests.
 * Use getScopedDb() from @/lib/db/scoped instead.
 */
export const adminDb = db;
