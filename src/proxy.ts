import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

import { isDevAuthBypass } from "@/lib/dev-auth";

/**
 * Public routes — no Clerk auth required.
 * Everything else is protected by default.
 */
const isPublicRoute = createRouteMatcher([
  "/", // marketing landing page
  "/login(.*)", // Clerk sign-in
  "/signup(.*)", // Clerk sign-up
  "/ingest(.*)", // PostHog proxy rewrites
  "/api/metrics", // Prometheus scraping (no browser session)
  "/api/v1/(.*)", // v1 external API — authenticated by chh_ API key, not Clerk session
  "/api/email/track(.*)", // email open/click tracking (public webhook)
  "/api/email/cleanup(.*)", // email cleanup webhooks
  "/api/tracking/(.*)", // tracking pixel/webhooks
  "/api/outreach/process(.*)", // outreach sequence processing (called by job scheduler)
  "/api/enrich-company(.*)", // bulk enrichment jobs (worker-secret or session authed in-route)
  "/api/rss/(.*)", // RSS monitor (authenticated by chh_ API key, not Clerk session)
  "/api/internal/worker-config", // worker config pull (x-worker-secret authed in-route, no Clerk session)
]);

/**
 * Clerk's publishable key is inlined into the bundle at BUILD time, so it must
 * be supplied as a Docker **build arg** — not just a runtime variable. When it
 * is missing, clerkMiddleware() throws on EVERY request while instantiating,
 * before the isPublicRoute() check below ever runs. That took down
 * `/api/metrics` too, so the only symptom was an opaque Railway "Healthcheck
 * failure" with the real cause buried in a wall of repeated stack traces.
 *
 * Detect it up front instead: keep the unauthenticated health/metrics endpoint
 * serving so the platform can report a healthy container, and fail every other
 * route closed with an explicit, greppable message.
 *
 * This is deliberately NOT a way to run without Clerk — every route that needs
 * a session returns 503 and no request is ever treated as authenticated.
 */
const HEALTH_PATHS = new Set(["/api/metrics"]);

function hasClerkPublishableKey(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

const MISCONFIG_MESSAGE =
  "Clerk is not configured: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing from " +
  "this build. It is inlined at build time — set it as a Docker BUILD ARG " +
  "(Railway: Settings -> Build -> Build Args) and redeploy. Setting it only as " +
  "a runtime variable bakes it as empty. See docs/DEPLOY-RAILWAY.md.";

const clerkProxy = clerkMiddleware(async (auth, request) => {
  // Local dev only (DEV_AUTH_BYPASS=1 and NODE_ENV !== production): skip the
  // session gate entirely so the app is reachable without a Clerk sign-in.
  if (isDevAuthBypass()) return;
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const proxy = ((request, event) => {
  if (!hasClerkPublishableKey() && !isDevAuthBypass()) {
    const { pathname } = new URL(request.url);
    // Let the healthcheck through so the failure is visible in logs/metrics
    // rather than as an unexplained container restart loop.
    if (HEALTH_PATHS.has(pathname)) {
      return undefined;
    }
    console.error(`[proxy] ${MISCONFIG_MESSAGE}`);
    return Response.json(
      { error: "Server auth is misconfigured", detail: MISCONFIG_MESSAGE },
      { status: 503 },
    );
  }
  return clerkProxy(request, event);
}) as typeof clerkProxy;

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
