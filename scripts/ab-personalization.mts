/**
 * A/B eval for the personalization (cold-email) harness.
 *
 *   claude-sonnet-4  (quality reference)  vs  deepseek-v4-flash  (prod target)
 *
 * Reuses the REAL production prompts/schema from src/lib/email-composition/skill.ts,
 * so any prompt tuning here transfers straight to production. A blind judge
 * (sonnet-4) scores both emails per contact on specificity / relevance / tone /
 * CTA / format (1-5). Run repeatedly while tuning skill.ts until DeepSeek ≈ Sonnet.
 *
 *   pnpm exec tsx scripts/ab-personalization.mts
 */
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

import { z } from "zod";

// Loaded dynamically in main() so tsx resolves the @/ alias at runtime.
let skill: typeof import("@/lib/email-composition/skill");

const SONNET = "anthropic/claude-sonnet-4";
const DEEPSEEK = "deepseek/deepseek-v4-flash";
const JUDGE = "anthropic/claude-sonnet-4";

// Shared campaign + sender across all contacts.
const campaign = {
  name: "ChampHarbinger GTM outbound",
  icp: { roles: ["Growth", "RevOps", "Marketing", "Founder", "Sales"] },
  offering: {
    product: "ChampHarbinger",
    what: "a B2B prospecting + personalized-outreach platform: find verified contacts at target accounts, enrich them, and send research-backed outreach that books meetings.",
    proof: "teams replace 3-4 point tools and book ~30% more meetings from the same list.",
  },
  positioning: {
    wedge: "personalization at scale without a 5-tool stack",
  },
};
const sender = {
  name: "Deep",
  title: "Founder",
  company: "Champions Group",
  signature: "Deep",
};
const step = { stepNumber: 1, totalSteps: 4, condition: "initial", isFinal: false };

/**
 * OpenRouter chat-completions via `curl` (node fetch can't reach OpenRouter
 * from this machine; curl can) + tolerant JSON parse.
 */
