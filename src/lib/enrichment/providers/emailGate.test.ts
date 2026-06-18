import { describe, expect, it, vi } from "vitest";

import { EmailVerdict } from "../types";
import { gateEmail } from "./emailGate";

describe("gateEmail", () => {
  it("marks a personal-pattern email on an MX-backed domain as deliverable", async () => {
    const mxCheck = vi.fn(async () => true);
    const v = await gateEmail("jane.doe@acme.com", { mxCheck });
    expect(v?.verdict).toBe(EmailVerdict.Deliverable);
    expect(v?.provider).toBe("owned_email_gate");
    expect(mxCheck).toHaveBeenCalledWith("acme.com");
  });

  it("treats a role-prefix address (info@) on an MX domain as catch_all", async () => {
    const mxCheck = vi.fn(async () => true);
    const v = await gateEmail("info@acme.com", { mxCheck });
    expect(v?.verdict).toBe(EmailVerdict.CatchAll);
    expect(v?.catchAll).toBe(true);
  });

  it("marks an email on a domain with no MX as undeliverable", async () => {
    const mxCheck = vi.fn(async () => false);
    const v = await gateEmail("jane@no-mx.example", { mxCheck });
    expect(v?.verdict).toBe(EmailVerdict.Undeliverable);
  });

  it("returns unknown for a malformed address (no model/MX call needed)", async () => {
    const mxCheck = vi.fn(async () => true);
    const v = await gateEmail("not-an-email", { mxCheck });
    expect(v?.verdict).toBe(EmailVerdict.Unknown);
    expect(mxCheck).not.toHaveBeenCalled();
  });
});
