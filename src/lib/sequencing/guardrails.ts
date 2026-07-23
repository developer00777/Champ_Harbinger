import "server-only";
import { and, desc, eq, gte, lt } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { getEmailInfraProvider } from "@/lib/email-infra";

/**
 * Hard-coded deliverability guardrails for outbound sending. These are NOT
 * suggestions — `send_message` (src/lib/tools/sequencer-tools.ts) calls
 * `runSendGuardrails` unconditionally before touching a mailbox connector,
 * and every check here throws `GuardrailViolationError` on failure rather
 * than returning a boolean a caller could choose to ignore. There is no
 * parameter anywhere in this module that lets a caller silently bypass a
 * check — that is intentional, not an oversight.
 */

// ── 1) Per-mailbox daily send cap ──────────────────────────────────────────
//
// A brand-new domain/mailbox has zero sending reputation. ESPs and spam
// filters watch the ramp curve of a new sender closely; blasting volume from
// day one is the single fastest way to get a fresh domain blacklisted before
// it ever gets a chance to build reputation. 30-40/day is a commonly cited
// safe starting ceiling for a freshly warmed mailbox — this default is
// PROVISIONAL and meant to be tuned per mailbox age/warmup stage by the
// caller (via the `cap` option), not hard-baked forever.
export const DEFAULT_DAILY_SEND_CAP = 35;

// ── 2) Randomized throttle ──────────────────────────────────────────────────
//
// A FIXED interval between sends (e.g. exactly every 60.000s) is itself a
// bot signature: spam filters and mailbox-provider reputation systems
// fingerprint regular cadences as automation, because no human sends emails
// on a metronome. We instead enforce a floor plus a random jitter window, so
// the gap between any two sends from the same mailbox varies send to send.
export const MIN_THROTTLE_MS = 45_000; // 45s floor
export const THROTTLE_JITTER_MS = 90_000; // + up to 90s random jitter

export type GuardrailCode = "daily_cap" | "throttle" | "domain_unhealthy";

export class GuardrailViolationError extends Error {
  readonly code: GuardrailCode;
  constructor(code: GuardrailCode, message: string) {
    super(message);
    this.name = "GuardrailViolationError";
    this.code = code;
  }
}

export interface MailboxForGuardrails {
  id: string;
  clerkUserId: string;
  fromAddress: string;
  config?: Record<string, unknown> | null;
}

