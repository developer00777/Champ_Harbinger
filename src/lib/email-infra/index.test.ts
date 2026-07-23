import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getEmailInfraProvider,
  isEmailInfraConfigured,
  resetEmailInfraProviderCache,
} from "./index";

describe("getEmailInfraProvider", () => {
  beforeEach(() => {
    resetEmailInfraProviderCache();
    delete process.env.INBOXKIT_API_KEY;
  });

  afterEach(() => {
    resetEmailInfraProviderCache();
    delete process.env.INBOXKIT_API_KEY;
  });

  it("returns a disabled provider when INBOXKIT_API_KEY is unset", () => {
    const provider = getEmailInfraProvider();
    expect(provider.enabled).toBe(false);
    expect(provider.name).toBe("disabled");
  });

  it("disabled provider throws (fails closed) rather than no-op", async () => {
    const provider = getEmailInfraProvider();
    await expect(provider.searchDomains("acme")).rejects.toThrow(
      /not configured/i,
    );
    await expect(
      provider.createOrder({ domain: "a.dev", mailboxCount: 1 }),
    ).rejects.toThrow();
  });

  it("returns the InboxKit provider once INBOXKIT_API_KEY is set", () => {
    process.env.INBOXKIT_API_KEY = "key_123";
    resetEmailInfraProviderCache();
    const provider = getEmailInfraProvider();
    expect(provider.name).toBe("inboxkit");
    expect(provider.enabled).toBe(true);
  });

  it("caches the provider across calls", () => {
    process.env.INBOXKIT_API_KEY = "key_123";
    resetEmailInfraProviderCache();
    const a = getEmailInfraProvider();
    const b = getEmailInfraProvider();
    expect(a).toBe(b);
  });
});

describe("isEmailInfraConfigured", () => {
  afterEach(() => {
    delete process.env.INBOXKIT_API_KEY;
  });

  it("reflects INBOXKIT_API_KEY presence directly", () => {
    delete process.env.INBOXKIT_API_KEY;
    expect(isEmailInfraConfigured()).toBe(false);
    process.env.INBOXKIT_API_KEY = "key_123";
    expect(isEmailInfraConfigured()).toBe(true);
  });
});
