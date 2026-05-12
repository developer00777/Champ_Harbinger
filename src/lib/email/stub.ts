import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

export class StubEmailProvider implements EmailProvider {
  readonly name = "stub";
  readonly enabled = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async send(_input: SendEmailInput): Promise<SendEmailResult> {
    return {
      id: `stub_${Date.now()}`,
      status: "failed",
      error:
        "Email sending is disabled. Configure ChampMail or another provider to enable.",
    };
  }
}
