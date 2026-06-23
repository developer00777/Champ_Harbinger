import {
  Radar,
  Database,
  PenLine,
  ListOrdered,
  MousePointerClick,
  ShieldCheck,
  Eye,
  Sparkles,
  Send,
} from "lucide-react";

const features = [
  {
    icon: Radar,
    title: "Signals engine",
    body: "Continuous web monitoring for hiring changes, funding announcements, product launches, and review-sentiment shifts. Filter to the moves that matter.",
  },
  {
    icon: Database,
    title: "Contact enrichment",
    body: "Pull from the Champions Group database of 120M+ verified contacts and companies. AI-verified, deduplicated, and ready for outreach.",
  },
  {
    icon: PenLine,
    title: "Outreach drafting",
    body: "AI-drafted personalized messages grounded in the signal that surfaced the prospect. Edit, approve, and queue in one place.",
  },
  {
    icon: ListOrdered,
    title: "Sequences",
    body: "Multi-step email sequences with reply detection. Automated where it helps, manual where it matters.",
  },
  {
    icon: MousePointerClick,
    title: "Browser automation",
    body: "Browserbase and Stagehand handle the long tail of web data. When the public API is missing, ChampHarbinger fetches it anyway.",
  },
  {
    icon: ShieldCheck,
    title: "Own your data",
    body: "Bring your own Postgres. Bring your own LLM via OpenRouter: any model, any time. No vendor lock, no shared multi-tenant database.",
  },
];

const steps = [
  {
    icon: Eye,
    step: "01",
    title: "Watch",
    body: "ChampHarbinger tracks the web for the signals that mean a buyer is in motion.",
  },
  {
    icon: Sparkles,
    step: "02",
    title: "Enrich",
    body: "It finds the right companies and the right people inside them, verified and deduped.",
  },
  {
    icon: Send,
    step: "03",
    title: "Draft",
    body: "It writes outreach grounded in the signal. You review, edit, and send.",
  },
];

export function FeatureGrid() {
  return (
    <>
      {/* How it works — 3 steps */}
      <section id="how-it-works" className="bg-background">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="eyebrow text-champions-orange">How it works</p>
          <h2 className="text-foreground mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            From signal to sent email in one workspace.
          </h2>
          <p className="text-muted-foreground mt-4 max-w-2xl text-base leading-relaxed">
            No stitching together five tools. ChampHarbinger handles the full
            pipeline, start to finish.
          </p>

          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {steps.map((s) => (
              <div
                key={s.title}
                className="bg-card shadow-card rounded-2xl border border-border p-6"
              >
                <div className="flex items-center justify-between">
                  <span className="bg-peach text-peach-foreground flex h-11 w-11 items-center justify-center rounded-xl">
                    <s.icon className="h-5 w-5" />
                  </span>
                  <span className="text-muted-foreground/60 font-mono text-sm font-semibold">
                    {s.step}
                  </span>
                </div>
                <h3 className="text-foreground mt-5 text-lg font-semibold">
                  {s.title}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section id="features" className="bg-peach-wash">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="eyebrow text-champions-orange">Capabilities</p>
          <h2 className="text-foreground mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Built for teams that move first.
          </h2>
          <p className="text-muted-foreground mt-4 max-w-2xl text-base leading-relaxed">
            Everything from the first signal to the sent message, in a single
            chat-first workspace.
          </p>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-card shadow-card hover:shadow-pop rounded-2xl border border-border p-6 transition-shadow"
              >
                <span className="bg-peach text-peach-foreground flex h-11 w-11 items-center justify-center rounded-xl">
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="text-foreground mt-5 text-lg font-semibold">
                  {f.title}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
