import { resolveMx } from "node:dns/promises";
import { eq, and, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

/**
 * Minimal DB interface accepted by this module.
 * Compatible with both the real Drizzle `db` and test fakes.
 */
export type EmailPatternDb = Pick<Db, "select" | "update">;

// ─── Types ────────────────────────────────────────────────────────────────

export type EmailSource =
  | "user_entered"
  | "send_confirmed"
  | "team_page"
  | "exa_search"
  | "pattern_derived";

export interface VerifiedEmail {
  email: string;
  firstName: string;
  lastName: string;
  source: EmailSource;
}

// ─── Constants ────────────────────────────────────────────────────────────

export const SOURCE_WEIGHT: Record<EmailSource, number> = {
  user_entered: 1.0,
  send_confirmed: 0.95,
  team_page: 0.7,
  exa_search: 0,
  pattern_derived: 0,
};

export const KNOWN_PATTERNS = [
  "{first}.{last}",
  "{first}{last}",
  "{f}{last}",
  "{first}_{last}",
  "{first}-{last}",
  "{f}.{last}",
  "{first}.{l}",
  "{first}",
  "{last}",
] as const;

export type EmailPattern = (typeof KNOWN_PATTERNS)[number];

export const ROLE_PREFIXES = [
  "it",
  "info",
  "support",
  "hello",
  "contact",
  "admin",
  "team",
  "sales",
  "marketing",
  "hr",
  "legal",
  "office",
  "mail",
  "webmaster",
  "postmaster",
  "abuse",
  "billing",
  "accounts",
  "noreply",
  "no-reply",
  "donotreply",
  "press",
  "media",
  "careers",
  "jobs",
  "founders",
  "general",
  "inquiries",
  "feedback",
  "help",
  "service",
] as const;

const ROLE_SET: ReadonlySet<string> = new Set(ROLE_PREFIXES);

// ─── Pure helpers ─────────────────────────────────────────────────────────

function localPart(email: string): string {
  return email.split("@")[0]?.toLowerCase() ?? "";
}

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Split a person's name into first + last. Returns null parts if unknown. */
export function splitName(name: string): {
  first: string | null;
  last: string | null;
} {
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * `it`, `it.dept`, `support_team`, etc. → true. Personal addresses → false.
 * Role prefix may be followed by `.`, `-`, `_`, `+`, or end of local-part.
 */
export function isRolePrefix(local: string): boolean {
  const lower = local.toLowerCase();
  if (ROLE_SET.has(lower)) return true;
  for (const prefix of ROLE_PREFIXES) {
    if (
      lower.startsWith(prefix + ".") ||
      lower.startsWith(prefix + "-") ||
      lower.startsWith(prefix + "_") ||
      lower.startsWith(prefix + "+")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Does the email's local-part plausibly belong to this person? Used to reject
 * generic addresses being attached to specific contacts (e.g., `it@acme.com`
 * latching onto "Jane Doe").
 *
 * Accepts if the normalized local-part contains the first name, last name, or
 * any common combination of initials and names (≥2 chars per token).
 */
export function emailMatchesName(
  email: string,
  firstName: string | null,
  lastName: string | null,
): boolean {
  const local = alnum(localPart(email));
  if (!local) return false;

  const first = firstName ? alnum(firstName) : "";
  const last = lastName ? alnum(lastName) : "";
  const fInit = first.slice(0, 1);
  const lInit = last.slice(0, 1);

  const candidates: string[] = [];
  if (first.length >= 2) candidates.push(first);
  if (last.length >= 2) candidates.push(last);
  if (first && last) {
    candidates.push(first + last); // janedoe
    candidates.push(last + first); // doejane
  }
  if (fInit && last.length >= 2) candidates.push(fInit + last); // jdoe
  if (first.length >= 2 && lInit) candidates.push(first + lInit); // janed
  if (lInit && first.length >= 2) candidates.push(lInit + first); // djane

  return candidates.some((c) => c.length >= 2 && local.includes(c));
}

/** Build the local-part for a given pattern. Returns null if unfillable. */
function renderPattern(
  pattern: string,
  first: string | null,
  last: string | null,
): string | null {
  const f = first ? alnum(first) : "";
  const l = last ? alnum(last) : "";
  const needsFirst = pattern.includes("{first}") || pattern.includes("{f}");
  const needsLast = pattern.includes("{last}") || pattern.includes("{l}");
  if (needsFirst && !f) return null;
  if (needsLast && !l) return null;
  return pattern
    .replace("{first}", f)
    .replace("{last}", l)
    .replace("{f}", f.slice(0, 1))
    .replace("{l}", l.slice(0, 1));
}

/** Build the full email for a pattern + person + domain. */
export function applyPattern(
  pattern: string,
  firstName: string | null,
  lastName: string | null,
  domain: string,
): string | null {
  const local = renderPattern(pattern, firstName, lastName);
  if (!local) return null;
  return `${local}@${domain.toLowerCase()}`;
}

/**
 * Given a set of verified emails (with names), return the most likely email
 * pattern + a confidence in [0, 1] + how many emails support it. Ignores
 * role-prefix addresses.
 */
export function inferPattern(emails: VerifiedEmail[]): {
  pattern: EmailPattern | null;
  confidence: number;
  evidenceCount: number;
} {
  // Filter out role addresses; they don't reveal a personal pattern.
  const personal = emails.filter((e) => !isRolePrefix(localPart(e.email)));
  if (personal.length === 0) {
    return { pattern: null, confidence: 0, evidenceCount: 0 };
  }

  // Score each candidate pattern by summing source-weighted votes from
  // emails whose actual local-part equals what the pattern would produce.
  let bestPattern: EmailPattern | null = null;
  let bestScore = 0;
  let bestEvidence = 0;
  let totalScore = 0;

  for (const pattern of KNOWN_PATTERNS) {
    let score = 0;
    let count = 0;
    for (const email of personal) {
      const expectedLocal = renderPattern(
        pattern,
        email.firstName,
        email.lastName,
      );
      if (!expectedLocal) continue;
      const actualLocal = localPart(email.email);
      if (expectedLocal === actualLocal) {
        score += SOURCE_WEIGHT[email.source];
        count++;
      }
    }
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestPattern = pattern;
      bestEvidence = count;
    }
  }

  if (!bestPattern || bestScore === 0) {
    return { pattern: null, confidence: 0, evidenceCount: 0 };
  }

  // Confidence = winner share of all matched-pattern weight. Bounded to 1.
  const confidence = totalScore > 0 ? Math.min(1, bestScore / totalScore) : 0;
  return { pattern: bestPattern, confidence, evidenceCount: bestEvidence };
}

// ─── Network ──────────────────────────────────────────────────────────────

type MxResolver = (
  domain: string,
) => Promise<Array<{ exchange: string; priority: number }>>;

/**
 * True if the domain has at least one MX record. Free DNS-only check.
 * `resolver` is injectable so tests can substitute it without module mocking.
 */
export async function mxCheck(
  domain: string,
  resolver: MxResolver = resolveMx,
): Promise<boolean> {
  try {
    // Cap the DNS lookup so a slow/blocked resolver can't stall email-finding
    // (it was hanging ~25s on the OS timeout). Treat a timeout as "no MX".
    const records = await Promise.race([
      resolver(domain),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("mx_timeout")), 4000),
      ),
    ]);
    return records.length > 0;
  } catch {
    return false;
  }
}

// ─── DB-side types ────────────────────────────────────────────────────────────

/**
 * Minimal person row shape expected by the email-pattern DB functions.
 */
export interface PersonRow {
  id: string;
  name: string;
  organization_id: string | null;
  work_email: string | null;
  work_email_source: EmailSource | null;
  work_email_confidence: number | null;
  work_email_verified_at: string | null;
}

/**
 * Minimal org row shape expected by the email-pattern DB functions.
 */
export interface OrgRow {
  id: string;
  email_pattern: string | null;
  email_pattern_confidence: number | null;
  email_pattern_evidence_count: number;
  email_pattern_bounce_count: number;
  email_pattern_updated_at: string | null;
}

/**
 * Minimal DB adapter interface. Compatible with the real Drizzle db when
 * wrapped by `makeEmailPatternDb()`, and also with test fakes.
 */
export interface EmailPatternDbAdapter {
  getPeopleForOrg(orgId: string): Promise<PersonRow[]>;
  getPerson(personId: string): Promise<PersonRow | null>;
  updatePerson(personId: string, updates: Partial<PersonRow>): Promise<void>;
  getOrg(orgId: string): Promise<OrgRow | null>;
  updateOrg(orgId: string, updates: Partial<OrgRow>): Promise<void>;
}

/**
 * Wrap the real Drizzle db into the EmailPatternDbAdapter interface.
 * Import this in production call sites.
 */
export function makeEmailPatternDb(db: EmailPatternDb): EmailPatternDbAdapter {
  return {
    async getPeopleForOrg(orgId) {
      const rows = await db
        .select({
          id: schema.people.id,
          name: schema.people.name,
          organization_id: schema.people.organizationId,
          work_email: schema.people.workEmail,
          work_email_source: schema.people.workEmailSource,
          work_email_confidence: schema.people.workEmailConfidence,
          work_email_verified_at: schema.people.workEmailVerifiedAt,
        })
        .from(schema.people)
        .where(
          and(
            eq(schema.people.organizationId, orgId),
            isNotNull(schema.people.workEmail),
            isNotNull(schema.people.workEmailVerifiedAt),
          ),
        );
      return rows.map((r) => ({
        ...r,
        work_email_verified_at: r.work_email_verified_at
          ? r.work_email_verified_at.toISOString()
          : null,
        email_pattern_updated_at: null,
      })) as PersonRow[];
    },

    async getPerson(personId) {
      const [row] = await db
        .select({
          id: schema.people.id,
          name: schema.people.name,
          organization_id: schema.people.organizationId,
          work_email: schema.people.workEmail,
          work_email_source: schema.people.workEmailSource,
          work_email_confidence: schema.people.workEmailConfidence,
          work_email_verified_at: schema.people.workEmailVerifiedAt,
        })
        .from(schema.people)
        .where(eq(schema.people.id, personId))
        .limit(1);
      if (!row) return null;
      return {
        ...row,
        work_email_verified_at: row.work_email_verified_at
          ? row.work_email_verified_at.toISOString()
          : null,
      } as PersonRow;
    },

    async updatePerson(personId, updates) {
      const set: Record<string, unknown> = {};
      if ("work_email" in updates) set.workEmail = updates.work_email;
      if ("work_email_source" in updates)
        set.workEmailSource = updates.work_email_source;
      if ("work_email_confidence" in updates)
        set.workEmailConfidence = updates.work_email_confidence;
      if ("work_email_verified_at" in updates) {
        set.workEmailVerifiedAt = updates.work_email_verified_at
          ? new Date(updates.work_email_verified_at!)
          : null;
      }
      if (Object.keys(set).length > 0) {
        await db
          .update(schema.people)
          .set(set)
          .where(eq(schema.people.id, personId));
      }
    },

    async getOrg(orgId) {
      const [row] = await db
        .select({
          id: schema.organizations.id,
          email_pattern: schema.organizations.emailPattern,
          email_pattern_confidence: schema.organizations.emailPatternConfidence,
          email_pattern_evidence_count:
            schema.organizations.emailPatternEvidenceCount,
          email_pattern_bounce_count:
            schema.organizations.emailPatternBounceCount,
          email_pattern_updated_at: schema.organizations.emailPatternUpdatedAt,
        })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId))
        .limit(1);
      if (!row) return null;
      return {
        ...row,
        email_pattern_updated_at: row.email_pattern_updated_at
          ? row.email_pattern_updated_at.toISOString()
          : null,
      } as OrgRow;
    },

    async updateOrg(orgId, updates) {
      const set: Record<string, unknown> = {};
      if ("email_pattern" in updates) set.emailPattern = updates.email_pattern;
      if ("email_pattern_confidence" in updates)
        set.emailPatternConfidence = updates.email_pattern_confidence;
      if ("email_pattern_evidence_count" in updates)
        set.emailPatternEvidenceCount = updates.email_pattern_evidence_count;
      if ("email_pattern_bounce_count" in updates)
        set.emailPatternBounceCount = updates.email_pattern_bounce_count;
      if ("email_pattern_updated_at" in updates) {
        set.emailPatternUpdatedAt = updates.email_pattern_updated_at
          ? new Date(updates.email_pattern_updated_at!)
          : null;
      }
      if (Object.keys(set).length > 0) {
        await db
          .update(schema.organizations)
          .set(set)
          .where(eq(schema.organizations.id, orgId));
      }
    },
  };
}

