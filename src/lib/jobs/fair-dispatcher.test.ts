import { describe, expect, it } from "vitest";

import { createFairDispatcher } from "./fair-dispatcher";

interface TestJob {
  user: string;
  label: string;
  gate?: Promise<void>;
  fail?: boolean;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeDispatcher(
  perUserMax: number,
  globalMax: number,
  started: string[],
) {
  return createFairDispatcher<TestJob>({
    perUserMax,
    globalMax,
    userIdOf: (j) => j.user,
    run: async (j) => {
      started.push(j.label);
      if (j.gate) await j.gate;
      if (j.fail) throw new Error("boom");
    },
  });
}

describe("createFairDispatcher", () => {
  it("caps concurrency per user", async () => {
    const started: string[] = [];
    const d = makeDispatcher(2, 10, started);
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    const ps = gates.map((g, i) =>
      d.submit({ user: "A", label: `A${i}`, gate: g.promise }),
    );

    await flush();
    expect(started.length).toBe(2);
    expect(d.inFlightForUser("A")).toBe(2);

    gates.forEach((g) => g.resolve());
    await Promise.all(ps);
    expect(started.length).toBe(5);
    expect(d.inFlight()).toBe(0);
  });

  it("caps total concurrency across users", async () => {
    const started: string[] = [];
    const d = makeDispatcher(10, 3, started);
    const gates = Array.from({ length: 10 }, () => deferred<void>());
    const ps = gates.map((g, i) =>
      d.submit({ user: i < 5 ? "A" : "B", label: `${i}`, gate: g.promise }),
    );

    await flush();
    expect(started.length).toBe(3);
    expect(d.inFlight()).toBe(3);

    gates.forEach((g) => g.resolve());
    await Promise.all(ps);
    expect(started.length).toBe(10);
  });

  it("round-robins so one user's backlog doesn't starve another", async () => {
    const started: string[] = [];
    const d = makeDispatcher(1, 2, started);
    const aGates = Array.from({ length: 5 }, () => deferred<void>());
    const aPs = aGates.map((g, i) =>
      d.submit({ user: "A", label: `A${i}`, gate: g.promise }),
    );
    const bGate = deferred<void>();
    const bP = d.submit({ user: "B", label: "B0", gate: bGate.promise });

    await flush();
    // perUserMax=1, globalMax=2 → exactly one A job + the one B job run now.
    expect(started).toContain("B0");
    expect(started.filter((s) => s.startsWith("A")).length).toBe(1);
    expect(started.length).toBe(2);

    aGates.forEach((g) => g.resolve());
    bGate.resolve();
    await Promise.all([...aPs, bP]);
    expect(started.length).toBe(6); // everything eventually ran
  });

  it("resolves submit() on success and rejects on failure", async () => {
    const started: string[] = [];
    const d = makeDispatcher(5, 5, started);
    await expect(
      d.submit({ user: "A", label: "ok" }),
    ).resolves.toBeUndefined();
    await expect(
      d.submit({ user: "A", label: "bad", fail: true }),
    ).rejects.toThrow("boom");
    expect(d.inFlight()).toBe(0);
  });
});
