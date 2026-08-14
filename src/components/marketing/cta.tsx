import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { currentUser } from "@clerk/nextjs/server";

import { devCurrentUser, isDevAuthBypass } from "@/lib/dev-auth";

export async function CTA() {
  const user = isDevAuthBypass() ? devCurrentUser() : await currentUser();

  return (
    <section className="bg-background">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="bg-champions-gradient shadow-pop relative overflow-hidden rounded-3xl px-8 py-16 text-center sm:px-16">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white/80">
            Get started
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl">
            The signals are already there. Find them first.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/90">
            ChampHarbinger surfaces buying intent before your competitors
            notice. 12 companies, 120M+ contacts, one platform.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            {user ? (
              <Link
                href="/dashboard"
                className="text-champions-orange inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold transition hover:bg-white/90"
              >
                Open dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <>
                <Link
                  href="/signup"
                  className="text-champions-orange inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold transition hover:bg-white/90"
                >
                  Start now, it&apos;s free
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-lg border border-white/50 bg-transparent px-6 py-3 text-base font-semibold text-white transition hover:bg-white/10"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
          <p className="mt-6 text-sm text-white/70">
            No credit card required. Deploy to your own infrastructure.
          </p>
        </div>
      </div>
    </section>
  );
}
