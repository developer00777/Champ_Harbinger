import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock @/db with a table-identity-keyed query builder ──────────────────
// Keeps tests independent of query call ORDER (multiple selects can run in
// parallel via Promise.all in respond.ts) while still using the real schema
// table objects as map keys, so `adminDb.select().from(schema.X)` resolves
// to whatever the test configured for X.

const { dbState, resetDbState } = vi.hoisted(() => {
  const state = {
    selectData: new Map<unknown, unknown[]>(),
    updateReturning: new Map<unknown, unknown[]>(),
    insertReturning: new Map<unknown, unknown[]>(),
    updateCalls: [] as Array<{
      table: unknown;
      patch: Record<string, unknown>;
    }>,
    insertCalls: [] as Array<{
      table: unknown;
      values: Record<string, unknown>;
    }>,
  };
  function reset() {
    state.selectData.clear();
    state.updateReturning.clear();
    state.insertReturning.clear();
    state.updateCalls = [];
    state.insertCalls = [];
  }
  return { dbState: state, resetDbState: reset };
});

vi.mock("@/db", async () => {
  const real =
    await vi.importActual<typeof import("../../../db/schema")>(
      "../../../db/schema",
    );

  function makeSelectChain(data: unknown[]) {
    const limit = vi.fn().mockResolvedValue(data);
    const orderBy = vi.fn().mockResolvedValue(data);
    const whereResolvable = Object.assign(Promise.resolve(data), {
      limit,
      orderBy,
    });
    const where = vi.fn().mockReturnValue(whereResolvable);
    const innerJoin = vi.fn(() => ({ where }));
    return { where, limit, orderBy, innerJoin };
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) =>
        makeSelectChain(dbState.selectData.get(table) ?? []),
      ),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((patch: Record<string, unknown>) => {
        dbState.updateCalls.push({ table, patch });
        return {
          where: vi.fn(() =>
            Object.assign(Promise.resolve(undefined), {
              returning: vi
                .fn()
                .mockResolvedValue(dbState.updateReturning.get(table) ?? []),
            }),
          ),
        };
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        dbState.insertCalls.push({ table, values });
        return {
          returning: vi
            .fn()
            .mockResolvedValue(dbState.insertReturning.get(table) ?? []),
        };
      }),
    })),
  };

  return { db, schema: real };
});

const classifyReplyMock = vi.fn();
vi.mock("./classify", async () => {
  const actual =
    await vi.importActual<typeof import("./classify")>("./classify");
  return {
    ...actual,
    classifyReply: (...args: unknown[]) => classifyReplyMock(...args),
  };
});

const composeEmailMock = vi.fn();
vi.mock("@/lib/email-composition/compose", () => ({
  composeEmail: (...args: unknown[]) => composeEmailMock(...args),
}));

const getEmailProviderMock = vi.fn();
vi.mock("@/lib/email/provider", () => ({
  getEmailProvider: (...args: unknown[]) => getEmailProviderMock(...args),
}));

const getDefaultMailboxRowMock = vi.fn();
const getConnectorForRowMock = vi.fn();
vi.mock("@/lib/mailbox/registry", () => ({
  getDefaultMailboxRow: (...args: unknown[]) =>
    getDefaultMailboxRowMock(...args),
  getConnectorForRow: (...args: unknown[]) => getConnectorForRowMock(...args),
}));

import { schema } from "@/db";
import { handleInboundMessage, HALT_STATUS } from "./respond";

const MESSAGE_ROW = {
  id: "msg1",
  connectionId: "conn1",
  clerkUserId: "user1",
  messageId: "m1",
  inReplyTo: null,
  fromAddress: "prospect@example.com",
  toAddress: "me@example.com",
  subject: "Re: quick question",
  snippet: "snippet",
  body: "This is the reply body.",
  sentEmailId: "se1",
  receivedAt: new Date(),
  createdAt: new Date(),
};

const SENT_EMAIL_ROW = {
  id: "se1",
  campaignId: "camp1",
  campaignPeopleId: "cp1",
  personId: "p1",
  clerkUserId: "user1",
  clerkOrgId: null,
  subject: "Original subject",
  repliedAt: null,
};

