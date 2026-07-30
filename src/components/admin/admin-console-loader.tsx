"use client";

import { useEffect, useState } from "react";

import { AdminConsole } from "@/components/admin/admin-console";
import type { AdminOverview } from "@/lib/admin/overview";

/**
 * Client-side loader for the admin console.
 *
 * `(app)/admin/page.tsx` used to call `buildAdminOverview()` directly during
 * render, which was one of only two database calls left in the render path and
 * therefore a blocker for deploying the frontend without DATABASE_URL. The
 * data now comes from GET /api/admin/overview — the route already existed and
 * returns exactly `buildAdminOverview()`'s value, so this is a straight swap of
 * transport, not of behaviour.
 *
 * Authorisation is unchanged and still enforced server-side twice: the page
 * calls `requireSuperAdmin()` before rendering this, and the API route guards
 * itself. Nothing here is trusted as a gate.
 */
export function AdminConsoleLoader() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const res = await fetch("/api/admin/overview");
        // Read text first: an error response may be empty or non-JSON, and
        // res.json() would then throw an opaque parse error instead of the
        // real reason. Same lesson as lib/api/read-json.ts.
        const text = await res.text();
        if (!res.ok) {
          let message = `Request failed with ${res.status}.`;
          try {
            const parsed = JSON.parse(text) as { error?: string };
            if (parsed?.error) message = parsed.error;
          } catch {
            if (text.trim()) message = text.trim().slice(0, 200);
          }
          throw new Error(message);
        }
        if (active) setOverview(JSON.parse(text) as AdminOverview);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Could not load admin data.",
          );
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="text-destructive p-6 text-sm" role="alert">
        {error}
      </div>
    );
  }

  if (!overview) {
    return <div className="text-muted-foreground p-6 text-sm">Loading…</div>;
  }

  return <AdminConsole initial={overview} />;
}
