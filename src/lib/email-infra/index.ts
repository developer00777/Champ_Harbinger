import type { EmailInfraProvider } from "./types";
import { InboxKitProvider } from "./inboxkit";

/**
 * A disabled provider used when no email-infra provider is configured.
 * Every method throws a clear "not configured" error rather than silently
 * no-opping — infra procurement (domains/mailboxes cost real money) should
 * never fail silently.
 */
class DisabledEmailInfraProvider implements EmailInfraProvider {
  readonly name = "disabled";
  readonly enabled = false;

  private async unavailable(): Promise<never> {
    throw new Error(
      "Email infrastructure is not configured. Set INBOXKIT_API_KEY to enable domain/mailbox provisioning.",
    );
  }

  async searchDomains(): ReturnType<EmailInfraProvider["searchDomains"]> {
    return this.unavailable();
  }
  async createOrder(): ReturnType<EmailInfraProvider["createOrder"]> {
    return this.unavailable();
  }
  async getOrder(): ReturnType<EmailInfraProvider["getOrder"]> {
    return this.unavailable();
  }
  async listDomains(): ReturnType<EmailInfraProvider["listDomains"]> {
    return this.unavailable();
  }
  async getDomainStatus(): ReturnType<EmailInfraProvider["getDomainStatus"]> {
    return this.unavailable();
  }
  async listMailboxes(): ReturnType<EmailInfraProvider["listMailboxes"]> {
    return this.unavailable();
  }
  async buyMailboxes(): ReturnType<EmailInfraProvider["buyMailboxes"]> {
    return this.unavailable();
  }
  async getMailboxCredentials(): ReturnType<
    EmailInfraProvider["getMailboxCredentials"]
  > {
    return this.unavailable();
  }
  async cancelMailbox(): ReturnType<EmailInfraProvider["cancelMailbox"]> {
    return this.unavailable();
  }
  async configureWebhook(): ReturnType<EmailInfraProvider["configureWebhook"]> {
    return this.unavailable();
  }
}

let cached: EmailInfraProvider | undefined;

/**
 * Resolve the active email-infra provider. InboxKit is used whenever
 * INBOXKIT_API_KEY is set; otherwise a disabled provider (every call throws
 * a "not configured" error). Cached for the process lifetime — call
 * `resetEmailInfraProviderCache()` in tests that toggle env vars.
 */
export function getEmailInfraProvider(): EmailInfraProvider {
  if (cached) return cached;
  cached = process.env.INBOXKIT_API_KEY
    ? new InboxKitProvider()
    : new DisabledEmailInfraProvider();
  return cached;
}

/** Test-only: clear the cached provider so env changes take effect. */
export function resetEmailInfraProviderCache(): void {
  cached = undefined;
}

/** True when an email-infra provider is fully configured (has an API key). */
export function isEmailInfraConfigured(): boolean {
  return Boolean(process.env.INBOXKIT_API_KEY);
}

export type {
  CreateOrderInput,
  DomainSearchResult,
  DomainStatus,
  EmailInfraProvider,
  InfraOrder,
  MailboxCredentials,
  MailboxStatus,
} from "./types";
export { InboxKitProvider } from "./inboxkit";