const PERSON_ROW = {
  name: "Jane Prospect",
  title: "VP Sales",
  workEmail: "jane@example.com",
  personalEmail: null,
  enrichmentData: {},
  organizationId: null,
};

const CAMPAIGN_ROW = {
  name: "Q3 Outbound",
  icp: {},
  offering: {},
  positioning: {},
};

const USER_SETTINGS_ROW = {
  fromName: "Alex",
  warmIntroEmail: "am@example.com",
  warmIntroName: "Sam",
  replyToEmail: null,
};

function seedBaseData() {
  dbState.selectData.set(schema.mailboxMessages, [MESSAGE_ROW]);
  dbState.selectData.set(schema.sentEmails, [SENT_EMAIL_ROW]);
  dbState.selectData.set(schema.people, [PERSON_ROW]);
  dbState.selectData.set(schema.campaigns, [CAMPAIGN_ROW]);
  dbState.selectData.set(schema.userSettings, [USER_SETTINGS_ROW]);
  dbState.selectData.set(schema.campaignPeople, [{ id: "cp1" }]);
  dbState.updateReturning.set(schema.sequenceEnrollments, [{ id: "enr1" }]);
  dbState.insertReturning.set(schema.emailDrafts, [{ id: "draft1" }]);
}

describe("handleInboundMessage — halt-on-reply (hard requirement)", () => {
  beforeEach(() => {
    resetDbState();
    classifyReplyMock.mockReset();
    composeEmailMock.mockReset();
    getEmailProviderMock.mockReset();
    getDefaultMailboxRowMock.mockReset();
    getConnectorForRowMock.mockReset();
    seedBaseData();
  });

  it("halts the enrollment even when classification throws", async () => {
    classifyReplyMock.mockRejectedValue(new Error("model unavailable"));
    composeEmailMock.mockResolvedValue({
      ok: true,
      email: {
        subject: "Re: Original subject",
        bodyHtml: "<p>reply</p>",
        bodyText: "reply",
        aiReasoning: "context reasoning",
      },
    });

    const result = await handleInboundMessage("msg1");

    expect(result.classificationFailed).toBe(true);
    expect(result.haltedEnrollmentIds).toEqual(["enr1"]);

    const haltCall = dbState.updateCalls.find(
      (c) =>
        c.table === schema.sequenceEnrollments &&
        c.patch.status === HALT_STATUS,
    );
    expect(haltCall).toBeDefined();
  });

  it("halts the enrollment even when classification throws a non-Error value", async () => {
    classifyReplyMock.mockRejectedValue("weird rejection");
    composeEmailMock.mockResolvedValue({
      ok: true,
      email: {
        subject: "Re: Original subject",
        bodyHtml: "<p>reply</p>",
        bodyText: "reply",
        aiReasoning: "context reasoning",
      },
    });

    const result = await handleInboundMessage("msg1");

    expect(result.haltedEnrollmentIds).toEqual(["enr1"]);
    const haltCall = dbState.updateCalls.find(
      (c) =>
        c.table === schema.sequenceEnrollments &&
        c.patch.status === HALT_STATUS,
    );
    expect(haltCall).toBeDefined();
  });

  it("halts unconditionally regardless of intent (unsubscribe)", async () => {
    classifyReplyMock.mockResolvedValue({
      intent: "unsubscribe",
      confidence: 1,
    });

    const result = await handleInboundMessage("msg1");

    expect(result.action).toBe("halted_only");
    expect(result.haltedEnrollmentIds).toEqual(["enr1"]);
    expect(composeEmailMock).not.toHaveBeenCalled();
  });

  it("stamps sentEmails.repliedAt on every reply", async () => {
    classifyReplyMock.mockResolvedValue({
      intent: "wrong_person",
      confidence: 0.9,
    });

    await handleInboundMessage("msg1");

    const repliedAtCall = dbState.updateCalls.find(
      (c) => c.table === schema.sentEmails,
    );
    expect(repliedAtCall).toBeDefined();
    expect(repliedAtCall?.patch.repliedAt).toBeInstanceOf(Date);
  });
});

