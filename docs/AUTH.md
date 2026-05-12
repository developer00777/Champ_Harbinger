# ChampHarbinger — Auth Architecture

## Overview

Authentication is handled entirely by [Clerk](https://clerk.com). There are no custom session tables, JWTs, or cookies managed by the app — Clerk owns all of that.

## How it works end-to-end

### 1. Middleware (`src/proxy.ts`)

Every incoming request passes through Clerk middleware before it reaches any route handler or page. The middleware checks the Clerk session cookie and either:

- **Allows** the request through (public routes, listed explicitly)
- **Protects** the route — redirects unauthenticated users to `/login?redirect_url=<original>`

**Public routes (no auth required):**
| Route | Reason |
|---|---|
| `/` | Marketing landing page |
| `/login(.*)` | Clerk sign-in (catch-all for Clerk's internal sub-routes) |
| `/signup(.*)` | Clerk sign-up |
| `/ingest(.*)` | PostHog analytics proxy |
| `/api/metrics` | Prometheus scraping — no browser session |
| `/api/email/track(.*)` | Email open/click tracking webhooks |
| `/api/email/cleanup(.*)` | Email cleanup webhooks |
| `/api/outreach/process(.*)` | Background job queue (QStash-initiated, no user session) |

Everything else is protected by default.

### 2. Sign-in / sign-up flow

- **Sign-in page:** `src/app/(auth)/login/[[...rest]]/page.tsx` — renders Clerk's `<SignIn />` component
- **Sign-up page:** `src/app/(auth)/signup/[[...rest]]/page.tsx` — renders Clerk's `<SignUp />` component
- **After sign-in:** Clerk reads `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard` and redirects there
- **After sign-up:** Clerk reads `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard` and redirects there

### 3. The authenticated app shell

Once signed in, all `(app)` routes are served via `src/app/(app)/layout.tsx` which wraps content in `DashboardShell` — the sidebar + header + agent panel structure.

### 4. Reading the current user in server code

```ts
import { getCurrentUser } from "@/lib/auth";

// Throws if not authenticated:
const { userId, orgId } = await getCurrentUser();

// Returns null if not authenticated:
const user = await getCurrentUserOrNull();
```

`src/lib/auth.ts` wraps Clerk's `auth()` helper.

### 5. Why both "Get Started" and "Sign In" seem to go the same place

When you're **already signed in**, visiting `/login` or `/signup` triggers Clerk's automatic redirect to `/dashboard` — so both buttons appear to go the same place. This is correct behaviour. When signed out, they render distinct sign-in and sign-up forms.

The marketing header and hero detect auth state via `currentUser()` and show "Open dashboard →" instead when you're signed in.

### 6. Session lifetime

Managed entirely by Clerk. Sessions persist across browser restarts (Clerk's default). Signing out via Clerk's `<UserButton />` or `signOut()` clears the session.

## Environment variables

| Variable                                          | Required | Description                                |
| ------------------------------------------------- | -------- | ------------------------------------------ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`               | Yes      | Public key from Clerk dashboard → API Keys |
| `CLERK_SECRET_KEY`                                | Yes      | Secret key (server-side only)              |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`                   | Yes      | `/login`                                   |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`                   | Yes      | `/signup`                                  |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Yes      | `/dashboard`                               |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Yes      | `/dashboard`                               |

## Route groups

```
src/app/
├── (marketing)/   ← Public, no auth. MarketingHeader + MarketingFooter layout.
├── (auth)/        ← Public, no auth. Clerk sign-in/up forms only.
└── (app)/         ← Protected. DashboardShell layout. All real app pages live here.
```
