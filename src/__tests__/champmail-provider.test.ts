import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { ChampMailProvider } from "@/lib/email/champmail";

const mockFetch = fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;

describe("ChampMailProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CHAMPMAIL_BASE_URL = "https://mail.example.com";
    process.env.CHAMPMAIL_API_KEY = "k-123";
    mockFetch.mockReset();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is enabled only when base url + api key are set", () => {
    expect(new ChampMailProvider().enabled).toBe(true);
    delete process.env.CHAMPMAIL_API_KEY;
    expect(new ChampMailProvider().enabled).toBe(false);
  });

  it("posts the mapped body with X-API-Key and returns the message id", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: "m-1", status: "sent" }),
    });

    const result = await new ChampMailProvider().send({
      to: "a@b.com",
      from: "sender@champ.com",
      subject: "Hi",
      text: "plain",
      html: "<p>rich</p>",
      replyTo: "reply@champ.com",
    });

    expect(result).toEqual({ id: "m-1", providerId: "m-1", status: "sent" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://mail.example.com/api/v1/send");
    expect((opts.headers as Record<string, string>)["X-API-Key"]).toBe("k-123");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      to: "a@b.com",
      from_address: "sender@champ.com",
      subject: "Hi",
      html_body: "<p>rich</p>",
      text_body: "plain",
      reply_to: "reply@champ.com",
    });
  });

  it("uses from_name when `from` is not an email", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: "m-2", status: "queued" }),
    });
    const result = await new ChampMailProvider().send({
      to: "a@b.com",
      from: "ChampHarbinger",
      subject: "s",
      text: "t",
    });
    expect(result.status).toBe("queued");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.from_name).toBe("ChampHarbinger");
    expect(body.from_address).toBeUndefined();
  });

  it("returns failed on a non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });
    const result = await new ChampMailProvider().send({
      to: "a@b.com",
      from: "x@y.com",
      subject: "s",
      text: "t",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("502");
  });
});
