import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * ChampMail outbound email provider. Talks to the self-hosted ChampMail HTTP
 * API (POST {CHAMPMAIL_BASE_URL}/api/v1/send, header X-API-Key). ChampMail's
 * JWT (`get_current_user`) is OPTIONAL on /send, so the API key alone suffices;
 * an Authorization: Bearer is sent too in case the deployment enforces it.
 */

interface ChampMailSendResponse {
  message_id: string;
  status: string;
  domain_id?: string;
  sent_at?: string;
}

function baseUrl(): string | null {
  return process.env.CHAMPMAIL_BASE_URL?.trim().replace(/\/+$/, "") || null;
}

function splitFrom(from: string): {
  from_name?: string;
  from_address?: string;
} {
  return from.includes("@") ? { from_address: from } : { from_name: from };
}

export class ChampMailProvider implements EmailProvider {
  readonly name = "champmail";
  readonly enabled = Boolean(baseUrl() && process.env.CHAMPMAIL_API_KEY);

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const base = baseUrl();
    const apiKey = process.env.CHAMPMAIL_API_KEY;
    if (!base || !apiKey) {
      return {
        id: `champmail_unconfigured_${Date.now()}`,
        status: "failed",
        error:
          "ChampMail not configured (CHAMPMAIL_BASE_URL + CHAMPMAIL_API_KEY)",
      };
    }

    const body = {
      to: input.to,
      ...splitFrom(input.from),
      subject: input.subject,
      html_body: input.html ?? input.text,
      text_body: input.text,
      reply_to: input.replyTo,
      domain_id: process.env.CHAMPMAIL_DOMAIN_ID || undefined,
      track_opens: true,
      track_clicks: true,
    };

    try {
      const res = await fetchWithTimeout(
        `${base}/api/v1/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
        30_000,
      );

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return {
          id: `champmail_err_${Date.now()}`,
          status: "failed",
          error: `ChampMail ${res.status}: ${detail.slice(0, 300)}`,
        };
      }

      const data = (await res.json()) as ChampMailSendResponse;
      const status: SendEmailResult["status"] =
        data.status === "queued" ? "queued" : "sent";
      return { id: data.message_id, providerId: data.message_id, status };
    } catch (err) {
      return {
        id: `champmail_err_${Date.now()}`,
        status: "failed",
        error: err instanceof Error ? err.message : "ChampMail request failed",
      };
    }
  }
}
