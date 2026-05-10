import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { _marker: "raw-db" },
  schema: {
    campaigns: {
      clerkUserId: { sql: "clerk_user_id" },
      clerkOrgId: { sql: "clerk_org_id" },
    },
    userProfile: {
      clerkUserId: { sql: "clerk_user_id" },
      clerkOrgId: { sql: "clerk_org_id" },
    },
    chats: {
      clerkUserId: { sql: "clerk_user_id" },
      // no clerkOrgId on chats
    },
  },
}));

// Mock drizzle-orm eq/and so we can inspect calls without a real DB
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ type: "eq", col, val })),
  and: vi.fn((...args) => ({ type: "and", args })),
}));

import { getCurrentUser } from "@/lib/auth";
import { getScopedDb } from "./scoped";
import { schema } from "@/db";
import { eq, and } from "drizzle-orm";

describe("getScopedDb", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("exposes userId and orgId from the current session", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user_1",
      orgId: "org_1",
    });
    const sdb = await getScopedDb();
    expect(sdb.userId).toBe("user_1");
    expect(sdb.orgId).toBe("org_1");
  });

  it("exposes the raw db instance", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user_1",
      orgId: null,
    });
    const sdb = await getScopedDb();
    expect((sdb.raw as unknown as { _marker: string })._marker).toBe("raw-db");
  });

  it("scope() prefers orgId when both are present and column exists", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user_1",
      orgId: "org_1",
    });
    const sdb = await getScopedDb();
    sdb.scope(schema.campaigns);
    expect(eq).toHaveBeenCalledWith(schema.campaigns.clerkOrgId, "org_1");
  });

  it("scope() falls back to userId when no orgId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user_1",
      orgId: null,
    });
    const sdb = await getScopedDb();
    sdb.scope(schema.campaigns);
    expect(eq).toHaveBeenCalledWith(schema.campaigns.clerkUserId, "user_1");
  });

  it("scope() uses userId when table has no clerkOrgId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user_1",
      orgId: "org_1",
    });
    const sdb = await getScopedDb();
    sdb.scope(schema.chats);
    expect(eq).toHaveBeenCalledWith(schema.chats.clerkUserId, "user_1");
  });

  it("scoped() returns just the tenant scope when no extra where given", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user_1",
      orgId: null,
    });
    vi.mocked(eq).mockReturnValue({
      type: "eq",
      col: "x",
      val: "y",
    } as unknown as ReturnType<typeof eq>);
    const sdb = await getScopedDb();
    const result = sdb.scoped(schema.campaigns);
    expect(and).not.toHaveBeenCalled();
    expect(result).toEqual({ type: "eq", col: "x", val: "y" });
  });

  it("scoped() combines with an extra where clause", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user_1",
      orgId: null,
    });
    const mockScope = {
      type: "eq",
      col: "x",
      val: "y",
    } as unknown as ReturnType<typeof eq>;
    vi.mocked(eq).mockReturnValue(mockScope);
    const mockAnd = { type: "and" } as unknown as ReturnType<typeof and>;
    vi.mocked(and).mockReturnValue(mockAnd);
    const extraWhere = { type: "extra" } as unknown as ReturnType<typeof eq>;
    const sdb = await getScopedDb();
    const result = sdb.scoped(schema.campaigns, extraWhere);
    expect(and).toHaveBeenCalledWith(mockScope, extraWhere);
    expect(result).toEqual(mockAnd);
  });

  it("throws if no Clerk session", async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(
      new Error("Unauthorized: no Clerk session"),
    );
    await expect(getScopedDb()).rejects.toThrow("Unauthorized");
  });
});
