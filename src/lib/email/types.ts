export interface SendEmailInput {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  metadata?: Record<string, string>;
}

export interface SendEmailResult {
  id: string;
  status: 'sent' | 'queued' | 'failed';
  providerId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
