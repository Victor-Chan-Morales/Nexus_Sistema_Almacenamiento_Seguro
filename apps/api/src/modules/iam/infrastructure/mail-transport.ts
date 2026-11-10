import * as nodemailer from 'nodemailer';
import { createGmailTransport } from './gmail-transport';
import { assertMailConfig, MailConfig } from './mail-config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<{ messageId: string }>;
}

export function createMailTransport(config: MailConfig): MailTransport {
  assertMailConfig(config);
  if (config.MAIL_TRANSPORT === 'gmail-api') return createGmailTransport(config);

  const user = config.MAIL_USER?.trim();
  const transport = nodemailer.createTransport({
    host: config.MAIL_HOST?.trim() ?? 'localhost',
    port: Number(config.MAIL_PORT ?? 1025),
    secure: config.MAIL_SECURE === 'true',
    requireTLS: config.MAIL_REQUIRE_TLS === 'true',
    auth: user ? { user, pass: config.MAIL_PASS } : undefined,
  });
  const from = config.MAIL_FROM ?? 'Nexus <no-reply@nexus.local>';
  return { sendMail: (message) => transport.sendMail({ ...message, from }) };
}
