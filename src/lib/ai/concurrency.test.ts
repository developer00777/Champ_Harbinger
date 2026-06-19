import { describe, expect, it } from "vitest";

import { createSemaphore } from "./concurrency";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let all pending microtasks + timers settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createSemaphore", () => {
  it("runs at most `max` tasks concurrently", async () => {
    const sema = createSemaphore(2);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    const tasks = gates.map((g) =>
      sema.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await g.promise;
        active--;
      }),
    );

    await flush();
    expect(sema.inFlight()).toBe(2);
    expect(sema.waiting()).toBe(3);

    gates.forEach((g) => g.resolve());
    await Promise.all(tasks);

    expect(peak).toBe(2);
    expect(sema.inFlight()).toBe(0);
    expect(sema.waiting()).toBe(0);
  });

  it("runs every submitted task to completion and returns its value", async () => {
    const sema = createSemaphore(3);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => sema.run(async () => i * 2)),
    );
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it("releases the slot when a task throws", async () => {
    const sema = createSemaphore(1);
    await expect(
      sema.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // The single slot must be free again.
    await expect(sema.run(async () => "ok")).resolves.toBe("ok");
    expect(sema.inFlight()).toBe(0);
  });

  it("acquire() hands back a release fn that frees the slot", async () => {
    const sema = createSemaphore(1);
    const release = await sema.acquire();
    expect(sema.inFlight()).toBe(1);

    let secondAcquired = false;
    const pending = sema.acquire().then((r) => {
      secondAcquired = true;
      return r;
    });
    await flush();
    expect(secondAcquired).toBe(false);
    expect(sema.waiting()).toBe(1);

    release();
    const release2 = await pending;
    expect(secondAcquired).toBe(true);
    expect(sema.inFlight()).toBe(1);

    // Double-release must be a no-op (not free an extra slot).
    release();
    release2();
    release2();
    expect(sema.inFlight()).toBe(0);
  });

  it("dispatches waiters in FIFO order", async () => {
    const sema = createSemaphore(1);
    const order: number[] = [];
    const gate = deferred<void>();
    const first = sema.run(async () => {
      order.push(0);
      await gate.promise;
    });
    await flush();
    const rest = [1, 2, 3].map((n) =>
      sema.run(async () => {
        order.push(n);
      }),
    );
    gate.resolve();
    await Promise.all([first, ...rest]);
    expect(order).toEqual([0, 1, 2, 3]);
  });
});
