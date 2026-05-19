/**
 * Integration registry — single source of truth for every external service
 * Signal can talk to. Each entry describes the env vars that configure it,
 * how critical it is (required vs optional), and what the user sees if it's
 * missing (banner copy, settings-panel description, signup link).
 *
 * Adding a new integration:
 *   1. Append an entry to `INTEGRATIONS` below.
 *   2. The status API (/api/integrations/status), missing-key banner, and
 *      settings panel all pick it up automatically — no further wiring.
 */

export type IntegrationCategory =
  | "auth" // sign-in / identity
  | "data" // database / storage
  | "ai" // LLM access
  | "scraping" // browser automation
  | "email" // outbound + tracking
  | "scheduling" // background jobs
  | "enrichment"; // company / person data providers

export type IntegrationSeverity =
  | "required" // app is broken without this — surface as banner
  | "optional"; // a specific feature is gated — surface in settings panel

export interface Integration {
  /** Stable id used by the API + components. */
  id: string;
  /** Display name (e.g. "Anthropic", "Browserbase"). */
  name: string;
  /** Grouping in the settings panel. */
  category: IntegrationCategory;
  /** Banner vs settings-panel-only treatment. */
  severity: IntegrationSeverity;
  /** Short user-facing description: "Chat & enrichment", "Outbound email". */
  feature: string;
  /** What breaks if this is missing — used in banner copy + panel tooltip. */
  consequence: string;
  /**
   * Env vars that must ALL be set for this integration to be configured.
   * If any one is empty, the integration is reported as "not configured".
   */
  envVars: string[];
  /**
   * Optional NEXT_PUBLIC_ env var for client-side detection (used by the
   * banner without a server round-trip). When omitted, the banner relies on
   * the /api/integrations/status fetch.
   */
  publicEnvVar?: string;
  /** Where to sign up / get keys. */
  signupUrl?: string;
  /** Where the user finds the keys once signed up. */
  keysUrl?: string;
  /** Suggested fix command — usually "pnpm setup" or "Add X to .env.local". */
  fixHint?: string;
  /**
   * The key name used in the BYOK (Bring Your Own Key) settings table.
   * When set, the integration appears in the API Keys settings tab.
   * System-level integrations (Clerk, Postgres) omit this field.
   */
  keyName?: string;
}

