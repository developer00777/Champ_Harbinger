import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

// Connection pool. In serverless, prefer per-invocation but still pooled at
// the platform level. `prepare: false` is safer with pgBouncer-style pools.
const queryClient = postgres(connectionString, {
  max: process.env.NODE_ENV === 'production' ? 10 : 5,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });
export { schema };
export type Db = typeof db;
