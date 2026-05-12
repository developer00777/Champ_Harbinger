"use client";

import { useEffect, useState } from "react";

export type ChampIQStatus =
  | "loading"
  | "unconfigured"
  | "connected"
  | "disconnected";

/**
 * Returns the live connection status between ChampHarbinger and ChampIQ.
 * Checks the saved ChampIQ URL, then pings the health-check endpoint.
 */
export function useChampIQStatus(): ChampIQStatus {
  const [status, setStatus] = useState<ChampIQStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/champiq/settings");
        if (!res.ok || cancelled) return;
        const data: { champiq_url: string | null } = await res.json();

        if (!data.champiq_url) {
          if (!cancelled) setStatus("unconfigured");
          return;
        }

        const hc = await fetch("/api/champiq/health-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: data.champiq_url }),
        });
        if (cancelled) return;
        const hcData: { ok: boolean } = await hc.json();
        setStatus(hcData.ok ? "connected" : "disconnected");
      } catch {
        if (!cancelled) setStatus("unconfigured");
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
