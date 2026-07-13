import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/browser-pool", () => ({
  isObscuraConfigured: vi.fn(() => false),
  obscuraFetchHtml: vi.fn(async () => ""),
}));
vi.mock("@/lib/services/brightdata-client", () => ({
  isBrightDataConfigured: vi.fn(() => false),
  brightDataFetchHtml: vi.fn(async () => ""),
}));

import {
  isObscuraConfigured,
  obscuraFetchHtml,
} from "@/lib/services/browser-pool";
import {
  isBrightDataConfigured,
  brightDataFetchHtml,
} from "@/lib/services/brightdata-client";
import { LinkedinService } from "./linkedin-service";

const bdConfigured = vi.mocked(isBrightDataConfigured);
const bdFetch = vi.mocked(brightDataFetchHtml);
const obConfigured = vi.mocked(isObscuraConfigured);
const obFetch = vi.mocked(obscuraFetchHtml);

const PROFILE_HTML = `
  <html><body><main>
    <h1>Jane Doe</h1>
    <p class="top-card-layout__headline">VP Engineering at Acme</p>
    <section>About: builds data platforms. Experience: Acme, Globex.</section>
  </main></body></html>`;

const WALL_HTML = `<html><body><h1>Sign in to LinkedIn</h1></body></html>`;

afterEach(() => {
  vi.clearAllMocks();
  bdConfigured.mockReturnValue(false);
  obConfigured.mockReturnValue(false);
  bdFetch.mockResolvedValue("");
  obFetch.mockResolvedValue("");
});

describe("LinkedinService.scrapeProfile source selection", () => {
  it("uses Bright Data first and parses a rich profile with rawText", async () => {
    bdConfigured.mockReturnValue(true);
    obConfigured.mockReturnValue(true);
    bdFetch.mockResolvedValue(PROFILE_HTML);

    const result = await new LinkedinService().scrapeProfile(
      "https://linkedin.com/in/jane-doe",
    );

    expect(bdFetch).toHaveBeenCalledTimes(1);
    expect(obFetch).not.toHaveBeenCalled(); // Bright Data succeeded → no fallback
    expect(result.profile?.name).toBe("Jane Doe");
    expect(result.profile?.headline).toContain("VP Engineering");
    expect(result.profile?.rawText).toContain("builds data platforms");
  });

  it("falls back to Obscura when Bright Data is unconfigured", async () => {
    bdConfigured.mockReturnValue(false);
    obConfigured.mockReturnValue(true);
    obFetch.mockResolvedValue(PROFILE_HTML);

    const result = await new LinkedinService().scrapeProfile(
      "https://linkedin.com/in/jane-doe",
    );

    expect(bdFetch).not.toHaveBeenCalled();
    expect(obFetch).toHaveBeenCalledTimes(1);
    expect(result.profile?.name).toBe("Jane Doe");
  });

  it("falls through to Obscura when Bright Data returns an auth wall", async () => {
    bdConfigured.mockReturnValue(true);
    obConfigured.mockReturnValue(true);
    bdFetch.mockResolvedValue(WALL_HTML);
    obFetch.mockResolvedValue(PROFILE_HTML);

    const result = await new LinkedinService().scrapeProfile(
      "https://linkedin.com/in/jane-doe",
    );

    expect(bdFetch).toHaveBeenCalledTimes(1);
    expect(obFetch).toHaveBeenCalledTimes(1);
    expect(result.profile?.name).toBe("Jane Doe");
  });

  it("never throws and returns empty when no source is configured", async () => {
    const result = await new LinkedinService().scrapeProfile(
      "https://linkedin.com/in/jane-doe",
    );
    expect(result).toEqual({ profile: null, posts: [] });
    expect(bdFetch).not.toHaveBeenCalled();
    expect(obFetch).not.toHaveBeenCalled();
  });

  it("never throws when a source errors, and returns empty if all fail", async () => {
    bdConfigured.mockReturnValue(true);
    obConfigured.mockReturnValue(true);
    bdFetch.mockRejectedValue(new Error("timeout"));
    obFetch.mockRejectedValue(new Error("gateway down"));

    const result = await new LinkedinService().scrapeProfile(
      "https://linkedin.com/in/jane-doe",
    );
    expect(result).toEqual({ profile: null, posts: [] });
    expect(bdFetch).toHaveBeenCalledTimes(1);
    expect(obFetch).toHaveBeenCalledTimes(1);
  });
});
