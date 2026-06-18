import "server-only";

import {
  isRolePrefix,
  mxCheck as defaultMxCheck,
} from "@/lib/services/email-pattern";

import type { EnrichmentSettings } from "../config";
import { EmailVerdict, type EmailVerification } from "../types";

/**
 * Owned email-verify GATE (pattern + MX). Replaces paid verifiers
 * (NeverBounce/ZeroBounce/Hunter) as the default. Free, DNS-only, no vendor key.
 *
 * Not a waterfall tier - it runs on ANY candidate email at every tier. The
 * orchestrator calls it whenever a new email field appears; confidence
 * .applyEmailGate then boosts (deliverable), caps (catch_all), or discards
 * (undeliverable) the email field.
 *
 *   MX present + personal-pattern local   -> deliverable
 *   MX present + role-prefix local (info@) -> catch_all (generic mailbox)
 *   no MX                                  -> undeliverable
 *   malformed address                      -> unknown
 *
 * Only the email address is used. mxCheck is injectable for deterministic tests.
 */

export interface EmailGateDeps {
  mxCheck?: (domain: string) => Promise<boolean>;
}

export async function gateEmail(
  email: string,
  deps: EmailGateDeps = {},
): Promise<EmailVerification | null> {
  const clean = (email || "").trim().toLowerCase();
  const at = clean.indexOf("@");
  const base = {
    email: clean,
    catchAll: false,
    score: null,
    provider: "owned_email_gate",
  };
  // Malformed: no local part or no domain part.
  if (at <= 0 || at === clean.length - 1 || clean.indexOf(" ") !== -1) {
    return { ...base, verdict: EmailVerdict.Unknown };
  }
  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);

  const mx = deps.mxCheck ?? ((d: string) => defaultMxCheck(d));
  const hasMx = await mx(domain);
  if (!hasMx) {
    return { ...base, verdict: EmailVerdict.Undeliverable };
  }
  if (isRolePrefix(local)) {
    return { ...base, verdict: EmailVerdict.CatchAll, catchAll: true };
  }
  return { ...base, verdict: EmailVerdict.Deliverable };
}

/**
 * Adapter to the orchestrator's EmailVerifyFn signature
 * (email, settings, clerkUserId) -> EmailVerification | null. Settings and the
 * Clerk id are unused by the owned gate today but kept for interface symmetry
 * with optional paid verifiers.
 */
export async function verifyEmailOwned(
  email: string,
  settings: EnrichmentSettings,
  clerkUserId?: string,
): Promise<EmailVerification | null> {
  // settings/clerkUserId are unused by the owned gate today but kept for
  // interface symmetry with optional paid verifiers added later.
  void settings;
  void clerkUserId;
  return gateEmail(email);
}

/** True if any owned/paid verifier is available. Owned gate is always available. */
export async function anyVerifierConfigured(): Promise<boolean> {
  return true;
}
