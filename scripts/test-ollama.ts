/**
 * End-to-end test for the Ollama local-classifier integration.
 *
 * Exits 0 with a "skipped" message when OLLAMA_BASE_URL is unset (the default).
 * Otherwise: health-checks Ollama, confirms the configured model is pulled,
 * runs criteria translation through it, and asserts the expected fields.
 *
 * Run: OLLAMA_BASE_URL=http://localhost:11434 pnpm exec tsx scripts/test-ollama.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { createRequire } from "module";

// Stub `server-only` so the tsx runner doesn't throw — these modules are
// only called in a Node.js server context (same as the Next.js runtime).
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

// Load env before anything else
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const baseURL = process.env.OLLAMA_BASE_URL?.trim();
const modelId =
  process.env.OLLAMA_CLASSIFICATION_MODEL?.trim() || "llama3.1:8b";

if (!baseURL) {
  console.log(
    "\n⏭  OLLAMA_BASE_URL is unset — skipping Ollama integration test.\n" +
      "   (Classification falls back to OpenRouter when Ollama is not configured.)\n" +
      "   To enable: install Ollama, pull a model, set OLLAMA_BASE_URL=http://localhost:11434 and rerun.\n",
  );
  process.exit(0);
}

console.log(`\n🧪 Ollama integration test`);
console.log(`   OLLAMA_BASE_URL: ${baseURL}`);
console.log(`   model: ${modelId}\n`);

async function run() {
  // 1. Health check
  console.log("[1] Health-checking Ollama...");
  const tagsURL = `${baseURL!.replace(/\/+$/, "")}/api/tags`;
  let tagsRes: Response;
  try {
    tagsRes = await fetch(tagsURL);
  } catch (err) {
    console.error(
      `    ✗ Could not reach ${tagsURL}: ${err instanceof Error ? err.message : err}`,
    );
    console.error(
      "    → Is Ollama running? Try `docker compose up -d ollama` or `ollama serve`.",
    );
    process.exit(1);
  }
  if (!tagsRes.ok) {
    console.error(`    ✗ Ollama returned HTTP ${tagsRes.status} for /api/tags`);
    process.exit(1);
  }
  const tagsBody = (await tagsRes.json()) as {
    models?: Array<{ name?: string; model?: string }>;
  };
  const installed = (tagsBody.models ?? [])
    .map((m) => m.name ?? m.model ?? "")
    .filter(Boolean);
  console.log(
    `    ✓ Ollama is reachable. ${installed.length} model(s) installed.`,
  );
  if (installed.length > 0) {
    console.log(`      ${installed.join(", ")}`);
  }

  // 2. Confirm model is pulled
  console.log(`\n[2] Confirming "${modelId}" is pulled...`);
  const hasModel = installed.some(
    (n) => n === modelId || n.split(":")[0] === modelId.split(":")[0],
  );
  if (!hasModel) {
    console.error(
      `    ✗ Model "${modelId}" is not pulled.\n` +
        `    → Run: docker compose exec ollama ollama pull ${modelId}\n` +
        `      (or: ollama pull ${modelId} if running natively)`,
    );
    process.exit(1);
  }
  console.log(`    ✓ Model "${modelId}" is available.`);

  // 3. Run criteria translation
  console.log(
    "\n[3] Translating criteria through Ollama (via getClassificationModelSync)...",
  );
  const { translateCompanyCriteria } =
    await import("../src/lib/lakeb2b/criteria");

  const criteria =
    "SaaS companies in the US with 10-50 employees that raised seed funding";
  console.log(`    criteria: "${criteria}"`);

  const start = Date.now();
  const params = await translateCompanyCriteria(criteria);
  const elapsed = Date.now() - start;
  console.log(`    ✓ Got params in ${elapsed}ms:`);
  console.log(
    JSON.stringify(params, null, 2)
      .split("\n")
      .map((l) => "      " + l)
      .join("\n"),
  );

  // 4. Assert expected fields are present
  console.log("\n[4] Asserting expected fields are present...");
  const expectedFields: (keyof typeof params)[] = [
    "industry",
    "country",
    "employee_min",
    "employee_max",
    "funding_stage",
  ];
  const missing = expectedFields.filter(
    (f) => params[f] === undefined || params[f] === null,
  );
  if (missing.length > 0) {
    console.error(
      `    ✗ Missing expected fields: ${missing.join(", ")}\n` +
        "    → Local models are imperfect at edge-case criteria — this may be a\n" +
        "      prompt-engineering or model-size issue. Try a larger model.",
    );
    process.exit(1);
  }
  console.log(
    `    ✓ All expected fields present: ${expectedFields.join(", ")}`,
  );

  console.log(`\n${"═".repeat(60)}`);
  console.log("Ollama integration test passed.");
  console.log(`${"═".repeat(60)}\n`);
}

run().catch((err) => {
  console.error("\n✗ Fatal error:", err);
  process.exit(1);
});
