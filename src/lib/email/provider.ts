import type { EmailProvider } from "./types";
import { StubEmailProvider } from "./stub";
import { ChampMailProvider } from "./champmail";

let cached: EmailProvider | undefined;

/**
 * Resolve the active email provider. ChampMail is used when EMAIL_PROVIDER is
 * "champmail" or when both CHAMPMAIL_BASE_URL and CHAMPMAIL_API_KEY are set;
 * otherwise the stub (sending disabled). Cached for the process lifetime.
 */
export function getEmailProvider(): EmailProvider {
  if (cached) return cached;

  const explicit = process.env.EMAIL_PROVIDER;
  const champmailConfigured = Boolean(
    process.env.CHAMPMAIL_BASE_URL && process.env.CHAMPMAIL_API_KEY,
  );

  if (explicit === "champmail" || (!explicit && champmailConfigured)) {
    cached = new ChampMailProvider();
  } else {
    cached = new StubEmailProvider();
  }
  return cached;
}
