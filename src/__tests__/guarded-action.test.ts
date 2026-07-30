import { describe, expect, it } from "vitest";

import { runAction } from "@/lib/api/guarded-action";

/**
 * runAction replaces withAction in route handlers. withAction only establishes
 * the AsyncLocalStorage cost-tracking context — it does not catch — so every
 * route ending in `return withAction(...)` used to leak provider failures as a
 * bodiless Next 500. These assert the boundary actually holds.
 */
describe("runAction", () => {
  it("passes a successful Response straight through", async () => {
    const res = await runAction("test: ok", async () =>
      Response.json({ companies: [] }, { status: 200 }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ companies: [] });
  });

  it("converts a thrown provider auth error into a readable JSON body", async () => {
    const err = new Error("User not found.");
    err.name = "UnauthorizedResponseError";
    Object.assign(err, { statusCode: 401 });

    const res = await runAction("test: bad key", async () => {
      throw err;
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/OpenRouter/i);
    expect(body.error).toMatch(/key/i);
  });

  it("never produces an empty body on an unknown throw", async () => {
    const res = await runAction("test: boom", async () => {
      throw new Error("socket hang up");
    });

    expect(res.status).toBe(500);
    // The regression was res.json() throwing on an empty body — must not now.
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/socket hang up/);
  });

  it("handles a non-Error throw without losing the response", async () => {
    const res = await runAction("test: weird", async () => {
      throw "just a string";
    });
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});