describe("handleInboundMessage — warm-intro handoff", () => {
  beforeEach(() => {
    resetDbState();
    classifyReplyMock.mockReset();
    composeEmailMock.mockReset();
    getEmailProviderMock.mockReset();
    getDefaultMailboxRowMock.mockReset();
    getConnectorForRowMock.mockReset();
    seedBaseData();
    getDefaultMailboxRowMock.mockResolvedValue(null);
  });

  it("sends the warm-intro handoff for 'interested'", async () => {
    classifyReplyMock.mockResolvedValue({
      intent: "interested",
      confidence: 0.9,
    });
    const send = vi.fn().mockResolvedValue({ id: "x", status: "sent" });
    getEmailProviderMock.mockReturnValue({ enabled: true, send });

    const result = await handleInboundMessage("msg1");

    expect(result.action).toBe("warm_intro_sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe(USER_SETTINGS_ROW.warmIntroEmail);
  });

  it("sends the warm-intro handoff for 'meeting_request'", async () => {
    classifyReplyMock.mockResolvedValue({
      intent: "meeting_request",
      confidence: 0.95,
    });
    const send = vi.fn().mockResolvedValue({ id: "x", status: "sent" });
    getEmailProviderMock.mockReturnValue({ enabled: true, send });

    const result = await handleInboundMessage("msg1");

    expect(result.action).toBe("warm_intro_sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does NOT send a warm-intro handoff for other intents (e.g. objection)", async () => {
    classifyReplyMock.mockResolvedValue({
      intent: "objection",
      confidence: 0.7,
    });
    composeEmailMock.mockResolvedValue({
      ok: true,
      email: {
        subject: "Re: Original subject",
        bodyHtml: "<p>reply</p>",
        bodyText: "reply",
        aiReasoning: "context reasoning",
      },
    });
    const send = vi.fn();
    getEmailProviderMock.mockReturnValue({ enabled: true, send });

    const result = await handleInboundMessage("msg1");

    expect(result.action).toBe("drafted_reply");
    expect(send).not.toHaveBeenCalled();
  });

  it("does NOT send a warm-intro handoff for question/not_now", async () => {
    classifyReplyMock.mockResolvedValue({ intent: "not_now", confidence: 0.6 });
    composeEmailMock.mockResolvedValue({
      ok: true,
      email: {
        subject: "Re: Original subject",
        bodyHtml: "<p>reply</p>",
        bodyText: "reply",
        aiReasoning: "context reasoning",
      },
    });
    const send = vi.fn();
    getEmailProviderMock.mockReturnValue({ enabled: true, send });

    await handleInboundMessage("msg1");

    expect(send).not.toHaveBeenCalled();
  });
});

describe("handleInboundMessage — out_of_office reschedule", () => {
  beforeEach(() => {
    resetDbState();
    classifyReplyMock.mockReset();
    seedBaseData();
  });

  it("reschedules the enrollment instead of leaving it halted", async () => {
    classifyReplyMock.mockResolvedValue({
      intent: "out_of_office",
      confidence: 0.9,
    });

    const result = await handleInboundMessage("msg1");

    expect(result.action).toBe("rescheduled");
    const rescheduleCall = dbState.updateCalls.find(
      (c) =>
        c.table === schema.sequenceEnrollments && c.patch.status === "waiting",
    );
    expect(rescheduleCall).toBeDefined();
    expect(rescheduleCall?.patch.nextSendAt).toBeInstanceOf(Date);
  });
});

describe("handleInboundMessage — no linked sent email", () => {
  it("returns ok without crashing when the message has no sentEmailId", async () => {
    resetDbState();
    dbState.selectData.set(schema.mailboxMessages, [
      { ...MESSAGE_ROW, sentEmailId: null },
    ]);

    const result = await handleInboundMessage("msg1");

    expect(result.ok).toBe(true);
    expect(result.action).toBe("no_sequence_context");
    expect(result.haltedEnrollmentIds).toEqual([]);
  });

  it("returns ok:false when the message does not exist", async () => {
    resetDbState();
    dbState.selectData.set(schema.mailboxMessages, []);

    const result = await handleInboundMessage("does-not-exist");

    expect(result.ok).toBe(false);
  });
});