// ─── DB-side: pattern recompute + email recording ─────────────────────────

/**
 * Re-derive `organizations.email_pattern` from all verified, non-derived
 * emails on people in the org. Cheap; called whenever a verified email is
 * recorded.
 */
export async function recomputeOrgPattern(
  db: EmailPatternDbAdapter,
  orgId: string,
): Promise<void> {
  const people = await db.getPeopleForOrg(orgId);

  const candidates: VerifiedEmail[] = [];
  for (const p of people) {
    if (!p.work_email || !p.work_email_source) continue;
    if (p.work_email_source === "pattern_derived") continue;
    const { first, last } = splitName(p.name);
    if (!first || !last) continue;
    candidates.push({
      email: p.work_email,
      firstName: first,
      lastName: last,
      source: p.work_email_source,
    });
  }

  const { pattern, confidence, evidenceCount } = inferPattern(candidates);

  await db.updateOrg(orgId, {
    email_pattern: pattern,
    email_pattern_confidence: confidence,
    email_pattern_evidence_count: evidenceCount,
    email_pattern_updated_at: new Date().toISOString(),
  });
}

/**
 * Record that a person's work_email comes from a verified source.
 * Sets work_email + source + confidence + verified_at, then recomputes the
 * org's pattern. NOT for `pattern_derived` — those are written directly by
 * `findEmailForPerson` since their confidence depends on the org's pattern.
 *
 * Skips role-prefix addresses (don't pollute the org's pattern with a role
 * mailbox attached to a real person). Skips overwrites that would *downgrade*
 * the source weight — once `send_confirmed` is set, a later `team_page` rescrape
 * shouldn't replace it.
 */
