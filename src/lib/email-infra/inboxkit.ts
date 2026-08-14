import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type {
  CreateOrderInput,
  DomainSearchResult,
  DomainStatus,
  EmailInfraProvider,
  InfraOrder,
  MailboxCredentials,
  MailboxStatus,
} from "./types";

/**
 * InboxKit email-infrastructure provider.
 *
 * Talks to the InboxKit REST API. The transport details below were verified
 * live against api.inboxkit.com — do NOT "simplify" them back to a plain
 * REST-ish shape, they are deliberately odd:
 *
 *   - Base URL is https://api.inboxkit.com/v1/api  (NOT .../v1 — that 404s).
 *   - List/search endpoints are POST with a JSON body, not GET.
 *     `/domains/list`, `/domains/search`, `/mailboxes/list`, `/orders`.
 *   - A few reads ARE GET with query params: `/dns/list?domain=`,
 *     `/mailboxes/show-credentials?email=`.
 *   - `X-Workspace-Id` is MANDATORY on every workspace-scoped call. Without it
 *     the API returns 400 {"code":400,"message":"Workspace ID is required"}.
 *     Workspace ids come from GET /workspaces/list -> workspaces[].uid.
 *   - Responses are enveloped: {error:false, message, domains|mailboxes:[...]}.
 *     Domain rows key the name as `name` (not `domain`) and price as a number.
 *
 * InboxKit also exposes an MCP server (mcp.inboxkit.com/mcp, 74 tools). This
 * client intentionally uses the REST API — MCP needs a stateful session
 * handshake, which is a poor fit for serverless request handlers.
 */

const DEFAULT_BASE_URL = "https://api.inboxkit.com/v1/api";

function baseUrl(): string {
  return (
    process.env.INBOXKIT_BASE_URL?.trim().replace(/\/+$/, "") ||
    DEFAULT_BASE_URL
  );
}

function apiKey(): string | undefined {
  return process.env.INBOXKIT_API_KEY?.trim() || undefined;
}

function configuredWorkspaceId(): string | undefined {
  return process.env.INBOXKIT_WORKSPACE_ID?.trim() || undefined;
}

class InboxKitApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "InboxKitApiError";
  }
}

/**
 * Resolved workspace id, cached for the process lifetime.
 *
 * INBOXKIT_WORKSPACE_ID is optional in config but required by the API, so when
 * it is unset we look up the team's first workspace once and reuse it. Cached
 * as a promise so concurrent callers share a single lookup.
 */
let workspaceIdPromise: Promise<string> | undefined;

/** Test-only: drop the memoized workspace id so env changes take effect. */
export function resetInboxKitWorkspaceCache(): void {
  workspaceIdPromise = undefined;
}

interface WireWorkspace {
  uid: string;
  name?: string;
}

async function resolveWorkspaceId(): Promise<string> {
  const configured = configuredWorkspaceId();
  if (configured) return configured;

  workspaceIdPromise ??= (async () => {
    const data = await request<{ workspaces?: WireWorkspace[] }>(
      "/workspaces/list",
      { method: "GET" },
      15_000,
      { workspaceScoped: false },
    );
    const uid = data.workspaces?.[0]?.uid;
    if (!uid) {
      throw new Error(
        "InboxKit returned no workspaces for this API key. Create a workspace in InboxKit, or set INBOXKIT_WORKSPACE_ID.",
      );
    }
    return uid;
  })().catch((err) => {
    // Don't cache a failed lookup — a transient error would poison the process.
    workspaceIdPromise = undefined;
    throw err;
  });

  return workspaceIdPromise;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
  opts: { workspaceScoped?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey() ?? ""}`,
  };
  if (opts.workspaceScoped !== false) {
    headers["X-Workspace-Id"] = await resolveWorkspaceId();
  }

  const res = await fetchWithTimeout(
    `${baseUrl()}${path}`,
    { ...init, headers: { ...headers, ...(init.headers ?? {}) } },
    timeoutMs,
  );

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new InboxKitApiError(
      res.status,
      `InboxKit ${res.status}: ${text.slice(0, 300)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new InboxKitApiError(
      res.status,
      `InboxKit returned non-JSON: ${text.slice(0, 200)}`,
    );
  }

  // InboxKit signals application-level failures with HTTP 200 + {error:true}.
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as { error?: unknown }).error === true
  ) {
    const message =
      (parsed as { message?: string }).message ?? "InboxKit request failed";
    throw new InboxKitApiError(res.status, `InboxKit: ${message}`);
  }

  return parsed as T;
}

