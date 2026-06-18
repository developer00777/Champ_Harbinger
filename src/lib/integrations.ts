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
    id: "obscura",
    name: "Obscura",
    category: "scraping",
    severity: "optional",
    feature:
      "Self-hosted headless browser (JS rendering, YC + hiring scrapers)",
    consequence:
      "JS-rendered extraction and browser-based scrapers fall back to static fetch only.",
    envVars: ["OBSCURA_GATEWAY_URL"],
    signupUrl: "https://github.com/h4ckf0r0day/obscura",
    fixHint:
      "Run the obscura service (docker compose) and set OBSCURA_GATEWAY_URL=http://obscura:9223",
  },
  {
    id: "trafilatura",
    name: "Trafilatura",
    category: "scraping",
    severity: "optional",
    feature: "Self-hosted article extraction (static tier)",
    consequence:
      "Web extraction skips the clean-article tier and relies on direct fetch + Obscura only.",
    envVars: ["TRAFILATURA_BASE_URL"],
    fixHint:
      "Run the trafilatura service (docker compose) and set TRAFILATURA_BASE_URL=http://trafilatura:8001",
  },
  {
    id: "searxng",
    name: "SearXNG",
    category: "enrichment",
    severity: "optional",
    feature: "Self-hosted metasearch for public-web prospect discovery",
    consequence:
      "Public-web discovery returns no candidates; discovery relies on LakeB2B (when configured).",
    envVars: ["SEARXNG_URL"],
    signupUrl: "https://github.com/searxng/searxng",
    fixHint:
      "Run the searxng service (docker compose) and set SEARXNG_URL=http://searxng:8080",
  },
  {
    id: "champmail",
    name: "ChampMail",
    category: "email",
    severity: "optional",
    feature: "Outbound email + delivery tracking",
    consequence:
      "Outreach sequences can be drafted but not sent. Delivery / reply tracking is disabled.",
    envVars: ["CHAMPMAIL_BASE_URL", "CHAMPMAIL_API_KEY"],
    fixHint:
      "Set CHAMPMAIL_BASE_URL + CHAMPMAIL_API_KEY in .env.local (self-hosted ChampMail)",
    keyName: "champmail_api_key",
  },
  {
    id: "google_places",
    name: "Google Places",
    category: "enrichment",
    severity: "optional",
    feature:
      "Precise Google ratings (optional upgrade over self-hosted reviews)",
    consequence:
      "Reviews come from the self-hosted web-reviews enricher (Trustpilot/G2/…) instead of Google's exact star rating.",
    envVars: ["GOOGLE_API_KEY"],
    signupUrl:
      "https://developers.google.com/maps/documentation/places/web-service",
    keysUrl: "https://console.cloud.google.com/apis/credentials",
    fixHint: "Add `GOOGLE_API_KEY=...` to .env.local",
    keyName: "google_api_key",
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
    id: "jobs-aggregator",
    name: "Job Boards (Greenhouse/Lever/Ashby)",
    category: "enrichment",
    severity: "optional",
    feature: "Hiring signal from public ATS APIs",
    consequence: "Hiring tools fall back to manual scraping",
    envVars: [],
    fixHint:
      "No setup needed. Use the company's ATS slug (e.g. 'stripe' for Greenhouse).",
  },
  {
    id: "wayback",
    name: "Wayback Machine",
    category: "enrichment",
    severity: "optional",
    feature:
      "Historical page snapshots + change detection (pricing, leadership, features) via archive.org",
    consequence:
      "Page-history / change-detection tools are unavailable; the agent cannot answer 'what changed on this page since last month?' questions.",
    envVars: [],
    fixHint:
      "Works out of the box — Wayback Machine is a free public API (no key required).",
  },
  {
    id: "crawl4ai",
    name: "Crawl4AI",
    category: "scraping",
    severity: "optional",
    feature:
      "Self-hosted bulk web crawling (Apache 2.0). Bandwidth-only alternative to Browserbase for 1M+ company scrapes.",
    consequence:
      "Bulk crawl tools (bulkCrawlDomains, crawlPageWithLLM) fall back to a 'service unreachable' message. Per-company scraping still works via Browserbase if configured.",
    envVars: ["CRAWL4AI_BASE_URL"],
    fixHint:
      "Start the service with `docker compose up -d crawl4ai` and set CRAWL4AI_BASE_URL=http://localhost:8000",
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
