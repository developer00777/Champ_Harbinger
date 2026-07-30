import { withAction } from "@/lib/services/cost-tracker";

import { describeUpstreamError } from "./upstream-error";

/**
 * Drop-in replacement for `withAction` in route handlers.
 *
 * `withAction` is an AsyncLocalStorage `.run()` — it establishes the cost
 * -tracking context but does NOT catch. Every route that ended in
 * `return withAction(...)` therefore leaked provider failures straight out of
 * the handler, and Next answered with a bodiless 500. Clients doing
 * `await res.json()` then died on "Unexpected end of JSON input", so a dead
 * OpenRouter key looked like a frontend bug.
 *
 * `runAction` keeps the same context behaviour and adds the missing boundary:
 * on a throw it logs server-side and returns a JSON error body the UI can
 * actually display. Swap `withAction(` → `runAction(` in a route handler; the
 * success path is unchanged.
 *
 * Only for handlers whose callback resolves to a Response. Services that need
 * the raw value should keep using `withAction` and handle errors themselves.
 */
export function runAction(
  label: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  return withAction(label, fn).catch((err: unknown) => {
    console.error(`[${label}] failed:`, err);
    const { status, body } = describeUpstreamError(err);
    return Response.json(body, { status });
  });
}
