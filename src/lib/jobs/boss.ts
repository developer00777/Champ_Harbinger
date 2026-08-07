import { PgBoss } from "pg-boss";

/**
 * Postgres-backed job queue (pg-boss). Replaces Upstash QStash — scheduling and
 * background jobs run on the existing DATABASE_URL with no extra infra. pg-boss
 * manages its own `pgboss` schema (self-migrating on start), separate from the
 * Drizzle/postgres-js pool.
 *
 * Producers (route handlers, tools) call getBoss()/enqueue*; the standalone
 * worker process (scripts/run-worker.ts → startWorkers) runs the schedules and
 * job handlers.
 */

export const TRACKING_DISPATCH = "tracking-dispatch";
export const TRACKING_RUN = "tracking-run";
export const OUTREACH_FOLLOWUPS = "outreach-followups";
export const ENRICH_COMPANY = "enrich-company";
export const MAILBOX_SYNC = "mailbox-sync";
export const AISDR_PROCESS = "aisdr-process";
export const SIGNAL_RESEARCH = "signal-research";
export const USAGE_ALERTS = "usage-alerts";
export const QUICK_START_DISCOVER = "quick-start-discover";

declare global {
  var __harbinger_boss: PgBoss | undefined;
  var __harbinger_boss_start: Promise<PgBoss> | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the job queue");
  return url;
}

/** Lazily start a single pg-boss instance (idempotent across hot reloads/imports). */
export async function getBoss(): Promise<PgBoss> {
  if (global.__harbinger_boss) return global.__harbinger_boss;
  if (!global.__harbinger_boss_start) {
    const boss = new PgBoss({
      connectionString: connectionString(),
      schema: "pgboss",
    });
    boss.on("error", (err: unknown) => console.error("[pg-boss] error:", err));
    global.__harbinger_boss_start = boss.start().then(async () => {
      for (const queue of [
        TRACKING_DISPATCH,
        TRACKING_RUN,
        OUTREACH_FOLLOWUPS,
        ENRICH_COMPANY,
        MAILBOX_SYNC,
        AISDR_PROCESS,
        SIGNAL_RESEARCH,
        USAGE_ALERTS,
      ]) {
        try {
          await boss.createQueue(queue);
        } catch {
          // queue already exists — createQueue is not always idempotent
        }
      }
      global.__harbinger_boss = boss;
      return boss;
    });
  }
  return global.__harbinger_boss_start;
}

/**
 * Enqueue a tracking run. Used by the dispatcher and by createTracking's
 * immediate baseline. Retries twice with backoff (parity with the old QStash
 * `retries: 2`).
 */
export async function enqueueTrackingRun(
  trackingConfigId: string,
  clerkUserId?: string,
): Promise<void> {
  const boss = await getBoss();
  await boss.send(
    TRACKING_RUN,
    { trackingConfigId, clerkUserId },
    // expireInSeconds is generous: the fair dispatcher may hold a fetched job
    // in its in-memory backlog (round-robin/per-user cap) before it runs.
    { retryLimit: 2, retryBackoff: true, expireInSeconds: 3600 },
  );
}

export interface EnrichCompanyJob {
  companyId: string;
  campaignId: string;
  userId: string;
}

/** Enqueue a single company enrichment (used by the bulk "Enrich All" action). */
export async function enqueueEnrichCompany(
  job: EnrichCompanyJob,
): Promise<void> {
  const boss = await getBoss();
  await boss.send(ENRICH_COMPANY, job, {
    retryLimit: 1,
    // de-dupe in-flight jobs for the same company so double-clicks don't pile up
    singletonKey: `${job.campaignId}:${job.companyId}`,
    // Generous expiry: the fair dispatcher may hold this in its in-memory
    // backlog (round-robin / per-user cap) before it actually runs.
    expireInSeconds: 3600,
  });
}

export interface QuickStartDiscoverJob {
  criteria: string;
  userId: string;
  campaignId: string | null;
  limit: number;
}

/**
 * Enqueue a Quick-Start discovery run and return the pg-boss job id so the UI
 * can poll GET /api/quick-start/discover/status?jobId=...
 *
 * Discovery is a multi-minute fan-out (search -> fetch dozens of homepages ->
 * LLM normalise -> ICP verify). Run inline in the API process it starved the
 * whole backend: one request made every other route 504 until it finished.
 * It belongs on the worker.
 *
 * `retryLimit: 0` on purpose — a retry would redo the entire crawl and burn
 * the user's OpenRouter budget twice. Failures surface to the UI instead.
 */
export async function enqueueQuickStartDiscover(
  job: QuickStartDiscoverJob,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUICK_START_DISCOVER, job, {
    retryLimit: 0,
    // De-dupe: a double-click must not launch two crawls for the same campaign.
    singletonKey: `${job.userId}:${job.campaignId ?? "no-campaign"}`,
    expireInSeconds: 1800,
  });
}
