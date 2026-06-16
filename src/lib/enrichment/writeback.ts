import "server-only";
import { randomUUID } from "node:crypto";

import { minimalIdentifiers, type Contact, type FieldValue } from "./types";

/**
 * Close-the-loop write-back into the Harbinger-OWNED master DB.
 *
 * After a contact is enriched, MasterDBWriter upserts the verified,
 * high-confidence fields into master_contacts so the owned master builds up over
 * time and a later LakeB2B sync has something to reconcile. Every write also
 * produces a master_writeback_log row (old -> new per field + rollback token).
 *
 * Only fields that are verified AND above a confidence floor are written (email
 * must have passed the gate), so the waterfall never pollutes the master with
 * low-trust guesses. A run that detected a LakeB2B-vs-live conflict marks the
 * row sync_status='conflict' for later human/sync review.
 *
 * The DB is abstracted behind MasterStore so this is unit-testable with a fake.
 */

const WRITEBACK_CONFIDENCE_FLOOR = 0.7;
const HIGH_CONFIDENCE_UNVERIFIED_FLOOR = 0.85;

// Canonical field -> master_contacts column (camelCase Drizzle prop names).
const FIELD_TO_COLUMN: Record<string, string> = {
  email: "email",
  phone: "phone",
  title: "title",
  seniority: "seniority",
  linkedin: "linkedinUrl",
};

