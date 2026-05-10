import Link from "next/link";

export function CTA() {
  return (
    <section className="bg-champions-gradient">
      <div className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          The signals are already there. Find them first.
        </h2>
        <p className="mt-4 text-lg text-white/90">
          ChampHarbinger surfaces buying intent before your competitors notice.
          12 companies. 120M+ contacts. One platform.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-md bg-white px-6 py-3 text-base font-semibold text-champions-orange transition hover:bg-champions-soft-peach"
          >
            Start now — it&apos;s free
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md border border-white/50 bg-transparent px-6 py-3 text-base font-semibold text-white transition hover:bg-white/10"
          >
            Sign in
          </Link>
        </div>
        <p className="mt-6 text-sm text-white/70">
          No credit card required. Deploy to your own infrastructure.
        </p>
      </div>
    </section>
  );
}
