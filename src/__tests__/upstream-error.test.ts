import { describe, expect, it } from "vitest";

import { describeUpstreamError } from "@/lib/api/upstream-error";

/**
 * Regression cover for the Quick Start "Unexpected end of JSON input" failure.
 *
 * The discovery routes wrap their work in `withAction()`, which is only an
 * AsyncLocalStorage `.run()` — it does not catch. A rejected OpenRouter key
 * therefore threw straight out of the route handler, Next returned a 500 with
 * no body, and the client's `res.json()` blew up with a DOMException instead of
 * showing the user why. Every branch here must produce a JSON-serialisable
 * body with a non-empty `error` string so that can never happen again.
 */

/** Shape of the error @ai-sdk/provider-utils throws on a 401 from OpenRouter. */
function openRouterError(message: string, code: number, name: string) {
  const err = new Error(message);
  err.name = name;
  Object.assign(err, {
    statusCode: code,
    body: JSON.stringify({ error: { message, code } }),
  });
  return err;
}

describe("describeUpstreamError", () => {
  it("maps a rejected OpenRouter key to an actionable message", () => {
    const out = describeUpstreamError(
      openRouterError("User not found.", 401, "UnauthorizedResponseError"),
    );

    expect(out.status).toBe(502);
    expect(out.body.error).toMatch(/openrouter/i);
    expect(out.body.error).toMatch(/key/i);
    // Must tell the user where to fix it — BYOK lives in Settings → Keys.
    expect(out.body.error).toMatch(/settings/i);
  });

  it("treats a 403 from the provider as a key problem too", () => {
    const out = describeUpstreamError(
      openRouterError("Forbidden", 403, "UnauthorizedResponseError"),
    );
    expect(out.status).toBe(502);
    expect(out.body.error).toMatch(/key/i);
  });

  it("calls out exhausted credits separately from a bad key", () => {
    const out = describeUpstreamError(
      openRouterError(
        "Insufficient credits",
        402,
        "InsufficientCreditsResponseError",
      ),
    );

    expect(out.status).toBe(502);
    expect(out.body.error).toMatch(/credit/i);
    expect(out.body.error).not.toMatch(/settings/i);
  });

  it("falls back to a 500 with the message for unknown failures", () => {
    const out = describeUpstreamError(new Error("socket hang up"));
    expect(out.status).toBe(500);
    expect(out.body.error).toMatch(/socket hang up/);
  });

  it("never yields an empty error, even for non-Error throws", () => {
    for (const thrown of [undefined, null, "", 0, {}, []]) {
      const out = describeUpstreamError(thrown);
      expect(typeof out.body.error).toBe("string");
      expect(out.body.error.length).toBeGreaterThan(0);
      // The whole point: the body must survive JSON.stringify for res.json().
      expect(() => JSON.stringify(out.body)).not.toThrow();
    }
  });
});
