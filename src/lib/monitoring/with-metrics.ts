import {
  httpRequestsTotal,
  httpRequestDuration,
} from "@/lib/monitoring/metrics";

type RouteHandler<C> = (request: Request, ctx: C) => Promise<Response>;

/**
 * Wrap a Next.js route handler so each call records the HTTP request counter +
 * duration histogram (method, route, status). Adopt incrementally on Node-runtime
 * routes:
 *
 *   export const POST = withHttpMetrics("outreach/send-now", async (request) => { ... });
 *
 * Metrics never throw out of the wrapper; the handler's response is returned
 * (or its error re-thrown) unchanged.
 */
export function withHttpMetrics<C>(
  route: string,
  handler: RouteHandler<C>,
): RouteHandler<C> {
  return async (request, ctx) => {
    const start = Date.now();
    const method = request.method;
    let status = 500;
    try {
      const res = await handler(request, ctx);
      status = res.status;
      return res;
    } finally {
      try {
        httpRequestsTotal.labels(method, route, String(status)).inc();
        httpRequestDuration
          .labels(method, route)
          .observe((Date.now() - start) / 1000);
      } catch {
        // ignore metrics failures
      }
    }
  };
}