export const INTEGRATIONS: Integration[] = [
  // ─── REQUIRED ────────────────────────────────────────────────────────────
  {
    id: "clerk",
    name: "Clerk",
    category: "auth",
    severity: "required",
    feature: "Sign-in and user identity",
    consequence:
      "Authentication is broken. Users cannot sign in and all protected routes are inaccessible.",
    envVars: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"],
    publicEnvVar: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    signupUrl: "https://clerk.com",
    keysUrl: "https://dashboard.clerk.com → API Keys",
    fixHint:
      "Paste NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY into .env.local",
  },
  {
    id: "postgres",
    name: "Postgres",
    category: "data",
    severity: "required",
    feature: "Database (all reads and writes)",
    consequence:
      "The app cannot read or write any data. Every page will be empty.",
    envVars: ["DATABASE_URL"],
    fixHint:
      "Set DATABASE_URL=postgres://user:pass@host:5432/champ_harbinger in .env.local",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    category: "ai",
    severity: "required",
    feature:
      "Chat, enrichment, email drafts (routes to any LLM via OpenRouter)",
    consequence:
      "Every chat request will fail with a 500. The agent and email composer are non-functional.",
    envVars: ["OPENROUTER_API_KEY"],
    signupUrl: "https://openrouter.ai",
    keysUrl: "https://openrouter.ai/keys",
    fixHint: "Add `OPENROUTER_API_KEY=sk-or-...` to .env.local",
    keyName: "openrouter_api_key",
  },

  // ─── OPTIONAL ────────────────────────────────────────────────────────────
  {
    id: "anthropic_admin",
    name: "Anthropic Admin",
    category: "ai",
    severity: "optional",
    feature: "Cost tracking dashboard",
    consequence:
      "Cost reports fall back to local estimates instead of billed totals.",
    envVars: ["ANTHROPIC_ADMIN_KEY"],
    signupUrl: "https://console.anthropic.com",
    keysUrl: "https://console.anthropic.com/settings/admin-keys",
    fixHint: "Add `ANTHROPIC_ADMIN_KEY=sk-ant-admin...` to .env.local",
    keyName: "anthropic_admin_key",
  },
  {
    id: "ollama",
    name: "Ollama",
    category: "ai",
    severity: "optional",
    feature:
      "Self-hosted local LLM for high-volume classification (criteria translation, signal verification)",
    consequence:
      "Classification falls back to the OpenRouter classification model (anthropic/claude-haiku-4.5). The app still works — you just pay per call instead of running a free local model.",
    envVars: ["OLLAMA_BASE_URL"],
    signupUrl: "https://ollama.com",
    fixHint:
      "Run `docker compose up -d ollama && docker compose exec ollama ollama pull llama3.1:8b`, then set OLLAMA_BASE_URL=http://localhost:11434 in .env.local",
  },
  {
    id: "browserbase",
    name: "Browserbase",
    category: "scraping",
    severity: "optional",
    feature: "Web scraping, YC scraper, hiring signals",
    consequence:
      "Any signal that needs browser automation will fail with 'not configured'.",
    envVars: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
    signupUrl: "https://www.browserbase.com",
    keysUrl: "https://www.browserbase.com/settings",
    fixHint: "Add BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID to .env.local",
    keyName: "browserbase_api_key",
  },
  {
    id: "champmail",
    name: "ChampMail",
    category: "email",
    severity: "optional",
    feature: "Outbound email + delivery tracking",
    consequence:
      "Outreach sequences can be drafted but not sent. Delivery / reply tracking is disabled.",
    envVars: ["CHAMPMAIL_API_KEY"],
    fixHint:
      "Add `CHAMPMAIL_API_KEY=...` to .env.local (ChampMail integration coming soon)",
    keyName: "champmail_api_key",
  },
  {
    id: "qstash",
    name: "QStash",
    category: "scheduling",
    severity: "optional",
    feature: "Scheduled signal runs, background jobs",
    consequence:
      "Signals run only when triggered manually from the UI — no scheduled cadence.",
    envVars: [
      "QSTASH_TOKEN",
      "QSTASH_CURRENT_SIGNING_KEY",
      "QSTASH_NEXT_SIGNING_KEY",
    ],
    signupUrl: "https://upstash.com",
    keysUrl: "https://console.upstash.com/qstash",
    fixHint:
      "Add QSTASH_TOKEN + QSTASH_CURRENT_SIGNING_KEY + QSTASH_NEXT_SIGNING_KEY",
    keyName: "qstash_token",
  },
  {
    id: "google_places",
    name: "Google Places",
    category: "enrichment",
    severity: "optional",
    feature: "Google reviews + Places enrichment signal",
    consequence: "Google Reviews signal fails; falls back to no rating data.",
    envVars: ["GOOGLE_API_KEY"],
    signupUrl:
      "https://developers.google.com/maps/documentation/places/web-service",
    keysUrl: "https://console.cloud.google.com/apis/credentials",
    fixHint: "Add `GOOGLE_API_KEY=...` to .env.local",
    keyName: "google_api_key",
  },
  {
    id: "apify",
    name: "Apify",
    category: "enrichment",
    severity: "optional",
    feature: "LinkedIn + X profile enrichment",
    consequence: "Contact enrichment skips LinkedIn / X data.",
    envVars: ["APIFY_API_TOKEN"],
    signupUrl: "https://apify.com",
    keysUrl: "https://console.apify.com/account/integrations",
    fixHint: "Add `APIFY_API_TOKEN=apify_api_...` to .env.local",
    keyName: "apify_api_token",
  },
  {
    id: "github",
    name: "GitHub",
    category: "enrichment",
    severity: "optional",
    feature: "GitHub commit activity / release cadence signals",
    consequence:
      "GitHub-based signals (stargazers, commit activity, releases) will fail.",
    envVars: ["GITHUB_TOKEN"],
    signupUrl: "https://github.com/settings/tokens",
    keysUrl: "https://github.com/settings/tokens",
    fixHint: "Generate a fine-grained token with read-only public_repo scope",
    keyName: "github_token",
  },
  {
    id: "lakeb2b",
    name: "Lake B2B",
    category: "enrichment",
    severity: "optional",
    feature:
      "Criteria-based company and contact discovery from 120M+ verified records",
    consequence:
      "Discovery falls back to browser-based web research instead of the Lake B2B database. Results will be less accurate and comprehensive.",
    envVars: ["LAKEB2B_API_KEY"],
    keyName: "lakeb2b_api_key",
    fixHint: "Add LAKEB2B_API_KEY to .env.local or paste it in Settings → Keys",
  },
  {
    id: "champoracle",
    name: "ChampIQ (ChampOracle)",
    category: "data",
    severity: "optional",
    feature:
      "Push qualified prospects from ChampHarbinger into ChampIQ for review and outreach",
    consequence:
      "Approved prospects stay in the local queue but are not delivered to ChampIQ. Configure the ChampIQ URL and API key in Settings → ChampIQ.",
    envVars: ["CHAMPORACLE_OUTBOUND_API_KEY"],
    keyName: "champoracle_api_key",
    fixHint:
      "Set ChampIQ URL in Settings → ChampIQ and paste the ChampOracle API key in Settings → Keys",
  },
];

/**
 * Group integrations by category for the settings panel.
 */
export function groupIntegrationsByCategory(): Record<
  IntegrationCategory,
  Integration[]
> {
  const out = {} as Record<IntegrationCategory, Integration[]>;
  for (const integration of INTEGRATIONS) {
    if (!out[integration.category]) out[integration.category] = [];
    out[integration.category].push(integration);
  }
  return out;
}

/** Display name for a category. */
export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  auth: "Auth",
  data: "Database",
  ai: "AI",
  scraping: "Web automation",
  email: "Email",
  scheduling: "Background jobs",
  enrichment: "Enrichment",
};
