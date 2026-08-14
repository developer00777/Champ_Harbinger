import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InboxKitProvider, resetInboxKitWorkspaceCache } from "./inboxkit";

/**
 * These mocks encode the shapes VERIFIED against the live api.inboxkit.com
 * (see docs/DEPLOY-RAILWAY.md → InboxKit). An earlier version of this suite
 * asserted an invented REST schema (`GET /v1/domains/search` returning
 * `{results:[{domain}]}`) and passed green while every real call 404'd — so if
 * you change a shape here, re-verify it against the real API first.
 */

const originalFetch = global.fetch;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return {
    url,
    init,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  };
}

describe("InboxKitProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetInboxKitWorkspaceCache();
    process.env.INBOXKIT_API_KEY = "test_key";
    process.env.INBOXKIT_WORKSPACE_ID = "ws_1";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetInboxKitWorkspaceCache();
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

  it("POSTs domain search to /v1/api/domains/search with auth + workspace headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: false, domains: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await new InboxKitProvider().searchDomains("acme");

    const { url, init, body } = lastCall(fetchMock);
    expect(url).toBe("https://api.inboxkit.com/v1/api/domains/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test_key",
      "X-Workspace-Id": "ws_1",
    });
    expect(body).toMatchObject({ keyword: "acme" });
  });

  it("maps search rows (`name`/`price`) to the provider-neutral shape", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        error: false,
        domains: [
          { name: "acme-outreach.org", price: 9, tld: ".org", available: true },
        ],
      }),
    ) as unknown as typeof fetch;

    const results = await new InboxKitProvider().searchDomains("acme");
    expect(results).toEqual([
      { domain: "acme-outreach.org", available: true, priceUsd: 9 },
    ]);
  });

  it("drops unsellable rows (price 0 = unsupported TLD, and banned names)", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        error: false,
        domains: [
          { name: "ok.com", price: 11, available: true },
          { name: "unsupported.dev", price: 0, available: true },
          { name: "banned.com", price: 11, available: true, banned: true },
        ],
      }),
    ) as unknown as typeof fetch;

    const results = await new InboxKitProvider().searchDomains("acme");
    expect(results.map((r) => r.domain)).toEqual(["ok.com"]);
  });

  it("looks the workspace id up once when INBOXKIT_WORKSPACE_ID is unset", async () => {
    delete process.env.INBOXKIT_WORKSPACE_ID;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/workspaces/list")) {
        return Promise.resolve(
          jsonResponse({ error: false, workspaces: [{ uid: "ws_resolved" }] }),
        );
      }
      return Promise.resolve(jsonResponse({ error: false, domains: [] }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new InboxKitProvider();
    await provider.listDomains();
    await provider.listDomains();

    const workspaceLookups = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/workspaces/list"),
    );
    expect(workspaceLookups).toHaveLength(1);
    const domainCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/domains/list"),
    ) as [string, RequestInit];
    expect(domainCall[1].headers).toMatchObject({
      "X-Workspace-Id": "ws_resolved",
    });
  });

  it("computes domain health as healthy only when active + spf + dkim + dmarc all pass", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        error: false,
        domains: [
          {
            name: "acme.dev",
            status: "active",
            spf_verified: true,
            dkim_verified: true,
            dmarc_verified: false,
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const status = await new InboxKitProvider().getDomainStatus("acme.dev");
    expect(status.healthy).toBe(false);
    expect(status.dmarcVerified).toBe(false);
  });

  it("treats string verification values ('verified') as verified", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        error: false,
        domains: [
          {
            name: "acme.dev",
            status: "active",
            spf: "verified",
            dkim: "verified",
            dmarc: "verified",
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const status = await new InboxKitProvider().getDomainStatus("acme.dev");
    expect(status.healthy).toBe(true);
  });

  it("reports not_found (never healthy) for a domain outside the workspace", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: false, domains: [] }),
      ) as unknown as typeof fetch;

    const status = await new InboxKitProvider().getDomainStatus("nope.dev");
    expect(status).toMatchObject({ status: "not_found", healthy: false });
  });

  it("throws InboxKitApiError with status + body detail on a non-2xx response", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ code: 429, message: "rate limited" }, false, 429),
      ) as unknown as typeof fetch;

    await expect(new InboxKitProvider().listDomains()).rejects.toThrow(/429/);
  });

  it("surfaces HTTP-200 {error:true} envelopes as errors", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          error: true,
          message: "Domain not found for this workspace",
        }),
      ) as unknown as typeof fetch;

    await expect(new InboxKitProvider().listDomains()).rejects.toThrow(
      /Domain not found/,
    );
  });

  it("createOrder posts the nested domains[].mailboxes[] shape InboxKit requires", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        error: false,
        uid: "order_1",
        status: "processing",
        domains: [{ name: "acme.dev" }],
        mailboxes: [{ email: "alex@acme.dev", status: "pending" }],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const order = await new InboxKitProvider().createOrder({
      domain: "acme.dev",
      mailboxCount: 2,
    });

    expect(order).toEqual({
      providerOrderId: "order_1",
      domain: "acme.dev",
      status: "processing",
      mailboxes: [{ email: "alex@acme.dev", status: "pending" }],
    });

    const { url, body } = lastCall(fetchMock);
    expect(url).toBe("https://api.inboxkit.com/v1/api/orders");
    expect(body.domains).toHaveLength(1);
    expect(body.domains[0]).toMatchObject({ name: "acme.dev" });
    expect(body.domains[0].contact_details).toBeDefined();
    expect(body.domains[0].mailboxes).toHaveLength(2);
    expect(body.domains[0].mailboxes[0]).toMatchObject({
      domain_name: "acme.dev",
      platform: "google",
    });
  });

  it("derives mailbox email from username + domain_name when absent", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        error: false,
        mailboxes: [
          { username: "alex", domain_name: "acme.dev", status: "active" },
        ],
      }),
    ) as unknown as typeof fetch;

    const mailboxes = await new InboxKitProvider().listMailboxes("acme.dev");
    expect(mailboxes).toEqual([{ email: "alex@acme.dev", status: "active" }]);
  });

  it("fetches credentials over GET with an email query param", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        error: false,
        email: "alex@acme.dev",
        username: "alex@acme.dev",
        password: "secret",
        smtp_host: "smtp.gmail.com",
        smtp_port: 465,
        imap_host: "imap.gmail.com",
        imap_port: 993,
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const creds = await new InboxKitProvider().getMailboxCredentials(
      "alex@acme.dev",
    );

    const { url, init } = lastCall(fetchMock);
    expect(init.method).toBe("GET");
    expect(url).toContain("/mailboxes/show-credentials?email=alex%40acme.dev");
    // 465 implies implicit TLS, 993 implies IMAP over TLS.
    expect(creds).toMatchObject({
      email: "alex@acme.dev",
      smtpPort: 465,
      smtpSecure: true,
      imapPort: 993,
      imapSecure: true,
      password: "secret",
    });
  });

  it("cancelMailbox splits the email into username + domain_name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: false }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await new InboxKitProvider().cancelMailbox("alex@acme.dev");

    const { url, body } = lastCall(fetchMock);
    expect(url).toBe("https://api.inboxkit.com/v1/api/mailboxes/cancel");
    expect(body.mailboxes[0]).toMatchObject({
      username: "alex",
      domain_name: "acme.dev",
    });
  });
});