export async function recordVerifiedEmail(
  db: EmailPatternDbAdapter,
  args: {
    personId: string;
    email: string;
    source: Exclude<EmailSource, "pattern_derived">;
  },
): Promise<void> {
  const { personId, email, source } = args;
  const local = localPart(email);
  if (isRolePrefix(local)) {
    console.warn(
      `[recordVerifiedEmail] skipping role-prefix address for person ${personId}: ${email}`,
    );
    return;
  }

  const person = await db.getPerson(personId);
  if (!person) return;

  const newEmail = email.toLowerCase();
  const sameEmail = person.work_email?.toLowerCase() === newEmail;
  const existingSource = person.work_email_source as EmailSource | null;
  const existingWeight = existingSource ? SOURCE_WEIGHT[existingSource] : -1;
  const incomingWeight = SOURCE_WEIGHT[source];

  // Two protections:
  //   1. Different email + weaker source → skip (don't replace a strong signal).
  //   2. Same email + weaker source → still refresh verified_at, but keep the
  //      stronger source (don't downgrade send_confirmed → team_page).
  let finalSource: EmailSource = source;
  if (sameEmail) {
    if (existingSource && existingWeight > incomingWeight) {
      finalSource = existingSource;
    }
  } else if (incomingWeight < existingWeight) {
    return;
  }

  await db.updatePerson(personId, {
    work_email: newEmail,
    work_email_source: finalSource,
    work_email_confidence: SOURCE_WEIGHT[finalSource],
    work_email_verified_at: new Date().toISOString(),
  });

  if (person.organization_id) {
    await recomputeOrgPattern(db, person.organization_id);
  }
}