/** POST helper — the shape most InboxKit read endpoints take. */
function post<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
  return request<T>(
    path,
    { method: "POST", body: JSON.stringify(body ?? {}) },
    timeoutMs,
  );
}

// ── Wire shapes (verified against the live API) ───────────────────────────

interface WireDomainSearchRow {
  name: string;
  available?: boolean;
  price?: number;
  tld?: string;
  is_premium?: boolean;
  banned?: boolean;
}

interface WireDomainRow {
  name?: string;
  domain?: string;
  uid?: string;
  status?: string;
  spf_verified?: boolean;
  dkim_verified?: boolean;
  dmarc_verified?: boolean;
  spf?: string | boolean;
  dkim?: string | boolean;
  dmarc?: string | boolean;
}

interface WireMailboxRow {
  email?: string;
  username?: string;
  domain_name?: string;
  uid?: string;
  status?: string;
}

interface WireOrderRow {
  uid?: string;
  id?: string;
  order_id?: string;
  status?: string;
  domains?: Array<{ name?: string }>;
  domain?: string;
  mailboxes?: WireMailboxRow[];
}

interface WireCredentials {
  email?: string;
  username?: string;
  password?: string;
  smtp_host?: string;
  smtp_port?: number | string;
  smtp_secure?: boolean;
  imap_host?: string;
  imap_port?: number | string;
  imap_secure?: boolean;
}

/** InboxKit reports verification either as a boolean or a status string. */
function isVerified(v: string | boolean | undefined): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    return s === "verified" || s === "valid" || s === "ok" || s === "true";
  }
  return false;
}

const ACTIVE_DOMAIN_STATUSES = new Set(["active", "ready", "verified", "live"]);

function toDomainStatus(w: WireDomainRow): DomainStatus {
  const domain = w.name ?? w.domain ?? "";
  const status = w.status ?? "unknown";
  const spf = isVerified(w.spf_verified ?? w.spf);
  const dkim = isVerified(w.dkim_verified ?? w.dkim);
  const dmarc = isVerified(w.dmarc_verified ?? w.dmarc);
  return {
    domain,
    status,
    spfVerified: spf,
    dkimVerified: dkim,
    dmarcVerified: dmarc,
    healthy:
      ACTIVE_DOMAIN_STATUSES.has(status.toLowerCase()) && spf && dkim && dmarc,
  };
}

function toMailboxStatus(w: WireMailboxRow): MailboxStatus {
  const email =
    w.email ??
    (w.username && w.domain_name ? `${w.username}@${w.domain_name}` : "");
  return { email, status: w.status ?? "unknown" };
}

function toOrder(w: WireOrderRow): InfraOrder {
  return {
    providerOrderId: w.uid ?? w.id ?? w.order_id ?? "",
    domain: w.domains?.[0]?.name ?? w.domain ?? "",
    status: w.status ?? "queued",
    mailboxes: (w.mailboxes ?? []).map(toMailboxStatus),
  };
}

