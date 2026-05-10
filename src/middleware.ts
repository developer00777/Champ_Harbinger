import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Public routes — no Clerk auth required.
 * Everything else is protected by default.
 */
const isPublicRoute = createRouteMatcher([
  "/",            // marketing landing page
  "/login(.*)",   // Clerk sign-in
  "/signup(.*)",  // Clerk sign-up
  "/ingest(.*)",  // PostHog proxy rewrites
  "/api/email/track(.*)", // email open/click tracking (public webhook)
]);

export default clerkMiddleware(async (auth, request) => {
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
