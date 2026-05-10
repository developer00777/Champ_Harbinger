import type { EmailProvider } from './types';
import { StubEmailProvider } from './stub';

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  // Future: branch on env vars to instantiate ChampMail, Resend, Postmark, etc.
  cached = new StubEmailProvider();
  return cached;
}
