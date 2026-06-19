/**
 * Process-global concurrency limiter for OpenRouter/LLM calls.
 *
 * With one shared OpenRouter key across many users, unbounded parallel calls
 * trip the key's rate limit (429s). `runLlm()` funnels every LLM call through a
 * FIFO semaphore capped at LLM_MAX_CONCURRENCY so concurrent in-flight calls
 * never exceed the cap; excess calls queue and run as slots free up.
 *
 * Single-process construct. When the app scales to multiple instances this must
 * move to a Redis token bucket (see the multi-worker note in the deploy plan).
 */

export interface Semaphore {
  /** Acquire a slot, run `fn`, release the slot (even if `fn` throws). */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Acquire a slot manually; resolves to an idempotent release fn. For work
   * that isn't a single promise (e.g. a stream held open while it drains).
   */
  acquire(): Promise<() => void>;
  /** Slots currently held. */
  inFlight(): number;
  /** Callers parked waiting for a slot. */
  waiting(): number;
}

/** A pure, testable bounded-concurrency semaphore. */
export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active++;
        resolve();
      });
    });
  }

  function release(): void {
    active--;
    const next = queue.shift();
    if (next) next();
  }

  async function acquireSlot(): Promise<() => void> {
    await acquire();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      const free = await acquireSlot();
      try {
        return await fn();
      } finally {
        free();
      }
    },
    acquire: acquireSlot,
    inFlight: () => active,
    waiting: () => queue.length,
  };
}

function maxConcurrency(): number {
  const n = Number(process.env.LLM_MAX_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 12;
}

/** The shared per-process LLM semaphore (pinned to globalThis to survive HMR). */
export function getLlmSemaphore(): Semaphore {
  const g = globalThis as typeof globalThis & {
    __harbinger_llm_sema?: Semaphore;
  };
  if (!g.__harbinger_llm_sema) {
    g.__harbinger_llm_sema = createSemaphore(maxConcurrency());
  }
  return g.__harbinger_llm_sema;
}

/** The one path every OpenRouter call should go through. */
export function runLlm<T>(fn: () => Promise<T>): Promise<T> {
  return getLlmSemaphore().run(fn);
}

/** Manual slot acquire for streaming calls; returns an idempotent release fn. */
export function acquireLlmSlot(): Promise<() => void> {
  return getLlmSemaphore().acquire();
}
