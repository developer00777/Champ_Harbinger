import Link from "next/link";

export function Hero() {
  return (
    <section className="bg-peach-wash">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-champions-orange">
          A Champions Group product
        </p>
        <h1 className="mt-4 text-5xl font-bold tracking-tight text-champions-ink sm:text-6xl">
          Detect buying signals before they become deals.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-champions-ink-soft">
          ChampHarbinger watches the web for hiring shifts, funding rounds,
          product launches, and sentiment changes — then enriches contacts and
          drafts personalized outreach in a single chat-first workspace.
        </p>
        <p className="mt-3 text-sm font-medium text-champions-warm-gray">
          Powered by 12 Champions Group companies. 120M+ verified contacts.
          Your LLM, your data.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-md bg-champions-orange px-6 py-3 text-base font-semibold text-white transition hover:bg-champions-deep-orange"
          >
            Get started
          </Link>
          <Link
            href="#features"
            className="inline-flex items-center justify-center rounded-md border border-champions-orange bg-white px-6 py-3 text-base font-semibold text-champions-orange transition hover:bg-champions-soft-peach"
          >
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}
