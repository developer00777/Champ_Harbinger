import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InboxKitProvider } from "./inboxkit";

const originalFetch = global.fetch;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("InboxKitProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.INBOXKIT_API_KEY = "test_key";
    process.env.INBOXKIT_WORKSPACE_ID = "ws_1";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.INBOXKIT_API_KEY;
    delete process.env.INBOXKIT_WORKSPACE_ID;
  });

  it("reports enabled only when an API key is set", () => {
    expect(new InboxKitProvider().enabled).toBe(true);
    delete process.env.INBOXKIT_API_KEY;
    expect(new InboxKitProvider().enabled).toBe(false);
  });

  it("throws (not silently no-ops) when a call is made without an API key", async () => {
    delete process.env.INBOXKIT_API_KEY;
    const provider = new InboxKitProvider();
    await expect(provider.searchDomains("acme")).rejects.toThrow(
      /not configured/i,
    );
  });

  it("sends Authorization Bearer + X-Workspace-Id headers on every call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          results: [{ domain: "acme.dev", available: true, price: 12 }],
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new InboxKitProvider();
    await provider.searchDomains("acme");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://api.inboxkit.com/v1/domains/search"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test_key",
          "X-Workspace-Id": "ws_1",
        }),
      }),
    );
  });

  it("maps domain search results to the provider-neutral shape", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          results: [{ domain: "acme.dev", available: true, price: 12 }],
        }),
      ) as unknown as typeof fetch;

    const results = await new InboxKitProvider().searchDomains("acme");
    expect(results).toEqual([
      { domain: "acme.dev", available: true, priceUsd: 12 },
    ]);
  });

  it("computes domain health as healthy only when active + spf + dkim + dmarc all pass", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        domain: "acme.dev",
        status: "active",
        spf_verified: true,
        dkim_verified: true,
        dmarc_verified: false,
      }),
    ) as unknown as typeof fetch;

    const status = await new InboxKitProvider().getDomainStatus("acme.dev");
    expect(status.healthy).toBe(false);
    expect(status.dmarcVerified).toBe(false);
  });

  it("throws InboxKitApiError with status + body detail on a non-2xx response", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "rate limited" }, false, 429),
      ) as unknown as typeof fetch;

    await expect(new InboxKitProvider().listDomains()).rejects.toThrow(/429/);
  });

  it("createOrder posts mailbox_count and returns a normalized InfraOrder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "order_1",
        domain: "acme.dev",
        status: "processing",
        mailboxes: [{ email: "alex@acme.dev", status: "pending" }],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const order = await new InboxKitProvider().createOrder({
      domain: "acme.dev",
      mailboxCount: 1,
    });

    expect(order).toEqual({
      providerOrderId: "order_1",
      domain: "acme.dev",
      status: "processing",
      mailboxes: [{ email: "alex@acme.dev", status: "pending" }],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      domain: "acme.dev",
      mailbox_count: 1,
    });
  });
});
