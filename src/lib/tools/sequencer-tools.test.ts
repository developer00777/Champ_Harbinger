import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("@/lib/db/scoped", async () => {
  const realSchema = await import("../../../db/schema");
  return {
    getScopedDb: vi.fn(),
    schema: realSchema,
  };
});

vi.mock("@/db", async () => {
  const realSchema = await import("../../../db/schema");
  return { schema: realSchema };
});

vi.mock("@/lib/db/admin", () => ({
  adminDb: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/mailbox/registry", () => ({
  getConnectorForRow: vi.fn(),
  getDefaultMailboxRow: vi.fn(),
}));

vi.mock("@/lib/sequencing/guardrails", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/sequencing/guardrails")
  >("@/lib/sequencing/guardrails");
  return {
    ...actual,
    runSendGuardrails: vi.fn(),
  };
});

vi.mock("@/lib/services/knowledge-base", () => ({
  findOrCreateOrganization: vi.fn(),
  findOrCreatePerson: vi.fn(),
  linkPersonToCampaign: vi.fn(),
}));

import { getScopedDb } from "@/lib/db/scoped";
import { adminDb } from "@/lib/db/admin";
import {
  getConnectorForRow,
  getDefaultMailboxRow,
} from "@/lib/mailbox/registry";
import {
  GuardrailViolationError,
  runSendGuardrails,
} from "@/lib/sequencing/guardrails";
import {
  findOrCreateOrganization,
  findOrCreatePerson,
  linkPersonToCampaign,
} from "@/lib/services/knowledge-base";
import { createLead, enrollInSequence, sendMessage } from "./sequencer-tools";

function selectChain(data: unknown[]) {
  const limit = vi.fn().mockResolvedValue(data);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function makeScopedDbSelectQueue(results: unknown[][]) {
  let i = 0;
  return vi.fn().mockImplementation(() => {
    const data = results[i] ?? [];
    i++;
    return selectChain(data);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createLead", () => {
  it("rejects when the campaign is not owned by the user", async () => {
    vi.mocked(getScopedDb).mockResolvedValue({
      raw: { select: makeScopedDbSelectQueue([[]]) },
      userId: "user_1",
      orgId: null,
    } as never);

    const result = (await createLead.execute!(
      { campaignId: "11111111-1111-1111-1111-111111111111", name: "Alex" },
      {} as never,
    )) as { error?: string };

    expect(result.error).toMatch(/not found|not owned/i);
  });

  it("creates a person and links it to the campaign", async () => {
    vi.mocked(getScopedDb).mockResolvedValue({
      raw: { select: makeScopedDbSelectQueue([[{ id: "camp_1" }]]) },
      userId: "user_1",
      orgId: null,
    } as never);
    vi.mocked(findOrCreateOrganization).mockResolvedValue({
      id: "org_1",
    } as never);
    vi.mocked(findOrCreatePerson).mockResolvedValue({
      id: "person_1",
    } as never);
    vi.mocked(linkPersonToCampaign).mockResolvedValue({ id: "cp_1" } as never);

    const result = (await createLead.execute!(
      {
        campaignId: "11111111-1111-1111-1111-111111111111",
        name: "Alex Rivera",
        email: "alex@acme.com",
        organizationName: "Acme",
      },
      {} as never,
    )) as { personId: string; campaignPeopleId: string };

    expect(result.personId).toBe("person_1");
    expect(result.campaignPeopleId).toBe("cp_1");
    expect(findOrCreatePerson).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Alex Rivera",
        organization_id: "org_1",
      }),
    );
  });
});

describe("enrollInSequence", () => {
  it("returns an error when the sequence is not owned by the user", async () => {
    vi.mocked(getScopedDb).mockResolvedValue({
      raw: { select: makeScopedDbSelectQueue([[]]) },
      userId: "user_1",
      orgId: null,
    } as never);

    const result = (await enrollInSequence.execute!(
      {
        sequenceId: "22222222-2222-2222-2222-222222222222",
        campaignPeopleId: "33333333-3333-3333-3333-333333333333",
      },
      {} as never,
    )) as { error?: string };

    expect(result.error).toMatch(/not found|not owned/i);
  });

  it("is a no-op when already enrolled", async () => {
    vi.mocked(getScopedDb).mockResolvedValue({
      raw: {
        select: makeScopedDbSelectQueue([
          [{ id: "seq_1", campaignId: "camp_1", status: "draft" }],
          [{ id: "cp_1", personId: "person_1", campaignId: "camp_1" }],
          [{ id: "enrollment_1", status: "waiting" }],
        ]),
        insert: vi.fn(),
      },
      userId: "user_1",
      orgId: null,
    } as never);

    const result = (await enrollInSequence.execute!(
      {
        sequenceId: "22222222-2222-2222-2222-222222222222",
        campaignPeopleId: "33333333-3333-3333-3333-333333333333",
      },
      {} as never,
    )) as { enrollmentId: string; message: string };

    expect(result.enrollmentId).toBe("enrollment_1");
    expect(result.message).toMatch(/already enrolled/i);
  });
});

