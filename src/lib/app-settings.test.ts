import { describe, expect, it, vi } from "vitest";

import { createAppSettingsStore } from "./app-settings";

function makeStore(overrides?: {
  ttlMs?: number;
  now?: () => number;
  initial?: Record<string, unknown>;
}) {
  const rows = new Map<string, unknown>(
    Object.entries(overrides?.initial ?? {}),
  );
  const fetchValue = vi.fn(async (key: string) =>
    rows.has(key) ? rows.get(key) : undefined,
  );
  const upsertValue = vi.fn(async (key: string, value: unknown) => {
    rows.set(key, value);
  });
  const store = createAppSettingsStore({
    fetchValue,
    upsertValue,
    ttlMs: overrides?.ttlMs ?? 100,
    now: overrides?.now,
  });
  return { store, rows, fetchValue, upsertValue };
}

describe("createAppSettingsStore", () => {
  it("returns null for an unset key and caches the miss", async () => {
    const { store, fetchValue } = makeStore({ now: () => 0 });
    expect(await store.get("missing")).toBeNull();
    expect(await store.get("missing")).toBeNull();
    expect(fetchValue).toHaveBeenCalledTimes(1); // negative result cached too
  });

  it("serves cached values within the TTL and refetches after expiry", async () => {
    let clock = 0;
    const { store, rows, fetchValue } = makeStore({
      ttlMs: 100,
      now: () => clock,
      initial: { default_model: "a/one" },
    });
    expect(await store.get("default_model")).toBe("a/one");
    rows.set("default_model", "b/two"); // out-of-band DB change
    expect(await store.get("default_model")).toBe("a/one"); // still cached
    expect(fetchValue).toHaveBeenCalledTimes(1);
    clock = 150; // past TTL
    expect(await store.get("default_model")).toBe("b/two");
    expect(fetchValue).toHaveBeenCalledTimes(2);
  });

  it("set() writes through the cache immediately", async () => {
    const { store, upsertValue, fetchValue } = makeStore({ now: () => 0 });
    await store.set("default_model", "x/y", "admin_1");
    expect(upsertValue).toHaveBeenCalledWith("default_model", "x/y", "admin_1");
    expect(await store.get("default_model")).toBe("x/y");
    expect(fetchValue).not.toHaveBeenCalled(); // served from write-through
  });

  it("invalidate() drops the cached entry so the next get refetches", async () => {
    const { store, rows, fetchValue } = makeStore({
      now: () => 0,
      initial: { k: 1 },
    });
    expect(await store.get("k")).toBe(1);
    rows.set("k", 2);
    store.invalidate("k");
    expect(await store.get("k")).toBe(2);
    expect(fetchValue).toHaveBeenCalledTimes(2);
  });
});