/**
 * Record a bounce against a person's email. Clears verification and, if the
 * email was pattern-derived, lowers the org pattern's confidence (or clears
 * it entirely if bounces dominate).
 */
export async function recordBounce(
  db: EmailPatternDbAdapter,
  args: { personId: string; email: string },
): Promise<void> {
  const { personId, email } = args;

  const person = await db.getPerson(personId);
  if (!person) return;

  // Only act if the bounced email is the one we have on file.
  if (
    person.work_email &&
    person.work_email.toLowerCase() !== email.toLowerCase()
  ) {
    return;
  }

  // Clear verification + lower confidence on the person.
  await db.updatePerson(personId, {
    work_email_verified_at: null,
    work_email_confidence: 0,
  });

  // If the email was derived from the org's pattern, that's evidence the
  // pattern is wrong. Bump bounce count and reduce / clear confidence.
  if (
    person.work_email_source !== "pattern_derived" ||
    !person.organization_id
  ) {
    return;
  }

  // If a pattern exists but the cached evidence_count is stale (e.g. 0 because
  // recompute hasn't run yet), refresh it first so the bounce ratio is fair.
  // Without this, the very first bounce would compute 1/1 > 0.5 and clear a
  // perfectly-good pattern.
  let org = await db.getOrg(person.organization_id);
  if (!org) return;

  if (org.email_pattern && (org.email_pattern_evidence_count ?? 0) === 0) {
    await recomputeOrgPattern(db, person.organization_id);
    org = (await db.getOrg(person.organization_id)) ?? org;
  }

  const newBounces = (org.email_pattern_bounce_count ?? 0) + 1;
  const evidence = org.email_pattern_evidence_count ?? 0;

  let pattern = org.email_pattern;
  let confidence = org.email_pattern_confidence ?? 0;

  if (evidence === 0) {
    // No supporting evidence even after recompute. Just bump the bounce count;
    // don't touch the pattern.
  } else {
    const ratio = newBounces / evidence;
    if (ratio > 0.5) {
      pattern = null;
      confidence = 0;
    } else if (ratio > 0.3) {
      confidence = confidence / 2;
    }
  }

  await db.updateOrg(person.organization_id, {
    email_pattern: pattern,
    email_pattern_confidence: confidence,
    email_pattern_bounce_count: newBounces,
    email_pattern_updated_at: new Date().toISOString(),
  });
}

/**
 * Lookup the org's cached pattern + load its verified-email evidence count.
 * Used by findEmailForPerson to decide whether to derive vs. fall back to
 * web search.
 */
export async function getOrgPattern(
  db: EmailPatternDbAdapter,
  orgId: string,
): Promise<{
  pattern: string | null;
  confidence: number;
  evidenceCount: number;
} | null> {
  const data = await db.getOrg(orgId);
  if (!data) return null;
  return {
    pattern: data.email_pattern ?? null,
    confidence: data.email_pattern_confidence ?? 0,
    evidenceCount: data.email_pattern_evidence_count ?? 0,
  };
}

// Re-export for tests + integration callers
export { localPart, domainOf };
