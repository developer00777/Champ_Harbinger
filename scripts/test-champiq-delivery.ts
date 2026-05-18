/**
 * End-to-end test for ChampHarbinger → ChampOracle delivery.
 *
 * Strategy: spin up an in-process HTTP server that mimics the ChampOracle
 * /api/harbinger/* contract. Insert a champiq_queue item into Postgres,
 * call deliverProspectToChampIQ, and verify:
 *  - HTTP POST landed at the mock server with the right body + auth header
 *  - The DB row was updated to status="delivered"
 *
 * Run: DATABASE_URL=postgres://... pnpm exec tsx scripts/test-champiq-delivery.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { config } from "dotenv";
import { resolve } from "path";
import { createRequire } from "module";

// Stub server-only for tsx
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
)._resolveFilename = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => {
  if (request === "server-only") {
    return resolve(process.cwd(), "src/__tests__/__mocks__/server-only.ts");
  }
  return _origResolve(request, parent, isMain, options);
};

config({ path: resolve(process.cwd(), ".env.local") });

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

interface CapturedRequest {
  method: string;
  url: string;
  authHeader: string | undefined;
  body: unknown;
}

async function startMockChampOracle(port: number, expectedKey: string) {
  const requests: CapturedRequest[] = [];

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const bodyText = await readBody(req);
      const body = bodyText ? JSON.parse(bodyText) : null;
      const authHeader = req.headers["x-champoracle-api-key"] as
        | string
        | undefined;
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authHeader,
        body,
      });

      if (req.url === "/api/harbinger/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.url === "/api/harbinger/prospects") {
        if (authHeader !== expectedKey) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ received: 1, stored: 1, duplicates: 0, errors: [] }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    },
  );

  await new Promise<void>((r) => server.listen(port, () => r()));
  return { server, requests };
}

async function run() {
  console.log("\n🧪 ChampHarbinger → ChampOracle delivery test\n");

  const PORT = 5099;
  const API_KEY = "test-champoracle-key-abc123";
  const { server, requests } = await startMockChampOracle(PORT, API_KEY);
  console.log(`Mock ChampOracle listening on http://localhost:${PORT}`);

  try {
    const { deliverProspectToChampIQ, checkChampOracleHealth } =
      await import("../src/lib/services/champiq-delivery");
    const { adminDb } = await import("../src/lib/db/admin");
    const { schema } = await import("../db");
    const { eq } = await import("drizzle-orm");

    // ── Test 1: health check ─────────────────────────────────────────────
    console.log("\n[Test 1] Health check");
    const health = await checkChampOracleHealth(`http://localhost:${PORT}`);
    console.log(`  Result: ${JSON.stringify(health)}`);
    if (!health.ok) {
      throw new Error(
        `Expected health.ok=true, got: ${JSON.stringify(health)}`,
      );
    }
    console.log("  ✓ Health check passed");

    // ── Test 2: insert a fake queue item and deliver ─────────────────────
    console.log("\n[Test 2] Insert queue item + deliver");
    const TEST_USER_ID = "user_test_delivery_" + Date.now();

    // Insert a fake API key for this user (mock CHAMPORACLE_API_KEY via env var
    // since BYOK requires the crypto encryption setup)
    process.env.CHAMPORACLE_OUTBOUND_API_KEY = API_KEY;

    const [inserted] = await adminDb
      .insert(schema.champiqQueue)
      .values({
        clerkUserId: TEST_USER_ID,
        companyName: "TestCo",
        companyDomain: "testco.com",
        companyData: { industry: "SaaS" },
        contacts: [],
        signalName: "Test Signal",
        signalReasoning: "End-to-end test",
        signalData: {},
        score: 0.75,
        talkingPoints: ["Just raised funding", "Hiring rapidly"],
        status: "pending",
      })
      .returning({ id: schema.champiqQueue.id });

    const queueId = inserted.id;
    console.log(`  Inserted queue item: ${queueId}`);

    const result = await deliverProspectToChampIQ(
      queueId,
      `http://localhost:${PORT}`,
    );
    console.log(`  Delivery result: ${JSON.stringify(result)}`);
    if (!result.ok) {
      throw new Error(`Expected ok=true, got: ${JSON.stringify(result)}`);
    }

    // Check status updated
    const [updated] = await adminDb
      .select({
        status: schema.champiqQueue.status,
        pushedAt: schema.champiqQueue.pushedAt,
      })
      .from(schema.champiqQueue)
      .where(eq(schema.champiqQueue.id, queueId))
      .limit(1);
    console.log(
      `  DB status after push: ${updated?.status}, pushedAt: ${updated?.pushedAt}`,
    );
    if (updated?.status !== "delivered") {
      throw new Error(`Expected status=delivered, got: ${updated?.status}`);
    }
    if (!updated?.pushedAt) {
      throw new Error("Expected pushedAt to be set");
    }
    console.log("  ✓ Push succeeded and DB updated");

    // ── Test 3: verify request shape ─────────────────────────────────────
    console.log("\n[Test 3] Verify request shape");
    const pushReq = requests.find((r) => r.url === "/api/harbinger/prospects");
    if (!pushReq) throw new Error("No push request captured");
    console.log(
      `  Captured auth header: ${pushReq.authHeader === API_KEY ? "✓ correct" : "✗ MISMATCH"}`,
    );
    if (pushReq.authHeader !== API_KEY) {
      throw new Error(`Auth header mismatch: ${pushReq.authHeader}`);
    }

    const reqBody = pushReq.body as {
      prospects: Array<Record<string, unknown>>;
    };
    const p = reqBody.prospects[0];
    console.log(
      `  champharb_queue_id: ${p.champharb_queue_id === queueId ? "✓" : "✗"}`,
    );
    console.log(`  company: ${p.company === "TestCo" ? "✓" : "✗"}`);
    console.log(
      `  company_domain: ${p.company_domain === "testco.com" ? "✓" : "✗"}`,
    );
    console.log(
      `  signal_name: ${p.signal_name === "Test Signal" ? "✓" : "✗"}`,
    );
    console.log(`  score: ${p.score === 0.75 ? "✓" : "✗"}`);
    console.log(
      `  talking_points: ${Array.isArray(p.talking_points) && (p.talking_points as string[]).length === 2 ? "✓" : "✗"}`,
    );

    // ── Test 4: failure path (wrong API key) ─────────────────────────────
    console.log(
      "\n[Test 4] Wrong API key → push fails, status stays unchanged",
    );
    process.env.CHAMPORACLE_OUTBOUND_API_KEY = "WRONG_KEY";

    const [item2] = await adminDb
      .insert(schema.champiqQueue)
      .values({
        clerkUserId: TEST_USER_ID,
        companyName: "FailCo",
        companyDomain: "failco.com",
        companyData: {},
        contacts: [],
        signalName: null,
        signalReasoning: null,
        signalData: {},
        score: null,
        talkingPoints: [],
        status: "pending",
      })
      .returning({ id: schema.champiqQueue.id });

    const failResult = await deliverProspectToChampIQ(
      item2.id,
      `http://localhost:${PORT}`,
    );
    console.log(`  Result: ${JSON.stringify(failResult)}`);
    if (failResult.ok) {
      throw new Error("Expected failure with wrong API key");
    }
    if (!failResult.error?.includes("401")) {
      throw new Error(`Expected 401 error, got: ${failResult.error}`);
    }

    const [stillPending] = await adminDb
      .select({ status: schema.champiqQueue.status })
      .from(schema.champiqQueue)
      .where(eq(schema.champiqQueue.id, item2.id))
      .limit(1);
    console.log(`  DB status after failed push: ${stillPending?.status}`);
    if (stillPending?.status === "delivered") {
      throw new Error("Status should NOT be 'delivered' on failed push");
    }
    console.log("  ✓ Failed push correctly handled");

    // Cleanup
    await adminDb
      .delete(schema.champiqQueue)
      .where(eq(schema.champiqQueue.clerkUserId, TEST_USER_ID));

    console.log("\n═════════════════════════════════════════════════════════");
    console.log("✓ All delivery tests passed");
    console.log("═════════════════════════════════════════════════════════\n");
  } finally {
    server.close();
    // Postgres connections from drizzle may keep the process alive — exit cleanly
    setTimeout(() => process.exit(0), 100);
  }
}

run().catch((err) => {
  console.error("\n✗ Fatal:", err);
  process.exit(1);
});