describe("sendMessage guardrail enforcement", () => {
  const campaignPeopleId = "44444444-4444-4444-4444-444444444444";

  function mockScopedDbForSend() {
    vi.mocked(getScopedDb).mockResolvedValue({
      raw: {
        select: makeScopedDbSelectQueue([
          [
            {
              id: campaignPeopleId,
              personId: "person_1",
              campaignId: "camp_1",
            },
          ],
          [{ id: "person_1", workEmail: "lead@acme.com", personalEmail: null }],
        ]),
      },
      userId: "user_1",
      orgId: null,
    } as never);
  }

  it("refuses to send when the daily cap guardrail throws — connector.send is never called", async () => {
    mockScopedDbForSend();
    vi.mocked(getDefaultMailboxRow).mockResolvedValue({
      id: "mbx_1",
      clerkUserId: "user_1",
      fromAddress: "me@coldoutbound.dev",
      status: "active",
      config: {},
    } as never);
    vi.mocked(runSendGuardrails).mockRejectedValue(
      new GuardrailViolationError("daily_cap", "Daily send cap reached"),
    );
    const send = vi.fn();
    vi.mocked(getConnectorForRow).mockReturnValue({ send } as never);

    const result = (await sendMessage.execute!(
      {
        campaignPeopleId,
        subject: "Hi",
        bodyHtml: "<p>Hi</p>",
      },
      {} as never,
    )) as { error?: string; guardrail?: string };

    expect(result.guardrail).toBe("daily_cap");
    expect(send).not.toHaveBeenCalled();
    expect(vi.mocked(adminDb.insert)).not.toHaveBeenCalled();
  });

  it("refuses to send when the domain-health guardrail throws, even though no skip option exists on the tool's input schema", async () => {
    mockScopedDbForSend();
    vi.mocked(getDefaultMailboxRow).mockResolvedValue({
      id: "mbx_1",
      clerkUserId: "user_1",
      fromAddress: "me@coldoutbound.dev",
      status: "active",
      config: { infraProvider: "inboxkit", infraDomain: "coldoutbound.dev" },
    } as never);
    vi.mocked(runSendGuardrails).mockRejectedValue(
      new GuardrailViolationError("domain_unhealthy", "Domain not verified"),
    );
    const send = vi.fn();
    vi.mocked(getConnectorForRow).mockReturnValue({ send } as never);

    // sendMessage's Zod input schema has no "skipGuardrails" field at all —
    // attempting to pass one is simply dropped by validation, proving there
    // is no bypass surface.
    const result = (await sendMessage.execute!(
      {
        campaignPeopleId,
        subject: "Hi",
        bodyHtml: "<p>Hi</p>",
        // @ts-expect-error -- intentionally probing for a nonexistent bypass field
        skipGuardrails: true,
      },
      {} as never,
    )) as { error?: string; guardrail?: string };

    expect(result.guardrail).toBe("domain_unhealthy");
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to send when the throttle guardrail throws", async () => {
    mockScopedDbForSend();
    vi.mocked(getDefaultMailboxRow).mockResolvedValue({
      id: "mbx_1",
      clerkUserId: "user_1",
      fromAddress: "me@coldoutbound.dev",
      status: "active",
      config: {},
    } as never);
    vi.mocked(runSendGuardrails).mockRejectedValue(
      new GuardrailViolationError("throttle", "Throttled"),
    );
    const send = vi.fn();
    vi.mocked(getConnectorForRow).mockReturnValue({ send } as never);

    const result = (await sendMessage.execute!(
      { campaignPeopleId, subject: "Hi", bodyHtml: "<p>Hi</p>" },
      {} as never,
    )) as { guardrail?: string };

    expect(result.guardrail).toBe("throttle");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends and records sent_emails once all guardrails pass", async () => {
    mockScopedDbForSend();
    vi.mocked(getDefaultMailboxRow).mockResolvedValue({
      id: "mbx_1",
      clerkUserId: "user_1",
      fromAddress: "me@coldoutbound.dev",
      status: "active",
      config: {},
    } as never);
    vi.mocked(runSendGuardrails).mockResolvedValue({
      dailyCap: { sentToday: 1, cap: 35 },
      throttle: { elapsedMs: 100_000, requiredGapMs: 45_000 },
      domainHealth: { healthy: true, source: "not_applicable" },
    });
    const send = vi.fn().mockResolvedValue({ messageId: "msg_123" });
    vi.mocked(getConnectorForRow).mockReturnValue({ send } as never);
    const insertValues = vi.fn().mockReturnValue(Promise.resolve());
    vi.mocked(adminDb.insert).mockReturnValue({
      values: insertValues,
    } as never);
    const updateSet = vi.fn().mockReturnValue({ where: vi.fn() });
    vi.mocked(adminDb.update).mockReturnValue({ set: updateSet } as never);

    const result = (await sendMessage.execute!(
      { campaignPeopleId, subject: "Hi", bodyHtml: "<p>Hi</p>" },
      {} as never,
    )) as { status: string; messageId: string };

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "lead@acme.com", subject: "Hi" }),
    );
    expect(result.status).toBe("sent");
    expect(result.messageId).toBe("msg_123");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        agentmailMessageId: "msg_123",
        toEmail: "lead@acme.com",
        fromEmail: "me@coldoutbound.dev",
      }),
    );
  });

  it("errors out (without calling guardrails) when the lead has no email", async () => {
    vi.mocked(getScopedDb).mockResolvedValue({
      raw: {
        select: makeScopedDbSelectQueue([
          [
            {
              id: campaignPeopleId,
              personId: "person_1",
              campaignId: "camp_1",
            },
          ],
          [{ id: "person_1", workEmail: null, personalEmail: null }],
        ]),
      },
      userId: "user_1",
      orgId: null,
    } as never);

    const result = (await sendMessage.execute!(
      { campaignPeopleId, subject: "Hi", bodyHtml: "<p>Hi</p>" },
      {} as never,
    )) as { error?: string };

    expect(result.error).toMatch(/no email/i);
    expect(runSendGuardrails).not.toHaveBeenCalled();
  });
});