function emptyish(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export interface MasterStore {
  /** Find an existing master_contacts row by email -> linkedin -> name+domain. */
  findContact(keys: {
    email: string | null;
    linkedinUrl: string | null;
    fullName: string | null;
    domain: string | null;
  }): Promise<Record<string, unknown> | null>;
  /** Insert or update a master_contacts row; returns its id. */
  upsertContact(row: Record<string, unknown>): Promise<{ id: string }>;
  /** Insert a master_writeback_log audit row. */
  logWriteback(entry: {
    contactId: string;
    masterRecordId: string | null;
    fieldsWritten: Record<string, unknown>;
    rollbackToken: string;
  }): Promise<void>;
}

export interface WriteBackResult {
  rollbackToken: string;
  masterRecordId: string | null;
  fieldsWritten: string[];
  oldToNew: Record<
    string,
    { old: unknown; new: unknown; source: string; confidence: number }
  >;
  conflict: boolean;
}

export class MasterDBWriter {
  private readonly store: MasterStore;
  private readonly floor: number;

  constructor(store?: MasterStore, opts: { confidenceFloor?: number } = {}) {
    // Lazy default store avoids importing the DB in unit tests that pass a fake.
    this.store = store ?? drizzleMasterStore();
    this.floor = opts.confidenceFloor ?? WRITEBACK_CONFIDENCE_FLOOR;
  }

  /** Verified + above-floor fields eligible for the owned master. */
  private eligibleFields(contact: Contact): Record<string, FieldValue> {
    const out: Record<string, FieldValue> = {};
    for (const field of Object.keys(FIELD_TO_COLUMN)) {
      const fv = contact.fields[field];
      if (fv === undefined || emptyish(fv.value)) continue;
      if (fv.verified && fv.confidence >= this.floor) {
        out[field] = fv;
      } else if (
        !fv.verified &&
        field !== "email" &&
        fv.confidence >= HIGH_CONFIDENCE_UNVERIFIED_FLOOR
      ) {
        out[field] = fv;
      }
    }
    return out;
  }

  async writeBack(
    contact: Contact,
    opts: { conflict?: boolean; mirror?: (c: Contact) => Promise<void> } = {},
  ): Promise<WriteBackResult | null> {
    if (!contact.contactId) return null;
    const eligible = this.eligibleFields(contact);
    if (Object.keys(eligible).length === 0) return null;

    const ident = minimalIdentifiers(contact);
    if (!ident.email && !ident.linkedinUrl) {
      // No stable key to target a master row safely.
      return null;
    }

    let existing: Record<string, unknown> | null = null;
    try {
      existing = await this.store.findContact({
        email: ident.email,
        linkedinUrl: ident.linkedinUrl,
        fullName: contact.fullName,
        domain: contact.domain,
      });
    } catch {
      existing = null;
    }

    const oldToNew: WriteBackResult["oldToNew"] = {};
    const fieldSources: Record<string, unknown> = {};
    const columnValues: Record<string, unknown> = {};
    let maxConf = 0;
    let anyVerified = false;

    for (const [field, fv] of Object.entries(eligible)) {
      const column = FIELD_TO_COLUMN[field];
      const oldValue = existing ? existing[column] : null;
      columnValues[column] = fv.value;
      fieldSources[field] = {
        source: fv.source,
        confidence: fv.confidence,
        verified: fv.verified,
        observedAt: fv.observedAt.toISOString(),
      };
      maxConf = Math.max(maxConf, fv.confidence);
      anyVerified = anyVerified || fv.verified;
      if (oldValue !== fv.value) {
        oldToNew[field] = {
          old: oldValue ?? null,
          new: fv.value,
          source: fv.source,
          confidence: fv.confidence,
        };
      }
    }

    // If a row already exists and nothing changed, skip the write.
    if (existing && Object.keys(oldToNew).length === 0) return null;

    const conflict = Boolean(opts.conflict);
    const rollbackToken = randomUUID().replace(/-/g, "");
    const row: Record<string, unknown> = {
      ...(existing && existing.id ? { id: existing.id } : {}),
      ...columnValues,
      lakeb2bId: (existing?.lakeb2bId as string | undefined) ?? null,
      fullName: contact.fullName,
      firstName: contact.firstName,
      lastName: contact.lastName,
      domain: contact.domain,
      companyName: contact.company,
      firmographics: contact.firmographics,
      source:
        contact.fields.email?.source ??
        Object.values(eligible)[0]?.source ??
        "harbinger_waterfall",
      confidence: String(maxConf),
      verified: anyVerified,
      fieldSources,
      lastVerified: new Date(),
      syncStatus: conflict ? "conflict" : "local_only",
    };

    let masterRecordId: string | null = null;
    try {
      const upserted = await this.store.upsertContact(row);
      masterRecordId = upserted.id;
      await this.store.logWriteback({
        contactId: contact.contactId,
        masterRecordId,
        fieldsWritten: oldToNew,
        rollbackToken,
      });
    } catch {
      return null;
    }

    if (opts.mirror) {
      try {
        await opts.mirror(contact);
      } catch {
        // mirror is best-effort
      }
    }

    return {
      rollbackToken,
      masterRecordId,
      fieldsWritten: Object.keys(eligible),
      oldToNew,
      conflict,
    };
  }
}

/**
 * Drizzle-backed MasterStore against master_contacts / master_writeback_log.
 * Lazy-imported so unit tests that inject a fake never load the DB layer.
 */
export function drizzleMasterStore(): MasterStore {
  return {
    async findContact(keys) {
      const { adminDb } = await import("@/lib/db/admin");
      const { schema } = await import("@/db");
      const { and, eq, or, sql } = await import("drizzle-orm");
      const mc = schema.masterContacts;
      let where = undefined as ReturnType<typeof or> | undefined;
      if (keys.email) {
        where = sql`lower(${mc.email}) = lower(${keys.email})`;
      } else if (keys.linkedinUrl) {
        where = sql`lower(${mc.linkedinUrl}) = lower(${keys.linkedinUrl})`;
      } else if (keys.fullName && keys.domain) {
        where = and(
          sql`lower(${mc.fullName}) = lower(${keys.fullName})`,
          eq(mc.domain, keys.domain),
        );
      }
      if (!where) return null;
      const [row] = await adminDb.select().from(mc).where(where).limit(1);
      return (row as Record<string, unknown>) ?? null;
    },
    async upsertContact(row) {
      const { adminDb } = await import("@/lib/db/admin");
      const { schema } = await import("@/db");
      const { eq } = await import("drizzle-orm");
      const mc = schema.masterContacts;
      const { id, ...values } = row as { id?: string } & Record<
        string,
        unknown
      >;
      if (id) {
        await adminDb
          .update(mc)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(mc.id, id));
        return { id };
      }
      const [inserted] = await adminDb
        .insert(mc)
        .values(values as never)
        .returning({ id: mc.id });
      return { id: inserted.id };
    },
    async logWriteback(entry) {
      const { adminDb } = await import("@/lib/db/admin");
      const { schema } = await import("@/db");
      await adminDb.insert(schema.masterWritebackLog).values({
        contactId: entry.contactId,
        masterRecordId: entry.masterRecordId,
        fieldsWritten: entry.fieldsWritten,
        status: "written",
        rollbackToken: entry.rollbackToken,
      });
    },
  };
}
