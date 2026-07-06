import "server-only";

import { buildFieldValue } from "../confidence";
import type { EnrichmentSettings } from "../config";
import { extractContactFields, type ExtractDeps } from "../extract";
import {
  emptyResult,
  minimalIdentifiers,
  Tier,
  type Contact,
  type FieldValue,
  type ProviderResult,
} from "../types";
import type { ProviderAdapter } from "./base";
import { resolveLinkedInUrl } from "./linkedinResolver";

/**
 * T1: owned LLM scrape (the one-OpenRouter-key path, $0 beyond LLM tokens).
 *
 * Gathers public content with Harbinger's OWNED stack - WebExtractionService
 * (direct -> Obscura -> Trafilatura), the LinkedIn/X scrapers, and SearXNG via
 * the LinkedIn resolver - then hands it to extract.ts for LLM extraction. No
 * external scraping/data vendor is used. Resolving the LinkedIn URL (the join
 * key) is a first-class objective here.
 *
 * All collaborators are injected (deps) so this is unit-testable without
 * network; production defaults lazy-import the real services.
 */

const SUPPLIABLE = new Set([
  "email",
  "phone",
  "title",
  "seniority",
  "linkedin",
  "company",
]);

interface WebExtractionLike {
  success: boolean;
  data: {
    title?: string;
    description?: string;
    content?: string;
    contactInfo?: { emails?: string[]; phones?: string[] };
  };
}

export interface OwnedScrapeDeps {
  webExtract?: (url: string) => Promise<WebExtractionLike>;
  scrapeLinkedIn?: (url: string) => Promise<unknown>;
  resolveLinkedIn?: (seed: {
    fullName?: string | null;
    company?: string | null;
    domain?: string | null;
    linkedinUrl?: string | null;
  }) => Promise<string | null>;
  extract?: typeof extractContactFields;
}

async function defaultWebExtract(url: string): Promise<WebExtractionLike> {
  const { WebExtractionService } =
    await import("@/lib/services/web-extraction-service");
  const svc = new WebExtractionService();
  return svc.extract(url, { includeLinks: true });
}

async function defaultScrapeLinkedIn(url: string): Promise<unknown> {
  const { LinkedinService } = await import("@/lib/services/linkedin-service");
  return new LinkedinService().scrapeProfile(url);
}

export class OwnedScrapeAdapter implements ProviderAdapter {
  readonly tier = Tier.T1Lakestream;
  readonly name = "owned_scrape";
  readonly costPerCall = 0;
  private readonly deps: OwnedScrapeDeps;

  constructor(deps: OwnedScrapeDeps = {}) {
    this.deps = deps;
  }

  canSupply(requiredFields: string[]): boolean {
    return requiredFields.some((f) => SUPPLIABLE.has(f));
  }

  /** Always available: degrades to direct fetch if scrape backends are unset. */
  isEnabled(): boolean {
    return true;
  }

  async fetch(
    contact: Contact,
    settings: EnrichmentSettings,
    clerkUserId?: string,
  ): Promise<ProviderResult> {
    const started = Date.now();
    const webExtract = this.deps.webExtract ?? defaultWebExtract;
    const scrapeLinkedIn = this.deps.scrapeLinkedIn ?? defaultScrapeLinkedIn;
    const resolveLi = this.deps.resolveLinkedIn ?? resolveLinkedInUrl;
    const extract = this.deps.extract ?? extractContactFields;

    const ident = minimalIdentifiers(contact);
    const textParts: string[] = [];
    const candidateEmails: string[] = [];
    const candidatePhones: string[] = [];
    let profileJson: unknown;
    let profileFetched = false;

    // 1. Resolve the LinkedIn URL (join key) if we lack one.
    let linkedinUrl = ident.linkedinUrl;
    try {
      if (!linkedinUrl) {
        linkedinUrl = await resolveLi({
          fullName: contact.fullName,
          company: contact.company,
          domain: contact.domain,
          linkedinUrl: ident.linkedinUrl,
        });
      }
    } catch {
      // resolution best-effort
    }

    // 2. Company site / team / contact pages.
    if (contact.domain) {
      try {
        const url = contact.domain.startsWith("http")
          ? contact.domain
          : `https://${contact.domain}`;
        const web = await webExtract(url);
        if (web && web.success && web.data) {
          if (web.data.title) textParts.push(`Title: ${web.data.title}`);
          if (web.data.description) textParts.push(web.data.description);
          if (web.data.content) textParts.push(web.data.content);
          for (const e of web.data.contactInfo?.emails ?? []) {
            candidateEmails.push(e);
          }
          for (const p of web.data.contactInfo?.phones ?? []) {
            candidatePhones.push(p);
          }
        }
      } catch {
        // best-effort
      }
    }

    // 3. LinkedIn profile + posts (the social enrichment).
    if (linkedinUrl) {
      try {
        const li = await scrapeLinkedIn(linkedinUrl);
        const profile = (li as { profile?: Record<string, unknown> } | null)
          ?.profile;
        if (profile) {
          profileFetched = true;
          // Rendered body text is the richest signal — hand it to the LLM as
          // scraped content. Keep the small structured header as profileJson.
          const { rawText, ...structured } = profile as {
            rawText?: string;
          } & Record<string, unknown>;
          profileJson = structured;
          if (typeof rawText === "string" && rawText.trim()) {
            textParts.push(`LinkedIn profile:\n${rawText}`);
          } else {
            textParts.push(JSON.stringify(structured).slice(0, 6000));
          }
        }
      } catch {
        // best-effort
      }
    }

    const scrapedText = textParts.join("\n\n").trim();
    if (!scrapedText && profileJson === undefined) {
      return emptyResult(this.name, this.tier, "owned_scrape_no_content");
    }

    let extracted: {
      fields: Record<string, FieldValue>;
      firmographics: Record<string, unknown>;
    };
    try {
      const extractDeps: ExtractDeps = { clerkUserId };
      extracted = await extract(
        {
          scrapedText,
          seed: {
            fullName: contact.fullName,
            domain: contact.domain,
            company: contact.company,
          },
          profileJson,
        },
        settings,
        extractDeps,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return emptyResult(this.name, this.tier, `owned_scrape_extract: ${msg}`);
    }

    const fields = { ...extracted.fields };

    // The resolved LinkedIn URL is a confirmed value once a profile was fetched.
    if (linkedinUrl && !fields.linkedin) {
      fields.linkedin = buildFieldValue({
        value: linkedinUrl,
        provider: "owned_scrape",
        settings,
        verified: profileFetched,
      });
    }
    // Surface a contact-page email as an (unverified) candidate if the model
    // did not already produce one; the gate verifies it downstream.
    if (!fields.email && candidateEmails.length > 0) {
      fields.email = buildFieldValue({
        value: candidateEmails[0],
        provider: "owned_scrape",
        settings,
        verified: false,
      });
    }
    if (!fields.phone && candidatePhones.length > 0) {
      fields.phone = buildFieldValue({
        value: candidatePhones[0],
        provider: "owned_scrape",
        settings,
      });
    }

    const success =
      Object.keys(fields).length > 0 ||
      Object.keys(extracted.firmographics).length > 0;

    return {
      provider: this.name,
      tier: this.tier,
      success,
      fields,
      firmographics: extracted.firmographics,
      emailVerification: null,
      costUsd: 0,
      latencyMs: Date.now() - started,
      httpStatus: null,
      error: null,
      // Only owned, minimal identifiers are involved.
      requestIdentifiers: { domain: ident.domain, linkedinUrl },
    };
  }
}
