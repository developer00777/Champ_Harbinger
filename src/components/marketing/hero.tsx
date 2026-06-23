import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { currentUser } from "@clerk/nextjs/server";

const STATS = [
  { value: "12", label: "Champions companies" },
  { value: "120M+", label: "Verified contacts" },
  { value: "Yours", label: "LLM and data" },
];

const PROOF_POINTS = [
  "Watch the web for hiring, funding, and launch signals",
  "Enrich the right people inside every account",
  "Draft outreach grounded in the signal that surfaced them",
];

export async function Hero() {
  const user = await currentUser();

  return (
    <section className="bg-peach-wash relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Left — value */}
          <div>
            <p className="eyebrow text-champions-orange">
              A Champions Group product
            </p>
            <h1 className="text-foreground mt-4 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Detect buying signals before they become deals.
            </h1>
            <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed">
              ChampHarbinger watches the web for hiring shifts, funding rounds,
              product launches, and sentiment changes. It enriches contacts and
              drafts personalized outreach in a single chat-first workspace.
            </p>

            <ul className="mt-6 space-y-2.5">
              {PROOF_POINTS.map((point) => (
                <li
                  key={point}
                  className="text-foreground/80 flex items-start gap-2.5 text-sm"
                >
                  <span className="bg-peach text-peach-foreground mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
                    <Check className="h-3 w-3" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>

            <div className="mt-9 flex flex-wrap gap-3">
              {user ? (
                <Link
                  href="/dashboard"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-6 py-3 text-base font-semibold transition"
                >
                  Open dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-6 py-3 text-base font-semibold transition"
                  >
                    Get started
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="#how-it-works"
                    className="border-border bg-card text-foreground hover:bg-muted inline-flex items-center justify-center rounded-lg border px-6 py-3 text-base font-semibold transition"
                  >
                    See how it works
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Right — product preview panel (interpreted from wireframe) */}
          <HeroPreview />
        </div>

        {/* Stats strip */}
        <div className="border-border/70 mt-16 grid grid-cols-3 gap-4 border-t pt-8">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center sm:text-left">
              <div className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
                {stat.value}
              </div>
              <div className="text-muted-foreground mt-1 text-xs sm:text-sm">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// A static, presentational preview of the in-app Quick Start flow. No data,
// no links — it stands in for the wireframe's "product screenshot" panel using
// the same Aegis visual language as the live dashboard.
function HeroPreview() {
  const steps = ["Describe", "Companies", "Contacts", "Drafts"];
  return (
    <div className="shadow-pop bg-card border-border/80 rounded-2xl border p-5">
      {/* Window chrome */}
      <div className="border-border/70 -mx-5 -mt-5 mb-5 flex items-center gap-1.5 border-b px-5 py-3">
        <span className="bg-muted-foreground/25 h-2.5 w-2.5 rounded-full" />
        <span className="bg-muted-foreground/25 h-2.5 w-2.5 rounded-full" />
        <span className="bg-muted-foreground/25 h-2.5 w-2.5 rounded-full" />
        <span className="text-muted-foreground ml-3 font-mono text-[10px] tracking-wide">
          app.champharbinger.com/dashboard
        </span>
      </div>

      {/* Step rail */}
      <div className="flex items-center gap-1.5">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                i === 0
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span
              className={`font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${
                i === 0 ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span className="bg-border mx-0.5 h-px w-4" />
            )}
          </div>
        ))}
      </div>

      {/* Faux input card */}
      <div className="border-border bg-background mt-5 rounded-xl border p-4">
        <p className="eyebrow mb-2">Campaign context</p>
        <p className="text-foreground text-sm font-semibold">
          Who do you want to reach?
        </p>
        <div className="border-border bg-card text-muted-foreground mt-3 rounded-lg border px-3 py-2.5 text-sm">
          Fintech, Series A, EU
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["Dev tools, US, PLG", "Healthcare SaaS"].map((chip) => (
            <span
              key={chip}
              className="border-border text-muted-foreground rounded-full border px-2.5 py-1 text-[11px]"
            >
              {chip}
            </span>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold">
            Find companies
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>

      {/* Faux result rows */}
      <div className="mt-3 space-y-1.5">
        {["Northwind Labs", "Helios Analytics", "Atlas Robotics"].map(
          (name, i) => (
            <div
              key={name}
              className="border-border bg-background flex items-center justify-between rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-foreground truncate text-xs font-medium">
                  {name}
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                  Series A · {["EU", "US", "US"][i]}
                </p>
              </div>
              <span className="bg-peach text-peach-foreground rounded-md px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide">
                staged
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
