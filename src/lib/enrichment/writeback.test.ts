import { describe, expect, it, vi } from "vitest";

import { getSettings } from "./config";
import { buildFieldValue } from "./confidence";
import { makeContact } from "./types";
import { MasterDBWriter, type MasterStore } from "./writeback";

const settings = getSettings();

function fakeStore(existing: Record<string, unknown> | null = null) {
  const upserts: Array<Record<string, unknown>> = [];
  const logs: Array<Record<string, unknown>> = [];
  const store: MasterStore = {
    findContact: vi.fn(async () => existing),
    upsertContact: vi.fn(async (row) => {
      upserts.push(row);
      return { id: "master-1" };
    }),
    logWriteback: vi.fn(async (entry) => {
      logs.push(entry);
    }),
  };
  return { store, upserts, logs };
}

function verifiedContact() {
  const c = makeContact({
    contactId: "c1",
    fullName: "Jane Doe",
    domain: "acme.com",
    company: "Acme",
  });
  c.fields.email = buildFieldValue({
    value: "jane@acme.com",
    provider: "owned_email_gate",
    settings,
    verified: true,
  });
  c.fields.title = buildFieldValue({
    value: "VP Engineering",
    provider: "owned_scrape",
    settings,
    verified: true,
  });
  c.fields.linkedin = buildFieldValue({
    value: "https://www.linkedin.com/in/jane-doe",
    provider: "owned_scrape",
    settings,
    verified: true,
  });
  return c;
}

describe("MasterDBWriter.writeBack", () => {
  it("upserts verified, above-floor fields into the owned master and logs the write", async () => {
    const { store, upserts, logs } = fakeStore(null);
    const writer = new MasterDBWriter(store);
    const result = await writer.writeBack(verifiedContact());

    expect(result).not.toBeNull();
    expect(result?.masterRecordId).toBe("master-1");
    expect(result?.fieldsWritten).toEqual(
      expect.arrayContaining(["email", "title", "linkedin"]),
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0].email).toBe("jane@acme.com");
    expect(upserts[0].title).toBe("VP Engineering");
    expect(upserts[0].linkedinUrl).toBe("https://www.linkedin.com/in/jane-doe");
    expect(upserts[0].syncStatus).toBe("local_only");
    expect(logs).toHaveLength(1);
  });

  it("excludes unverified low-confidence fields", async () => {
    const { store, upserts } = fakeStore(null);
    const c = makeContact({
      contactId: "c2",
      fullName: "Sam",
      domain: "x.com",
    });
    // Unverified, below floor -> excluded.
    c.fields.title = buildFieldValue({
      value: "Maybe Manager",
      provider: "owned_scrape",
      settings,
      verified: false,
    });
    const writer = new MasterDBWriter(store);
    const result = await writer.writeBack(c);
    // No eligible fields -> nothing written.
    expect(result).toBeNull();
    expect(upserts).toHaveLength(0);
  });

  it("flags the master row as conflict when a conflict was detected this run", async () => {
    const { store, upserts } = fakeStore(null);
    const writer = new MasterDBWriter(store);
    const result = await writer.writeBack(verifiedContact(), {
      conflict: true,
    });
    expect(result?.conflict).toBe(true);
    expect(upserts[0].syncStatus).toBe("conflict");
  });

  it("returns null when no stable key (no email or linkedin) is present", async () => {
    const { store } = fakeStore(null);
    const c = makeContact({ contactId: "c3", fullName: "No Keys" });
    c.fields.title = buildFieldValue({
      value: "CEO",
      provider: "owned_scrape",
      settings,
      verified: true,
    });
    const writer = new MasterDBWriter(store);
    expect(await writer.writeBack(c)).toBeNull();
  });
});
