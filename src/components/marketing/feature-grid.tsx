const features = [
  {
    title: "Signals engine",
    body: "Continuous web monitoring for hiring changes, funding announcements, product launches, and review-sentiment shifts. Filter to the moves that matter.",
  },
  {
    title: "Contact enrichment",
    body: "Pull from the Champions Group database of 120M+ verified contacts and companies. AI-verified, deduplicated, and ready for outreach.",
  },
  {
    title: "Outreach drafting",
    body: "AI-drafted personalized messages grounded in the signal that surfaced the prospect. Edit, approve, and queue in one place.",
  },
  {
    title: "Sequences",
    body: "Multi-step email sequences with reply detection. Automated where it helps, manual where it matters.",
  },
  {
    title: "Browser automation",
    body: "Browserbase + Stagehand handle the long tail of web data. When the public API is missing, ChampHarbinger fetches it anyway.",
  },
  {
    title: "Own your data",
    body: "Bring your own Postgres. Bring your own LLM via OpenRouter: any model, any time. No vendor lock, no shared multi-tenant database.",
  },
];

export function FeatureGrid() {
  return (
    <section id="features" className="bg-white">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-3xl font-bold tracking-tight text-champions-ink sm:text-4xl">
          Built for sales teams that move first.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-champions-ink-soft">
          From signal to sent email in a single workspace. No stitching together
          five tools. ChampHarbinger handles the full pipeline.
        </p>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-champions-border bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h3 className="text-lg font-semibold text-champions-ink">
                <span className="mr-2 text-champions-orange">▸</span>
                {f.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-champions-ink-soft">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
