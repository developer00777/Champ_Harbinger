import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression cover for: a user saves a working OpenRouter key under
 * Settings → Keys, the Agent chat starts working, and discovery keeps failing
 * with "OpenRouter rejected the API key".
 *
 * Cause: `getModelSync()` / `getClassificationModelSync()` cannot consult
 * `user_api_keys` — the lookup is async — so every sync call site silently
 * ignores BYOK and uses the server env key. `makePublicWebProvider()` took no
 * clerkUserId at all, so the id `getDiscoveryProvider()` already had was
 * dropped before it could matter.
 *
 * These are source-level assertions on purpose: the failure mode is a call
 * site quietly reverting to the sync helper, which a behavioural mock of the
 * provider would not notice.
 */

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("BYOK reaches the discovery path", () => {
  const provider = read("src/lib/discovery/public-web-provider.ts");
  const index = read("src/lib/discovery/index.ts");

  it("public-web-provider never uses the sync (env-only) model helpers", () => {
    expect(provider).not.toMatch(/getModelSync\s*\(/);
    expect(provider).not.toMatch(/getClassificationModelSync\s*\(/);
  });

  it("public-web-provider resolves the model per user", () => {
    expect(provider).toMatch(/getClassificationModel\(\s*clerkUserId\s*\)/);
  });

  it("makePublicWebProvider accepts a clerkUserId", () => {
    expect(provider).toMatch(
      /export function makePublicWebProvider\(\s*clerkUserId\?: string,?\s*\)/,
    );
  });

  it("getDiscoveryProvider forwards its clerkUserId to the public-web provider", () => {
    // Dropping the argument here is exactly what broke it before.
    expect(index).not.toMatch(/makePublicWebProvider\(\s*\)/);
    expect(index).toMatch(/makePublicWebProvider\(\s*clerkUserId\s*\)/);
  });
});

describe("the async classification helper is BYOK-aware", () => {
  const providerTs = read("src/lib/ai/provider.ts");

  it("exports an async getClassificationModel taking a clerkUserId", () => {
    expect(providerTs).toMatch(
      /export async function getClassificationModel\(\s*clerkUserId\?: string,?\s*\)/,
    );
  });

  it("delegates to getModel (which reads user_api_keys), not getModelSync", () => {
    const body = providerTs.slice(
      providerTs.indexOf("export async function getClassificationModel"),
    );
    const fn = body.slice(0, body.indexOf("\n}") + 2);
    expect(fn).toMatch(
      /getModel\(\s*Models\.classification,\s*clerkUserId\s*\)/,
    );
    expect(fn).not.toMatch(/getModelSync/);
  });
});
