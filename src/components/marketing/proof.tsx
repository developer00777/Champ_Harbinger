import { Boxes, Lock, Cpu } from "lucide-react";

const POINTS = [
  {
    icon: Boxes,
    title: "Backed by 12 Champions Group companies",
    body: "ChampHarbinger draws on the same data infrastructure that powers Lake B2B, Ampliz, and the wider Champions Group network.",
  },
  {
    icon: Cpu,
    title: "Your LLM, through OpenRouter",
    body: "Route to any model, any time. ChampHarbinger never locks you to a single provider or a fixed price.",
  },
  {
    icon: Lock,
    title: "Your data, your Postgres",
    body: "Bring your own database. No shared multi-tenant store, no data leaving infrastructure you control.",
  },
];

export function Proof() {
  return (
    <section id="proof" className="bg-background">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="bg-card shadow-card rounded-3xl border border-border p-8 sm:p-12">
          <div className="max-w-2xl">
            <p className="eyebrow text-champions-orange">Why it works</p>
            <h2 className="text-foreground mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Owned infrastructure, not another data reseller.
            </h2>
            <p className="text-muted-foreground mt-4 text-base leading-relaxed">
              The signals, the contacts, and the model are all under your
              control. That is what makes the outreach defensible.
            </p>
          </div>

          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {POINTS.map((p) => (
              <div key={p.title}>
                <span className="bg-peach text-peach-foreground flex h-11 w-11 items-center justify-center rounded-xl">
                  <p.icon className="h-5 w-5" />
                </span>
                <h3 className="text-foreground mt-4 text-base font-semibold">
                  {p.title}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
