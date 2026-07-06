import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  brightDataFetchHtml,
  isBrightDataConfigured,
} from "./brightdata-client";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("isBrightDataConfigured", () => {
  it("is false unless both token and zone are set", () => {
    delete process.env.BRIGHTDATA_API_TOKEN;
    delete process.env.BRIGHTDATA_UNLOCKER_ZONE;
    expect(isBrightDataConfigured()).toBe(false);

    process.env.BRIGHTDATA_API_TOKEN = "tok";
    expect(isBrightDataConfigured()).toBe(false);

    process.env.BRIGHTDATA_UNLOCKER_ZONE = "web_unlocker1";
    expect(isBrightDataConfigured()).toBe(true);
  });
});

describe("brightDataFetchHtml", () => {
  beforeEach(() => {
    process.env.BRIGHTDATA_API_TOKEN = "secret-token";
    process.env.BRIGHTDATA_UNLOCKER_ZONE = "web_unlocker1";
  });

  it("POSTs to the Web Unlocker API with Bearer + {zone,url,format} and returns the body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("<html><h1>Jane Doe</h1></html>", { status: 200 }),
      );

    const html = await brightDataFetchHtml(
      "https://www.linkedin.com/in/jane-doe/",
    );
    expect(html).toContain("Jane Doe");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brightdata.com/request");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      zone: "web_unlocker1",
      url: "https://www.linkedin.com/in/jane-doe/",
      format: "raw",
    });
  });

  it("throws when unconfigured", async () => {
    delete process.env.BRIGHTDATA_API_TOKEN;
    await expect(
      brightDataFetchHtml("https://www.linkedin.com/in/jane-doe/"),
    ).rejects.toThrow(/not configured/i);
  });

  it("throws on a non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("blocked", { status: 403 }),
    );
    await expect(
      brightDataFetchHtml("https://www.linkedin.com/in/jane-doe/"),
    ).rejects.toThrow(/Bright Data 403/);
  });
});
