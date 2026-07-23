import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/mailbox/registry", () => ({
  encryptSecret: vi.fn((obj: unknown) => `enc(${JSON.stringify(obj)})`),
}));

vi.mock("@/db", async () => {
  const realSchema = await import("../../../db/schema");
  return { schema: realSchema };
});

import { adminDb } from "@/lib/db/admin";
import { encryptSecret } from "@/lib/mailbox/registry";
import type { MailboxCredentials } from "./types";
import { importMailboxFromInboxKit } from "./import-mailboxes";

const credentials: MailboxCredentials = {
  email: "alex@coldoutbound.dev",
  smtpHost: "smtp.inboxkit.com",
  smtpPort: 587,
  smtpSecure: false,
  imapHost: "imap.inboxkit.com",
  imapPort: 993,
  imapSecure: true,
  username: "alex@coldoutbound.dev",
  password: "app-password-123",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("importMailboxFromInboxKit", () => {
  it("inserts a new mailbox_connections row stamped with infraProvider/infraDomain", async () => {
    const limit = vi.fn().mockResolvedValue([]); // no existing row
    const where = vi.fn().mockReturnValue({ limit });
    vi.mocked(adminDb.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ where }),
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: "mbx_1" }]);
    const values = vi.fn().mockReturnValue({ returning });
    vi.mocked(adminDb.insert).mockReturnValue({ values } as never);

    const result = await importMailboxFromInboxKit({
      clerkUserId: "user_1",
      domain: "coldoutbound.dev",
      credentials,
    });

    expect(result).toEqual({
      id: "mbx_1",
      fromAddress: "alex@coldoutbound.dev",
    });
    expect(encryptSecret).toHaveBeenCalledWith({
      user: "alex@coldoutbound.dev",
      pass: "app-password-123",
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "smtp_imap",
        fromAddress: "alex@coldoutbound.dev",
        config: expect.objectContaining({
          infraProvider: "inboxkit",
          infraDomain: "coldoutbound.dev",
          smtpHost: "smtp.inboxkit.com",
        }),
      }),
    );
  });

  it("updates the existing row instead of duplicating on re-import", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "mbx_existing" }]);
    const where = vi.fn().mockReturnValue({ limit });
    vi.mocked(adminDb.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ where }),
    } as never);

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    vi.mocked(adminDb.update).mockReturnValue({ set } as never);

    const result = await importMailboxFromInboxKit({
      clerkUserId: "user_1",
      domain: "coldoutbound.dev",
      credentials,
    });

    expect(result.id).toBe("mbx_existing");
    expect(adminDb.insert).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalled();
  });
});
