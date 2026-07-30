"use client";

import { useEffect, useRef } from "react";

/**
 * Fires the idempotent first-login provisioning call once per mount.
 *
 * Replaces the `ensureProvisioned()` call that used to run inside
 * `(app)/layout.tsx` on every authed page render — the only database access in
 * the render path, and the reason the Vercel frontend needed DATABASE_URL.
 * Doing it from the client means the work happens on whichever origin serves
 * /api, so the frontend stays database-free.
 *
 * Renders nothing. Failures are intentionally silent: provisioning is
 * best-effort (it only links a pending team invite), and a user must never see
 * an error because a background link-up did not happen.
 */
export function ProvisionOnMount() {
  const fired = useRef(false);

  useEffect(() => {
    // React 18/19 StrictMode double-invokes effects in dev; the ref keeps this
    // to one request. The route is idempotent regardless.
    if (fired.current) return;
    fired.current = true;

    void fetch("/api/me/provision", { method: "POST" }).catch(() => {
      // best-effort — see docblock
    });
  }, []);

  return null;
}
