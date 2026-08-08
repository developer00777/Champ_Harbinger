/**
 * Standalone background-worker process. Runs the pg-boss schedules + job
 * handlers (tracking dispatch, tracking runs, outreach followups) against the
 * same Postgres as the app.
 *
 * Dev (alongside `pnpm dev`):
 *   pnpm worker:dev
 *
 * Production / process manager:
 *   node --import tsx scripts/run-worker.ts
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";
import { createRequire } from "module";

// Stub `server-only` so worker modules can be imported outside Next.js.
const _require = createRequire(import.meta.url);
const Module = _require("module") as typeof import("module") & {
  _resolveFilename: (
    request: string,
    parent: unknown,
    isMain: boolean,
    options: unknown,
  ) => string;
};
const _origResolve = Module._resolveFilename.bind(Module);
(
  Module as unknown as { _resolveFilename: typeof _origResolve }
)._resolveFilename = (request, parent, isMain, options) => {
  if (request === "server-only") {
    return resolve(process.cwd(), "src/__tests__/__mocks__/server-only.ts");
  }
  return _origResolve(request, parent, isMain, options);
};

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

async function main() {
  const { startWorkers } = await import("@/lib/jobs/workers");
  const { getBoss } = await import("@/lib/jobs/boss");
  const { refreshWorkerConfig, startWorkerConfigPolling } =
    await import("@/lib/jobs/worker-config");

  // Pull provider keys (OpenRouter, PDL, InboxKit, etc.) from the app before
  // starting job handlers, so the first job has real keys whenever possible.
  // Then keep polling in the background so a key rotated in Vercel reaches
  // this process without a worker redeploy.
  await refreshWorkerConfig();
  const configPoll = startWorkerConfigPolling();

  await startWorkers();

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, draining…`);
    clearInterval(configPoll);
    try {
      const boss = await getBoss();
      await boss.stop({ graceful: true, timeout: 30_000 });
    } catch (err) {
      console.error("[worker] shutdown error:", err);
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
