import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: vi.fn(),
  },
}));

vi.mock("@/lib/crypto", () => ({
  decryptApiKey: vi.fn((v: string) => v.replace("encrypted_", "")),
}));

vi.mock("@/db", () => ({
  schema: { userApiKeys: {} },
}));

import { validateApiKey } from "@/lib/api/validate-api-key";
import { adminDb } from "@/lib/db/admin";

function mockRows(
  rows: Array<{ clerkUserId: string; keyValueEncrypted: string }>,
) {
  vi.mocked(adminDb.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  } as never);
}

describe("validateApiKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns userId for a valid token", async () => {
    mockRows([
      { clerkUserId: "user_abc", keyValueEncrypted: "encrypted_chh_valid" },
    ]);
    const req = new Request("http://x", {
      headers: { authorization: "Bearer chh_valid" },
    });
    const ctx = await validateApiKey(req);
    expect(ctx.userId).toBe("user_abc");
  });

  it("throws 401 for a token without chh_ prefix", async () => {
    const req = new Request("http://x", {
      headers: { authorization: "Bearer wrong_token" },
    });
    await expect(validateApiKey(req)).rejects.toBeInstanceOf(Response);
  });

  it("throws 401 when no stored key matches the token", async () => {
    mockRows([
      { clerkUserId: "user_abc", keyValueEncrypted: "encrypted_chh_other" },
    ]);
    const req = new Request("http://x", {
      headers: { authorization: "Bearer chh_wrong" },
    });
    await expect(validateApiKey(req)).rejects.toBeInstanceOf(Response);
  });

  it("throws 401 when Authorization header is absent", async () => {
    const req = new Request("http://x");
    await expect(validateApiKey(req)).rejects.toBeInstanceOf(Response);
  });
});
