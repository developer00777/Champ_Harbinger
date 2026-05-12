import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";

export async function MarketingHeader() {
  const user = await currentUser();

  return (
    <header className="sticky top-0 z-50 border-b border-champions-border bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        {/* Wordmark */}
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold text-champions-ink hover:opacity-80 transition-opacity"
          aria-label="ChampHarbinger home"
        >
          <span className="text-champions-orange">●</span>
          ChampHarbinger
        </Link>

        {/* Nav actions */}
        <nav className="flex items-center gap-4">
          {user ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-champions-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-champions-deep-orange"
            >
              Open dashboard →
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-medium text-champions-ink-soft hover:text-champions-orange transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-md bg-champions-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-champions-deep-orange"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
