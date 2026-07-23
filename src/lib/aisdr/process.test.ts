import { describe, expect, it, vi, beforeEach } from "vitest";

const { rows } = vi.hoisted(() => ({ rows: [] as Array<{ id: string }> }));

vi.mock("@/db", async () => {
  const real =
    await vi.importActual<typeof import("../../../db/schema")>(
      "../../../db/schema",
    );
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(rows),
          })),
        })),
      })),
    })),
  };
  return { db, schema: real };
});

const handleInboundMessageMock = vi.fn();
vi.mock("./respond", () => ({
  handleInboundMessage: (...args: unknown[]) =>
    handleInboundMessageMock(...args),
}));

import { processPendingReplies } from "./process";

describe("processPendingReplies", () => {
  beforeEach(() => {
    rows.length = 0;
    handleInboundMessageMock.mockReset();
  });

  it("processes zero messages when the queue is empty", async () => {
    const result = await processPendingReplies();
    expect(result.processed).toBe(0);
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("runs handleInboundMessage for every unprocessed reply", async () => {
    rows.push({ id: "msg1" }, { id: "msg2" });
    handleInboundMessageMock.mockImplementation(async (id: string) => ({
      ok: true,
      mailboxMessageId: id,
      action: "halted_only",
    }));

    const result = await processPendingReplies();

    expect(result.processed).toBe(2);
    expect(handleInboundMessageMock).toHaveBeenCalledWith("msg1");
    expect(handleInboundMessageMock).toHaveBeenCalledWith("msg2");
  });

  it("keeps processing the batch even if one message throws", async () => {
    rows.push({ id: "msg1" }, { id: "msg2" });
    handleInboundMessageMock.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    handleInboundMessageMock.mockImplementationOnce(async (id: string) => ({
      ok: true,
      mailboxMessageId: id,
      action: "halted_only",
    }));

    const result = await processPendingReplies();

    expect(result.processed).toBe(2);
    expect(result.results[0].ok).toBe(false);
    expect(result.results[1].ok).toBe(true);
  });
});