function toNumber(v: number | string | undefined, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function toCredentials(w: WireCredentials, email: string): MailboxCredentials {
  const smtpPort = toNumber(w.smtp_port, 587);
  const imapPort = toNumber(w.imap_port, 993);
  return {
    email: w.email ?? email,
    smtpHost: w.smtp_host ?? "smtp.gmail.com",
    smtpPort,
    // Default from the port when the API omits the flag: 465 is implicit TLS.
    smtpSecure: w.smtp_secure ?? smtpPort === 465,
    imapHost: w.imap_host ?? "imap.gmail.com",
    imapPort,
    imapSecure: w.imap_secure ?? imapPort === 993,
    username: w.username ?? w.email ?? email,
    password: w.password ?? "",
  };
}

/** Split "alex@acme.com" into its local-part and domain. */
function splitEmail(email: string): { username: string; domain: string } {
  const at = email.lastIndexOf("@");
  if (at <= 0) throw new Error(`Invalid mailbox email: ${email}`);
  return { username: email.slice(0, at), domain: email.slice(at + 1) };
}

/**
 * Default contact details for domain registration. InboxKit requires WHOIS
 * contact details on every order; these come from env so a deployment can set
 * its real registrant once.
 */
function registrantContact() {
  return {
    first_name: process.env.INBOXKIT_CONTACT_FIRST_NAME?.trim() || "Champions",
    last_name: process.env.INBOXKIT_CONTACT_LAST_NAME?.trim() || "Mail",
    email:
      process.env.INBOXKIT_CONTACT_EMAIL?.trim() || "admin@championsmail.com",
    phone: process.env.INBOXKIT_CONTACT_PHONE?.trim() || "+1.5555555555",
    address: process.env.INBOXKIT_CONTACT_ADDRESS?.trim() || "1 Market St",
    city: process.env.INBOXKIT_CONTACT_CITY?.trim() || "San Francisco",
    state: process.env.INBOXKIT_CONTACT_STATE?.trim() || "CA",
    zip: process.env.INBOXKIT_CONTACT_ZIP?.trim() || "94105",
    country: process.env.INBOXKIT_CONTACT_COUNTRY?.trim() || "US",
  };
}

/** Mailbox platform to provision on ("google" | "ms_outlook"). */
function mailboxPlatform(): string {
  return process.env.INBOXKIT_MAILBOX_PLATFORM?.trim() || "google";
}

/**
 * Derive `count` mailbox local-parts. Explicit usernames win; otherwise fall
 * back to a stable generated set so an order never provisions colliding names.
 */
function mailboxUsernames(count: number, provided?: string[]): string[] {
  if (provided?.length) return provided.slice(0, count);
  const base = ["alex", "sam", "jordan", "casey", "riley", "morgan", "taylor"];
  return Array.from({ length: count }, (_, i) => base[i] ?? `outreach${i + 1}`);
}

export class InboxKitProvider implements EmailInfraProvider {
  readonly name = "inboxkit";
  readonly enabled = Boolean(apiKey());

  private ensureEnabled() {
    if (!this.enabled) {
      throw new Error(
        "InboxKit is not configured. Set INBOXKIT_API_KEY (and optionally INBOXKIT_WORKSPACE_ID).",
      );
    }
  }

  async searchDomains(query: string): Promise<DomainSearchResult[]> {
    this.ensureEnabled();
    const data = await post<{ domains?: WireDomainSearchRow[] }>(
      "/domains/search",
      { keyword: query, num: 20 },
    );
    return (
      (data.domains ?? [])
        // price 0 => TLD InboxKit cannot actually sell; banned => unusable.
        .filter((r) => !r.banned && r.price !== 0)
        .map((r) => ({
          domain: r.name,
          available: r.available ?? false,
          priceUsd: r.price,
        }))
    );
  }

  async createOrder(input: CreateOrderInput): Promise<InfraOrder> {
    this.ensureEnabled();
    const contact = registrantContact();
    const platform = mailboxPlatform();
    const usernames = mailboxUsernames(
      input.mailboxCount,
      input.mailboxUsernames,
    );
    const [firstName, ...rest] = (input.displayName ?? "").split(" ");

    const data = await post<WireOrderRow | WireOrderRow[]>(
      "/orders",
      {
        domains: [
          {
            name: input.domain,
            redirect_url:
              input.forwardingUrl ??
              process.env.INBOXKIT_DEFAULT_REDIRECT_URL ??
              `https://${input.domain}`,
            registration_years: 1,
            contact_details: contact,
            mailboxes: usernames.map((username) => ({
              first_name: firstName || contact.first_name,
              last_name: rest.join(" ") || contact.last_name,
              username,
              domain_name: input.domain,
              platform,
            })),
          },
        ],
      },
      60_000,
    );

    const row = Array.isArray(data) ? data[0] : data;
    const order = toOrder(row ?? {});
    // The API echoes the order without the domain on some paths; keep ours.
    return { ...order, domain: order.domain || input.domain };
  }

  async getOrder(providerOrderId: string): Promise<InfraOrder> {
    this.ensureEnabled();
    const data = await post<WireOrderRow[] | { orders?: WireOrderRow[] }>(
      "/orders",
      { uids: [providerOrderId] },
    );
    const rows = Array.isArray(data) ? data : (data.orders ?? []);
    const match =
      rows.find((r) => (r.uid ?? r.id ?? r.order_id) === providerOrderId) ??
      rows[0];
    if (!match) {
      throw new Error(`InboxKit order ${providerOrderId} not found`);
    }
    return toOrder(match);
  }

  async listDomains(): Promise<DomainStatus[]> {
    this.ensureEnabled();
    const data = await post<{ domains?: WireDomainRow[] }>("/domains/list", {
      page: 1,
      limit: 100,
    });
    return (data.domains ?? []).map(toDomainStatus);
  }

  async getDomainStatus(domain: string): Promise<DomainStatus> {
    this.ensureEnabled();
    const data = await post<{ domains?: WireDomainRow[] }>("/domains/list", {
      keyword: domain,
      page: 1,
      limit: 10,
    });
    const rows = data.domains ?? [];
    const match = rows.find((d) => (d.name ?? d.domain) === domain);
    if (!match) {
      return {
        domain,
        status: "not_found",
        healthy: false,
        reason: "Domain is not in the configured InboxKit workspace",
      };
    }
    return toDomainStatus(match);
  }

  async listMailboxes(domain?: string): Promise<MailboxStatus[]> {
    this.ensureEnabled();
    const data = await post<{ mailboxes?: WireMailboxRow[] }>(
      "/mailboxes/list",
      { page: 1, limit: 100, ...(domain ? { domain } : {}) },
    );
    return (data.mailboxes ?? []).map(toMailboxStatus);
  }

  async buyMailboxes(
    domain: string,
    count: number,
    usernames?: string[],
  ): Promise<MailboxStatus[]> {
    this.ensureEnabled();
    const contact = registrantContact();
    const platform = mailboxPlatform();
    const data = await post<{ mailboxes?: WireMailboxRow[] }>(
      "/mailboxes/buy",
      {
        confirm: true,
        mailboxes: mailboxUsernames(count, usernames).map((username) => ({
          first_name: contact.first_name,
          last_name: contact.last_name,
          username,
          domain_name: domain,
          platform,
        })),
      },
      60_000,
    );
    return (data.mailboxes ?? []).map(toMailboxStatus);
  }

  async getMailboxCredentials(email: string): Promise<MailboxCredentials> {
    this.ensureEnabled();
    const data = await request<
      WireCredentials | { credentials?: WireCredentials }
    >(`/mailboxes/show-credentials?email=${encodeURIComponent(email)}`, {
      method: "GET",
    });
    const wire =
      (data as { credentials?: WireCredentials }).credentials ??
      (data as WireCredentials);
    return toCredentials(wire, email);
  }

  async cancelMailbox(email: string): Promise<{ ok: boolean }> {
    this.ensureEnabled();
    const { username, domain } = splitEmail(email);
    await post("/mailboxes/cancel", {
      confirm: true,
      mailboxes: [{ username, domain_name: domain }],
    });
    return { ok: true };
  }

  /**
   * Point InboxKit's account-level webhook at `url`. Status-change events land
   * on /api/webhooks/inboxkit. Note InboxKit stores only ONE account webhook —
   * calling this overwrites whatever was configured before.
   */
  async configureWebhook(url: string): Promise<{ ok: boolean }> {
    this.ensureEnabled();
    await post("/workspaces/webhook", { webhook_url: url }, 15_000);
    return { ok: true };
  }
}

export { InboxKitApiError };
