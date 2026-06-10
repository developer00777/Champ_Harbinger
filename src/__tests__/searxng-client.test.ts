import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searxSearch, isSearxConfigured } from "@/lib/search/searxng-client";

describe("searxng-client", () => {
  const originalEnv = { ...process.env };
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.SEARXNG_URL = "http://searxng:8080";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("isSearxConfigured reflects SEARXNG_URL", () => {
    expect(isSearxConfigured()).toBe(true);
    delete process.env.SEARXNG_URL;
    expect(isSearxConfigured()).toBe(false);
  });

  it("returns [] without hitting the network when unconfigured", async () => {
    delete process.env.SEARXNG_URL;
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await searxSearch("anything")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps + caps JSON results and drops entries without a url", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { title: "A", url: "https://a.com", content: "ca" },
          { title: "no-url", content: "x" },
          { title: "B", url: "https://b.com", content: "cb" },
        ],
      }),
    })) as unknown as typeof fetch;

    const out = await searxSearch("q", 1);
    expect(out).toEqual([{ title: "A", url: "https://a.com", content: "ca" }]);
  });

  it("returns [] on a non-ok response", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
    })) as unknown as typeof fetch;
    expect(await searxSearch("q")).toEqual([]);
  });
});
