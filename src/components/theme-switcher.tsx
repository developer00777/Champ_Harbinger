"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const noop = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

const PILL_CLASS =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Light/dark toggle pill for the top bar (Aegis design). The label shows the
 * current theme; the icon previews the target. Falls back to a stable
 * pre-mount render to avoid hydration mismatch (theme is client-only).
 */
export function ThemeSwitcher() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, getTrue, getFalse);

  const isDark = resolvedTheme === "dark";

  if (!mounted) {
    return (
      <button type="button" className={PILL_CLASS} aria-label="Toggle theme">
        <span className="flex text-primary">
          <Moon className="h-[15px] w-[15px]" />
        </span>
        Theme
      </button>
    );
  }

  return (
    <button
      type="button"
      className={PILL_CLASS}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <span className="flex text-primary">
        {isDark ? (
          <Sun className="h-[15px] w-[15px]" />
        ) : (
          <Moon className="h-[15px] w-[15px]" />
        )}
      </span>
      {isDark ? "Dark" : "Light"}
    </button>
  );
}
