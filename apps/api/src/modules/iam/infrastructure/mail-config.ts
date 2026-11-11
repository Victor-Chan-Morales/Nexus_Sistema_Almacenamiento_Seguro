import { isEmail } from 'class-validator';

export interface MailConfig {
  NODE_ENV?: string;
  MAIL_TRANSPORT?: string;
  GMAIL_SENDER?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  MAIL_HOST?: string;
  MAIL_PORT?: string;
  MAIL_SECURE?: string;
  MAIL_REQUIRE_TLS?: string;
  MAIL_USER?: string;
  MAIL_PASS?: string;
  MAIL_FROM?: string;
}

export function assertMailConfig(config: MailConfig): void {
  if (config.MAIL_TRANSPORT !== 'gmail-api') {
    if (config.NODE_ENV === 'production' || (config.MAIL_TRANSPORT && config.MAIL_TRANSPORT !== 'smtp')) {
      invalid('MAIL_TRANSPORT');
    }
    return;
  }

  const sender = config.GMAIL_SENDER?.trim();
  if (!sender || !isEmail(sender) || !sender.toLowerCase().endsWith('@gmail.com')) invalid('GMAIL_SENDER');
  for (const key of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'] as const) {
    if (!config[key]?.trim()) invalid(key);
  }
}

function invalid(variable: keyof MailConfig): never {
  throw new Error(`MAIL_CONFIG_INVALID: revisa ${variable}`);
}