async function genJSON<T>(
  modelId: string,
  system: string,
  prompt: string,
): Promise<T> {
  const body = JSON.stringify({
    model: modelId,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    max_tokens: 1300,
    temperature: 0.7,
  });
  const { stdout } = await execFileP(
    "curl",
    [
      "-s",
      "--max-time",
      "150",
      "https://openrouter.ai/api/v1/chat/completions",
      "-H",
      `Authorization: Bearer ${process.env.OPENROUTER_API_KEY}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      body,
    ],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (data.error) throw new Error(`${modelId}: ${data.error.message}`);
  let t = (data.choices?.[0]?.message?.content ?? "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const i = t.indexOf("{");
    const j = t.lastIndexOf("}");
    if (i >= 0 && j > i) t = t.slice(i, j + 1);
  }
  return JSON.parse(t) as T;
}

// 8 realistic contacts with a research hook in enrichmentData (what the model
// should anchor the opener on). #8 deliberately has a weak hook (tests the
// "no specific hook → anchor on title/company, don't invent" rule).
type Sample = {
  id: string;
  contact: {
    name: string | null;
    title: string | null;
    email: string;
    enrichmentData: Record<string, unknown> | null;
  };
  company: {
    name: string | null;
    domain: string | null;
    industry: string | null;
    enrichmentData: Record<string, unknown> | null;
  };
  triggerReason?: string | null;
};

const SAMPLES: Sample[] = [
  {
    id: "fintech-growth",
    contact: {
      name: "Priya Nair",
      title: "Head of Growth",
      email: "priya@nektar.example",
      enrichmentData: {
        linkedin_recent_post:
          "We just hit 100k users but our outbound is still 100% manual. Hiring is not the answer; process is.",
        seniority: "head",
      },
    },
    company: {
      name: "Nektar",
      domain: "nektar.example",
      industry: "Fintech (consumer payments)",
      enrichmentData: { news: "Series B $40M led by Index, March", headcount: 120 },
    },
    triggerReason: "Posted publicly that outbound is 100% manual at 100k users.",
  },
  {
    id: "dtc-cmo",
    contact: {
      name: "Marcus Bell",
      title: "CMO",
      email: "marcus@oatly-ish.example",
      enrichmentData: {
        company_news: "Launched a new ready-to-drink line in Target last week.",
      },
    },
    company: {
      name: "Grovewell",
      domain: "grovewell.example",
      industry: "DTC food & beverage",
      enrichmentData: { retail: "Newly in Target nationwide" },
    },
    triggerReason: "Company just launched a new product line in Target.",
  },
  {
    id: "saas-revops",
    contact: {
      name: "Dana Wu",
      title: "Director of RevOps",
      email: "dana@logiflow.example",
      enrichmentData: {
        linkedin_recent_post:
          "Migrating off our old CRM this quarter. The data hygiene debt is real.",
      },
    },
    company: {
      name: "LogiFlow",
      domain: "logiflow.example",
      industry: "Logistics SaaS",
      enrichmentData: { headcount: 300 },
    },
    triggerReason: "Mentioned a CRM migration + data hygiene debt this quarter.",
  },
  {
    id: "ai-founder",
    contact: {
      name: "Sam Okafor",
      title: "Co-founder & CEO",
      email: "sam@vectorize.example",
      enrichmentData: {
        funding: "Just announced a $12M Series A.",
        hiring: "Posted their first AE role yesterday.",
      },
    },
    company: {
      name: "Vectorize",
      domain: "vectorize.example",
      industry: "AI developer tools",
      enrichmentData: { stage: "Series A" },
    },
    triggerReason: "Raised a $12M Series A and just opened their first sales hire.",
  },
  {
    id: "health-marketing",
    contact: {
      name: "Lena Park",
      title: "VP Marketing",
      email: "lena@carebridge.example",
      enrichmentData: {
        company_news: "Achieved HIPAA + SOC2; pushing into enterprise health systems.",
      },
    },
    company: {
      name: "CareBridge",
      domain: "carebridge.example",
      industry: "Healthcare SaaS",
      enrichmentData: { motion: "Moving upmarket to enterprise" },
    },
    triggerReason: "Moving upmarket to enterprise health systems after HIPAA/SOC2.",
  },
  {
    id: "agency-owner",
    contact: {
      name: "Tariq Hassan",
      title: "Founder",
      email: "tariq@northbeam-ish.example",
      enrichmentData: {
        linkedin_recent_post:
          "Our agency lives and dies by pipeline. Q3 referrals dried up; need a real outbound motion.",
      },
    },
    company: {
      name: "Northshore Collective",
      domain: "northshore.example",
      industry: "Marketing agency",
      enrichmentData: { headcount: 25 },
    },
    triggerReason: "Said referrals dried up and they need a real outbound motion.",
  },
  {
    id: "ecommerce-sales",
    contact: {
      name: "Bianca Rossi",
      title: "Head of Sales",
      email: "bianca@shopgrid.example",
      enrichmentData: {
        linkedin_recent_post:
          "Scaling the SDR team from 3 to 10. The hard part is giving them good accounts to work.",
      },
    },
    company: {
      name: "ShopGrid",
      domain: "shopgrid.example",
      industry: "E-commerce infrastructure",
      enrichmentData: { headcount: 180 },
    },
    triggerReason: "Tripling the SDR team; bottleneck is good accounts to work.",
  },
  {
    id: "weak-hook",
    contact: {
      name: "Owen Pierce",
      title: "VP Sales",
      email: "owen@meridian-mfg.example",
      enrichmentData: null, // deliberately no hook
    },
    company: {
      name: "Meridian Manufacturing",
      domain: "meridian-mfg.example",
      industry: "Industrial manufacturing",
      enrichmentData: null,
    },
    triggerReason: null,
  },
];

type Email = {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  aiReasoning: string;
};

async function compose(modelId: string, s: Sample): Promise<Email> {
  return genJSON<Email>(
    modelId,
    skill.buildEmailSystemPrompt([]),
    skill.buildComposeUserPrompt({
      contact: s.contact,
      company: s.company,
      step,
      campaign,
      senderProfile: sender,
      triggerReason: s.triggerReason,
    }),
  );
}

const Score = z.object({
  specificity: z.number().min(1).max(5),
  relevance: z.number().min(1).max(5),
  tone: z.number().min(1).max(5),
  cta: z.number().min(1).max(5),
  format: z.number().min(1).max(5),
});
const JudgeSchema = z.object({
  a: Score,
  b: Score,
  winner: z.enum(["A", "B", "tie"]),
  rationale: z.string(),
});

async function judge(
  s: Sample,
  emailA: { subject: string; bodyText: string },
  emailB: { subject: string; bodyText: string },
): Promise<z.infer<typeof JudgeSchema>> {
  const system = `You are a strict, fair evaluator of B2B cold outreach emails. Score each email 1-5 on:
- specificity: opens with a concrete, real detail about THIS person/company (the hook). Generic = 1, sharp = 5. Penalize invented facts.
- relevance: ties the offering to the prospect's actual context, not generic features.
- tone: human, concise, no buzzwords/fluff/AI-isms. 3-5 sentences.
- cta: exactly one clear, low-friction ask.
- format: subject is concrete + under ~60 chars; body is short and clean.
Be discriminating — do not give everything 4-5. Pick the better email as winner (or "tie" only if genuinely indistinguishable). You do NOT know which model wrote which.`;
  const prompt = `PROSPECT CONTEXT:\n- ${s.contact.name}, ${s.contact.title} at ${s.company.name} (${s.company.industry})\n- Known hook: ${s.triggerReason ?? "(none — should anchor on role/company, not invent)"}\n\nOFFERING: ${campaign.offering.what}\n\n=== EMAIL A ===\nSubject: ${emailA.subject}\n${emailA.bodyText}\n\n=== EMAIL B ===\nSubject: ${emailB.subject}\n${emailB.bodyText}\n\nReturn ONLY this JSON (no prose, no fences):\n{"a":{"specificity":N,"relevance":N,"tone":N,"cta":N,"format":N},"b":{"specificity":N,"relevance":N,"tone":N,"cta":N,"format":N},"winner":"A"|"B"|"tie","rationale":"one sentence"}`;
  return JudgeSchema.parse(await genJSON(JUDGE, system, prompt));
}

function avg(ns: number[]) {
  return ns.reduce((a, b) => a + b, 0) / (ns.length || 1);
}
function total(sc: z.infer<typeof Score>) {
  return sc.specificity + sc.relevance + sc.tone + sc.cta + sc.format;
}

async function main() {
  skill = await import("@/lib/email-composition/skill");
  console.log(`A/B: ${SONNET}  vs  ${DEEPSEEK}   (judge: ${JUDGE})\n`);
  const rows: Array<{
    id: string;
    sonnet: z.infer<typeof Score>;
    deepseek: z.infer<typeof Score>;
    winner: "sonnet" | "deepseek" | "tie";
    sonnetEmail: { subject: string; bodyText: string };
    deepseekEmail: { subject: string; bodyText: string };
    rationale: string;
  }> = [];

  for (const s of SAMPLES) {
    const [sEmail, dEmail] = await Promise.all([
      compose(SONNET, s),
      compose(DEEPSEEK, s),
    ]);
    // Randomize A/B so the judge can't position-bias toward one slot.
    const sonnetIsA = Math.random() < 0.5;
    const A = sonnetIsA ? sEmail : dEmail;
    const B = sonnetIsA ? dEmail : sEmail;
    const j = await judge(s, A, B);
    const sonnet = sonnetIsA ? j.a : j.b;
    const deepseek = sonnetIsA ? j.b : j.a;
    const winner =
      j.winner === "tie"
        ? "tie"
        : (j.winner === "A") === sonnetIsA
          ? "sonnet"
          : "deepseek";
    rows.push({
      id: s.id,
      sonnet,
      deepseek,
      winner,
      sonnetEmail: sEmail,
      deepseekEmail: dEmail,
      rationale: j.rationale,
    });
    console.log(
      `${s.id.padEnd(18)} sonnet=${total(sonnet)}/25  deepseek=${total(deepseek)}/25  winner=${winner}`,
    );
  }

  const dims = ["specificity", "relevance", "tone", "cta", "format"] as const;
  console.log("\n=== AGGREGATE (avg per dimension, /5) ===");
  for (const d of dims) {
    console.log(
      `${d.padEnd(12)} sonnet=${avg(rows.map((r) => r.sonnet[d])).toFixed(2)}  deepseek=${avg(rows.map((r) => r.deepseek[d])).toFixed(2)}`,
    );
  }
  console.log(
    `${"TOTAL".padEnd(12)} sonnet=${avg(rows.map((r) => total(r.sonnet))).toFixed(2)}/25  deepseek=${avg(rows.map((r) => total(r.deepseek))).toFixed(2)}/25`,
  );
  const wins = rows.reduce(
    (a, r) => ((a[r.winner] = (a[r.winner] || 0) + 1), a),
    {} as Record<string, number>,
  );
  console.log(
    `wins: sonnet=${wins.sonnet || 0}  deepseek=${wins.deepseek || 0}  tie=${wins.tie || 0}`,
  );

  // Dump full emails for spot-check.
  console.log("\n=== SAMPLES (for spot-check) ===");
  for (const r of rows) {
    console.log(`\n----- ${r.id} (winner: ${r.winner}) -----`);
    console.log(`judge: ${r.rationale}`);
    console.log(`\n[SONNET ${total(r.sonnet)}/25] ${r.sonnetEmail.subject}\n${r.sonnetEmail.bodyText}`);
    console.log(`\n[DEEPSEEK ${total(r.deepseek)}/25] ${r.deepseekEmail.subject}\n${r.deepseekEmail.bodyText}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
