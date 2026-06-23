import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { currentUser } from "@clerk/nextjs/server";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#proof", label: "Why it works" },
];

export async function MarketingHeader() {
  const user = await currentUser();

  return (
    <header className="border-border/70 bg-background/80 sticky top-0 z-50 border-b backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        {/* Wordmark */}
        <Link
          href="/"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
          aria-label="ChampHarbinger home"
        >
          <span className="bg-champions-gradient flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm">
            CH
          </span>
          <span className="text-foreground text-lg font-bold tracking-tight">
            ChampHarbinger
          </span>
        </Link>

        {/* Center nav — anchors to on-page sections */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Auth actions */}
        <nav className="flex items-center gap-3">
          {user ? (
            <Link
              href="/dashboard"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition"
            >
              Open dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition"
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
