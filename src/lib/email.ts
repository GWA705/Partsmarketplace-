import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Outbound email — pick lists to head office, drop-ship POs to suppliers.
 *
 * Never throws. A failed send is reported back so the shipment records that it
 * was not notified, rather than blowing up the dealer's order submission. An
 * order that exists with an un-notified shipment is recoverable; a lost order
 * is not.
 */

let cached: Transporter | null = null;

export function emailConfigured(): boolean {
  return !!process.env.SMTP_HOST && !!process.env.EMAIL_FROM;
}

function transport(): Transporter {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return cached;
}

export interface Attachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendEmail(opts: {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
}): Promise<SendResult> {
  if (!emailConfigured()) {
    return { ok: false, error: 'Email is not configured (SMTP_HOST / EMAIL_FROM).' };
  }
  try {
    const info = await transport().sendMail({
      from: process.env.EMAIL_FROM,
      to: opts.to,
      cc: opts.cc,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
