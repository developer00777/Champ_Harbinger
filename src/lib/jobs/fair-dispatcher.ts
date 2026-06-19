/**
 * In-memory fair scheduler for the single pg-boss worker.
 *
 * pg-boss is the durable inbox; this decides EXECUTION order so that no user's
 * large bulk run starves others. Each user runs at most `perUserMax` jobs at
 * once, total at most `globalMax`, and users are served round-robin. `submit()`
 * resolves/rejects when the job's `run()` settles, so the pg-boss handler only
 * marks a message complete once the real work is done.
 *
 * SINGLE-PROCESS construct: the Map/ring state is per worker. Do not run
 * multiple worker replicas until this is replaced by a Redis-backed limiter
 * (see the multi-worker note in the deploy plan).
 */

export interface FairDispatcherOpts<J> {
  perUserMax: number;
  globalMax: number;
  userIdOf: (job: J) => string;
  run: (job: J) => Promise<void>;
}

export interface FairDispatcher<J> {
  /** Queue a job; resolves/rejects when its run() settles. */
  submit(job: J): Promise<void>;
  /** Total jobs currently running. */
  inFlight(): number;
  /** Jobs currently running for one user. */
  inFlightForUser(userId: string): number;
}

interface Entry<J> {
  job: J;
  resolve: () => void;
  reject: (e: unknown) => void;
}

export function createFairDispatcher<J>(
  opts: FairDispatcherOpts<J>,
): FairDispatcher<J> {
  const { perUserMax, globalMax, userIdOf, run } = opts;
  const queues = new Map<string, Entry<J>[]>();
  const inflight = new Map<string, number>();
  const ring: string[] = []; // users with backlog, in round-robin order
  let pointer = 0;
  let globalInFlight = 0;

  const userInFlight = (u: string) => inflight.get(u) ?? 0;

  function enqueue(u: string, entry: Entry<J>): void {
    let q = queues.get(u);
    if (!q) {
      q = [];
      queues.set(u, q);
      ring.push(u);
    }
    q.push(entry);
  }

  /** Next user (round-robin from `pointer`) with a queued job and spare slots. */
  function nextEligibleUser(): string | null {
    for (let i = 0; i < ring.length; i++) {
      const idx = (pointer + i) % ring.length;
      const u = ring[idx];
      const q = queues.get(u);
      if (q && q.length > 0 && userInFlight(u) < perUserMax) {
        pointer = (idx + 1) % ring.length;
        return u;
      }
    }
    return null;
  }

  function cleanupUser(u: string): void {
    const q = queues.get(u);
    if (q && q.length === 0 && userInFlight(u) === 0) {
      queues.delete(u);
      const idx = ring.indexOf(u);
      if (idx >= 0) {
        ring.splice(idx, 1);
        if (ring.length === 0) pointer = 0;
        else if (pointer > idx) pointer = (pointer - 1) % ring.length;
        else pointer = pointer % ring.length;
      }
    }
  }

  function pump(): void {
    while (globalInFlight < globalMax) {
      const u = nextEligibleUser();
      if (u == null) break;
      const entry = queues.get(u)!.shift()!;
      globalInFlight++;
      inflight.set(u, userInFlight(u) + 1);
      // Defer the actual work a microtask so this loop can fill all free slots
      // synchronously before any job body runs.
      Promise.resolve()
        .then(() => run(entry.job))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          globalInFlight--;
          inflight.set(u, userInFlight(u) - 1);
          cleanupUser(u);
          pump();
        });
    }
  }

  return {
    submit(job: J): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        enqueue(userIdOf(job), { job, resolve, reject });
        pump();
      });
    },
    inFlight: () => globalInFlight,
    inFlightForUser: userInFlight,
  };
}
