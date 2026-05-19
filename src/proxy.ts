import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
  "/api/rss/(.*)", // RSS monitor (authenticated by chh_ API key, not Clerk session)
]);

export const proxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
