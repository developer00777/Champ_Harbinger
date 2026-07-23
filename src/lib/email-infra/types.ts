/**
 * EmailInfraProvider — one interface over every way ChampHarbinger can
 * provision cold-outreach infrastructure (sending domains + mailboxes).
 * InboxKit is the first (and default) implementation; this interface exists
 * so a second provider can slot in later without touching callers. Mirrors
 * the shape/ergonomics of src/lib/email/provider.ts (the SENDING provider) —
 * this one is the INFRASTRUCTURE (domain + mailbox procurement) provider.
 */

/** A domain availability/pricing result from a registrar search. */
export interface DomainSearchResult {
  domain: string;
  available: boolean;
  /** Price in USD for a 1-year registration, when known. */
  priceUsd?: number;
}

/**
 * Domain deliverability/DNS health as reported by the infra provider.
 * `healthy` is the single boolean guardrails.ts gates sending on — it should
 * only be true once SPF, DKIM, and DMARC are all verified.
 */
export interface DomainStatus {
  domain: string;
  /** Provider-reported lifecycle status, e.g. "pending" | "active" | "error". */
  status: string;
  spfVerified?: boolean;
  dkimVerified?: boolean;
  dmarcVerified?: boolean;
  /** True only when the domain is safe to send cold outreach from. */
  healthy: boolean;
  reason?: string;
}

/** A single mailbox's lifecycle status within a domain/order. */
export interface MailboxStatus {
  email: string;
  status: string;
}

/** Full SMTP+IMAP credentials for a provisioned mailbox (secrets — never logged). */
export interface MailboxCredentials {
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  /** Login username, usually == email. */
  username: string;
  /** App password / SMTP-AUTH password. */
  password: string;
}

/** Input for placing a combined domain + mailbox order in one call. */
export interface CreateOrderInput {
  /** Domain to register (must have been confirmed available via searchDomains). */
  domain: string;
  /** How many mailboxes to provision on the domain. */
  mailboxCount: number;
  /** Optional explicit local-parts (e.g. ["alex", "sam"]); provider auto-generates if omitted. */
  mailboxUsernames?: string[];
  /** Display name to stamp on outgoing mail for provisioned mailboxes. */
  displayName?: string;
  /** URL InboxKit should forward the root domain to (parking page / company site). */
  forwardingUrl?: string;
}

/** Result of placing (or fetching) an infra order. */
export interface InfraOrder {
  providerOrderId: string;
  domain: string;
  status: string;
  mailboxes: MailboxStatus[];
}

export interface EmailInfraProvider {
  readonly name: string;
  readonly enabled: boolean;

  /** Search for registerable domains matching a query/seed. */
  searchDomains(query: string): Promise<DomainSearchResult[]>;

  /** Place a domain + mailbox order in one call. */
  createOrder(input: CreateOrderInput): Promise<InfraOrder>;

  /** Fetch the current status of a previously placed order. */
  getOrder(providerOrderId: string): Promise<InfraOrder>;

  /** List domains owned in the configured workspace. */
  listDomains(): Promise<DomainStatus[]>;

  /** Fetch live DNS/deliverability health for a single domain. */
  getDomainStatus(domain: string): Promise<DomainStatus>;

  /** List mailboxes, optionally filtered to one domain. */
  listMailboxes(domain?: string): Promise<MailboxStatus[]>;

  /** Provision additional mailboxes on an existing (already-owned) domain. */
  buyMailboxes(
    domain: string,
    count: number,
    usernames?: string[],
  ): Promise<MailboxStatus[]>;

  /** Fetch full SMTP+IMAP login credentials for a ready mailbox. */
  getMailboxCredentials(email: string): Promise<MailboxCredentials>;

  /** Cancel/deprovision a mailbox. */
  cancelMailbox(email: string): Promise<{ ok: boolean }>;

  /** Register (or update) the webhook URL InboxKit sends status_change events to. */
  configureWebhook(url: string): Promise<{ ok: boolean }>;
}