function utcDayRange(now: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// ── Daily cap ────────────────────────────────────────────────────────────

/** Count sends already made from this mailbox today (UTC calendar day). */
export async function countSentToday(
  mailbox: MailboxForGuardrails,
  now: Date = new Date(),
): Promise<number> {
  const { start, end } = utcDayRange(now);
  const rows = await adminDb
    .select({ id: schema.sentEmails.id })
    .from(schema.sentEmails)
    .where(
      and(
        eq(schema.sentEmails.fromEmail, mailbox.fromAddress),
        eq(schema.sentEmails.clerkUserId, mailbox.clerkUserId),
        gte(schema.sentEmails.sentAt, start),
        lt(schema.sentEmails.sentAt, end),
      ),
    );
  return rows.length;
}

export interface DailyCapOptions {
  cap?: number;
  now?: Date;
  /** Injectable for tests — defaults to the real DB-backed count. */
  countFn?: (mailbox: MailboxForGuardrails, now: Date) => Promise<number>;
}

export interface DailyCapResult {
  sentToday: number;
  cap: number;
}

/**
 * Throws `GuardrailViolationError("daily_cap")` once the mailbox has hit its
 * daily send cap. No override parameter exists that bypasses this silently —
 * a caller can only raise the cap explicitly via `opts.cap`, which is a
 * deliberate, visible configuration choice, not a skip flag.
 */
export async function assertDailyCapNotExceeded(
  mailbox: MailboxForGuardrails,
  opts: DailyCapOptions = {},
): Promise<DailyCapResult> {
  const cap = opts.cap ?? DEFAULT_DAILY_SEND_CAP;
  const now = opts.now ?? new Date();
  const countFn = opts.countFn ?? countSentToday;
  const sentToday = await countFn(mailbox, now);
  if (sentToday >= cap) {
    throw new GuardrailViolationError(
      "daily_cap",
      `Daily send cap reached for ${mailbox.fromAddress}: ${sentToday}/${cap} sent today (UTC). Refusing to send further until tomorrow (UTC).`,
    );
  }
  return { sentToday, cap };
}

// ── Randomized throttle ─────────────────────────────────────────────────────

/** Timestamp of the most recent send from this mailbox, or null if it has never sent. */
export async function getLastSentAt(
  mailbox: MailboxForGuardrails,
): Promise<Date | null> {
  const [row] = await adminDb
    .select({ sentAt: schema.sentEmails.sentAt })
    .from(schema.sentEmails)
    .where(
      and(
        eq(schema.sentEmails.fromEmail, mailbox.fromAddress),
        eq(schema.sentEmails.clerkUserId, mailbox.clerkUserId),
      ),
    )
    .orderBy(desc(schema.sentEmails.sentAt))
    .limit(1);
  return row?.sentAt ?? null;
}

/**
 * Random minimum gap for this send: MIN_THROTTLE_MS plus a jitter draw in
 * [0, THROTTLE_JITTER_MS). Deliberately jittered, not a fixed interval — see
 * module doc comment above.
 */
export function randomizedMinGapMs(rand: () => number = Math.random): number {
  return MIN_THROTTLE_MS + Math.floor(rand() * THROTTLE_JITTER_MS);
}

export interface ThrottleOptions {
  now?: Date;
  /** Injectable for tests — defaults to the real DB-backed lookup. */
  lastSentFn?: (mailbox: MailboxForGuardrails) => Promise<Date | null>;
  /** Injectable RNG for deterministic tests. */
  rand?: () => number;
}

export interface ThrottleResult {
  elapsedMs: number | null;
  requiredGapMs: number;
}

/**
 * Throws `GuardrailViolationError("throttle")` if less than the randomized
 * minimum gap has elapsed since this mailbox's last send.
 */
export async function assertThrottleOk(
  mailbox: MailboxForGuardrails,
  opts: ThrottleOptions = {},
): Promise<ThrottleResult> {
  const now = opts.now ?? new Date();
  const lastSentFn = opts.lastSentFn ?? getLastSentAt;
  const last = await lastSentFn(mailbox);
  const requiredGapMs = randomizedMinGapMs(opts.rand);
  if (!last) {
    return { elapsedMs: null, requiredGapMs };
  }
  const elapsedMs = now.getTime() - last.getTime();
  if (elapsedMs < requiredGapMs) {
    throw new GuardrailViolationError(
      "throttle",
      `Throttled: only ${elapsedMs}ms since the last send from ${mailbox.fromAddress}; this cycle's randomized minimum gap is ${requiredGapMs}ms. Wait before sending again.`,
    );
  }
  return { elapsedMs, requiredGapMs };
}

// ── SPF/DKIM/DMARC domain-health guard ──────────────────────────────────────

interface CachedOrderHealth {
  healthy: boolean;
  status?: string;
}

/**
 * Look up the cached deliverability status for an InboxKit-provisioned
 * domain from `infra_orders.last_event` (populated by the InboxKit webhook).
 * Returns null when there is no cached order for the domain (caller should
 * fall back to a live provider check).
 */
async function defaultGetCachedDomainHealth(
  domain: string,
): Promise<CachedOrderHealth | null> {
  const rows = await adminDb
    .select({
      request: schema.infraOrders.request,
      lastEvent: schema.infraOrders.lastEvent,
    })
    .from(schema.infraOrders)
    .where(eq(schema.infraOrders.provider, "inboxkit"));

  const match = rows.find((r) => {
    const req = r.request as Record<string, unknown> | null;
    const evt = r.lastEvent as Record<string, unknown> | null;
    return req?.domain === domain || evt?.domain === domain;
  });
  if (!match?.lastEvent) return null;

  const evt = match.lastEvent as Record<string, unknown>;
  const status = typeof evt.status === "string" ? evt.status : undefined;
  const spf = Boolean(evt.spfVerified ?? evt.spf_verified);
  const dkim = Boolean(evt.dkimVerified ?? evt.dkim_verified);
  const dmarc = Boolean(evt.dmarcVerified ?? evt.dmarc_verified);
  return {
    healthy: status === "active" && spf && dkim && dmarc,
    status,
  };
}

async function defaultLiveDomainHealth(
  domain: string,
): Promise<CachedOrderHealth | null> {
  try {
    const provider = getEmailInfraProvider();
    if (!provider.enabled) return null;
    const status = await provider.getDomainStatus(domain);
    return { healthy: status.healthy, status: status.status };
  } catch {
    return null;
  }
}

export interface DomainHealthOptions {
  /** Injectable for tests. */
  getCachedFn?: (domain: string) => Promise<CachedOrderHealth | null>;
  /** Injectable for tests. */
  getLiveFn?: (domain: string) => Promise<CachedOrderHealth | null>;
}

export interface DomainHealthResult {
  healthy: boolean;
  source: "not_applicable" | "cache" | "live";
}

/**
 * Throws `GuardrailViolationError("domain_unhealthy")` if the mailbox is
 * tied to an InboxKit-provisioned domain that is not verified/healthy
 * (SPF+DKIM+DMARC all pass and the domain is active). Fails CLOSED: any
 * ambiguity — no cached order, a live-check error, provider not
 * configured — is treated as unhealthy, never as a pass. This check applies
 * only to InboxKit-provisioned mailboxes (config.infraProvider ===
 * "inboxkit"); mailboxes a user connected themselves (their own domain) are
 * not gated here.
 *
 * There is deliberately NO option to skip this check. Any caller-supplied
 * "skip" flag on send_message's input schema is ignored by this function —
 * enforcement lives here, not in caller discipline.
 */
export async function assertDomainHealthy(
  mailbox: MailboxForGuardrails,
  opts: DomainHealthOptions = {},
): Promise<DomainHealthResult> {
  const config = mailbox.config ?? {};
  const infraProvider = config.infraProvider as string | undefined;
  const infraDomain = config.infraDomain as string | undefined;

  if (infraProvider !== "inboxkit" || !infraDomain) {
    return { healthy: true, source: "not_applicable" };
  }

  const getCachedFn = opts.getCachedFn ?? defaultGetCachedDomainHealth;
  const cached = await getCachedFn(infraDomain);
  if (cached?.healthy) {
    return { healthy: true, source: "cache" };
  }

  const getLiveFn = opts.getLiveFn ?? defaultLiveDomainHealth;
  const live = await getLiveFn(infraDomain);
  if (live?.healthy) {
    return { healthy: true, source: "live" };
  }

  throw new GuardrailViolationError(
    "domain_unhealthy",
    `Domain ${infraDomain} is not verified/healthy (SPF/DKIM/DMARC via InboxKit) — refusing to send from ${mailbox.fromAddress}. Fail-closed: this cannot be overridden.`,
  );
}

// ── Composite entry point used by send_message ──────────────────────────────

export interface SendGuardrailOptions {
  cap?: number;
  now?: Date;
  countFn?: DailyCapOptions["countFn"];
  lastSentFn?: ThrottleOptions["lastSentFn"];
  rand?: ThrottleOptions["rand"];
  getCachedDomainHealthFn?: DomainHealthOptions["getCachedFn"];
  getLiveDomainHealthFn?: DomainHealthOptions["getLiveFn"];
}

export interface SendGuardrailReport {
  dailyCap: DailyCapResult;
  throttle: ThrottleResult;
  domainHealth: DomainHealthResult;
}

/**
 * Runs all three guardrails in order (daily cap → throttle → domain health)
 * and throws on the first violation. `send_message` calls this before doing
 * anything else — no send path in this codebase should bypass it.
 */
export async function runSendGuardrails(
  mailbox: MailboxForGuardrails,
  opts: SendGuardrailOptions = {},
): Promise<SendGuardrailReport> {
  const dailyCap = await assertDailyCapNotExceeded(mailbox, {
    cap: opts.cap,
    now: opts.now,
    countFn: opts.countFn,
  });
  const throttle = await assertThrottleOk(mailbox, {
    now: opts.now,
    lastSentFn: opts.lastSentFn,
    rand: opts.rand,
  });
  const domainHealth = await assertDomainHealthy(mailbox, {
    getCachedFn: opts.getCachedDomainHealthFn,
    getLiveFn: opts.getLiveDomainHealthFn,
  });
  return { dailyCap, throttle, domainHealth };
}
