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
 * InboxKit email-infrastructure provider. Talks to the InboxKit HTTP API
 * (base https://api.inboxkit.com/v1, Authorization: Bearer <key>, optional
 * X-Workspace-Id). Endpoints: orders (domain+mailbox provisioning in one
 * call), domains (search/availability/register/list/status), mailboxes
 * (list/buy/credentials/cancel), webhooks (status_change config).
 */

const DEFAULT_BASE_URL = "https://api.inboxkit.com/v1";

function baseUrl(): string {
  return (
    process.env.INBOXKIT_BASE_URL?.trim().replace(/\/+$/, "") ||
    DEFAULT_BASE_URL
  );
}

function apiKey(): string | undefined {
  return process.env.INBOXKIT_API_KEY?.trim() || undefined;
}

function workspaceId(): string | undefined {
  return process.env.INBOXKIT_WORKSPACE_ID?.trim() || undefined;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey() ?? ""}`,
  };
  const ws = workspaceId();
  if (ws) h["X-Workspace-Id"] = ws;
  return h;
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

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const res = await fetchWithTimeout(
    `${baseUrl()}${path}`,
    { ...init, headers: { ...headers(), ...(init.headers ?? {}) } },
    timeoutMs,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new InboxKitApiError(
      res.status,
      `InboxKit ${res.status}: ${detail.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

// ── Wire shapes (InboxKit API responses) ──────────────────────────────────
// Kept narrow/defensive since the upstream schema isn't under our control.

interface WireDomainSearchResult {
  domain: string;
  available: boolean;
  price?: number;
}

interface WireMailbox {
  email: string;
  status: string;
}

interface WireDomainStatus {
  domain: string;
  status: string;
  spf_verified?: boolean;
  dkim_verified?: boolean;
  dmarc_verified?: boolean;
}

interface WireOrder {
  id: string;
  domain: string;
  status: string;
  mailboxes?: WireMailbox[];
}

interface WireMailboxCredentials {
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  username: string;
  password: string;
}

function toDomainStatus(w: WireDomainStatus): DomainStatus {
  const spf = Boolean(w.spf_verified);
  const dkim = Boolean(w.dkim_verified);
  const dmarc = Boolean(w.dmarc_verified);
  return {
    domain: w.domain,
    status: w.status,
    spfVerified: spf,
    dkimVerified: dkim,
    dmarcVerified: dmarc,
    healthy: w.status === "active" && spf && dkim && dmarc,
  };
}

function toOrder(w: WireOrder): InfraOrder {
  return {
    providerOrderId: w.id,
    domain: w.domain,
    status: w.status,
    mailboxes: (w.mailboxes ?? []).map((m) => ({
      email: m.email,
      status: m.status,
    })),
  };
}

function toCredentials(w: WireMailboxCredentials): MailboxCredentials {
  return {
    email: w.email,
    smtpHost: w.smtp_host,
    smtpPort: w.smtp_port,
    smtpSecure: w.smtp_secure,
    imapHost: w.imap_host,
    imapPort: w.imap_port,
    imapSecure: w.imap_secure,
    username: w.username,
    password: w.password,
  };
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
    const data = await request<{ results: WireDomainSearchResult[] }>(
      `/domains/search?q=${encodeURIComponent(query)}`,
    );
    return (data.results ?? []).map((r) => ({
      domain: r.domain,
      available: r.available,
      priceUsd: r.price,
    }));
  }

  async createOrder(input: CreateOrderInput): Promise<InfraOrder> {
    this.ensureEnabled();
    const data = await request<WireOrder>("/orders", {
      method: "POST",
      body: JSON.stringify({
        domain: input.domain,
        mailbox_count: input.mailboxCount,
        mailbox_usernames: input.mailboxUsernames,
        display_name: input.displayName,
        forwarding_url: input.forwardingUrl,
      }),
    });
    return toOrder(data);
  }

  async getOrder(providerOrderId: string): Promise<InfraOrder> {
    this.ensureEnabled();
    const data = await request<WireOrder>(
      `/orders/${encodeURIComponent(providerOrderId)}`,
    );
    return toOrder(data);
  }

  async listDomains(): Promise<DomainStatus[]> {
    this.ensureEnabled();
    const data = await request<{ domains: WireDomainStatus[] }>("/domains");
    return (data.domains ?? []).map(toDomainStatus);
  }

  async getDomainStatus(domain: string): Promise<DomainStatus> {
    this.ensureEnabled();
    const data = await request<WireDomainStatus>(
      `/domains/${encodeURIComponent(domain)}`,
    );
    return toDomainStatus(data);
  }

  async listMailboxes(domain?: string): Promise<MailboxStatus[]> {
    this.ensureEnabled();
    const qs = domain ? `?domain=${encodeURIComponent(domain)}` : "";
    const data = await request<{ mailboxes: WireMailbox[] }>(`/mailboxes${qs}`);
    return (data.mailboxes ?? []).map((m) => ({
      email: m.email,
      status: m.status,
    }));
  }

  async buyMailboxes(
    domain: string,
    count: number,
    usernames?: string[],
  ): Promise<MailboxStatus[]> {
    this.ensureEnabled();
    const data = await request<{ mailboxes: WireMailbox[] }>("/mailboxes", {
      method: "POST",
      body: JSON.stringify({
        domain,
        count,
        usernames,
      }),
    });
    return (data.mailboxes ?? []).map((m) => ({
      email: m.email,
      status: m.status,
    }));
  }

  async getMailboxCredentials(email: string): Promise<MailboxCredentials> {
    this.ensureEnabled();
    const data = await request<WireMailboxCredentials>(
      `/mailboxes/${encodeURIComponent(email)}/credentials`,
    );
    return toCredentials(data);
  }

  async cancelMailbox(email: string): Promise<{ ok: boolean }> {
    this.ensureEnabled();
    await request(`/mailboxes/${encodeURIComponent(email)}`, {
      method: "DELETE",
    });
    return { ok: true };
  }

  async configureWebhook(url: string): Promise<{ ok: boolean }> {
    this.ensureEnabled();
    await request("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        url,
        secret: process.env.INBOXKIT_WEBHOOK_SECRET,
      }),
    });
    return { ok: true };
  }
}

export { InboxKitApiError };
