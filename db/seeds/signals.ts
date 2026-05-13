import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

const BUILTIN_SIGNALS: Array<{
  name: string;
  slug: string;
  description: string;
  category: string;
  executionType: string;
  config: Record<string, unknown>;
}> = [
  {
    name: "Hiring surge",
    slug: "hiring-surge",
    description:
      "Company is actively hiring for roles that signal growth or a new initiative",
    category: "hiring",
    executionType: "exa_search",
    config: {
      recipe: {
        query:
          "{company} site:linkedin.com/jobs OR site:greenhouse.io OR site:lever.co hiring",
        threshold: 3,
      },
      lookbackDays: 30,
      minJobPostings: 3,
    },
  },
  {
    name: "Recent funding",
    slug: "recent-funding",
    description: "Company raised a funding round in the last 90 days",
    category: "funding",
    executionType: "exa_search",
    config: {
      recipe: {
        query:
          "{company} funding round raised Series million investment 2024 2025 2026",
        threshold: 1,
      },
      lookbackDays: 90,
    },
  },
  {
    name: "Executive hire",
    slug: "executive-hire",
    description: "Company hired a new C-level or VP executive",
    category: "hiring",
    executionType: "exa_search",
    config: {
      recipe: {
        query:
          '{company} "joins as" OR "appointed" OR "named" CEO CTO CFO CMO VP Director',
        threshold: 1,
      },
      lookbackDays: 60,
    },
  },
  {
    name: "Product launch",
    slug: "product-launch",
    description: "Company launched a new product or major feature",
    category: "product",
    executionType: "exa_search",
    config: {
      recipe: {
        query:
          "{company} launches OR announces OR releases new product feature update 2024 2025 2026",
        threshold: 1,
      },
      lookbackDays: 30,
    },
  },
  {
    name: "Negative reviews spike",
    slug: "negative-reviews-spike",
    description:
      "Company has a spike in negative G2 or Capterra reviews suggesting dissatisfaction",
    category: "sentiment",
    executionType: "exa_search",
    config: {
      recipe: {
        query:
          "{company} site:g2.com OR site:capterra.com review disappointed OR problems OR switching",
        threshold: 2,
      },
      lookbackDays: 60,
      sentimentThreshold: -0.3,
    },
  },
  {
    name: "Job postings for your stack",
    slug: "job-postings-for-your-stack",
    description:
      "Company is hiring for specific technologies that signal openness to your solution",
    category: "hiring",
    executionType: "exa_search",
    config: {
      recipe: {
        query: "{company} hiring {stack} engineer developer",
        threshold: 1,
      },
      lookbackDays: 30,
      requiresConfig: ["stack"],
    },
  },
  {
    name: "Competitor mention",
    slug: "competitor-mention",
    description: "Company is publicly discussing or comparing competitors",
    category: "competitive",
    executionType: "exa_search",
    config: {
      recipe: {
        query:
          "{company} vs OR compared to OR switching from OR replacing {competitor}",
        threshold: 1,
      },
      lookbackDays: 60,
      requiresConfig: ["competitor"],
    },
  },
  {
    name: "Expansion signal",
    slug: "expansion-signal",
    description: "Company is expanding to new markets, regions, or verticals",
    category: "growth",
    executionType: "exa_search",
    config: {
      recipe: {
        query:
          "{company} expands OR enters OR launches in new market region country office",
        threshold: 1,
      },
      lookbackDays: 60,
    },
  },
];

export async function seedSignals() {
  for (const signal of BUILTIN_SIGNALS) {
    await adminDb
      .insert(schema.signals)
      .values({
        name: signal.name,
        slug: signal.slug,
        description: signal.description,
        category: signal.category,
        executionType: signal.executionType,
        config: signal.config,
        isBuiltin: true,
        isPublic: true,
        clerkUserId: null,
      })
      .onConflictDoNothing();
  }
  console.log(`Seeded ${BUILTIN_SIGNALS.length} built-in signals`);
}
