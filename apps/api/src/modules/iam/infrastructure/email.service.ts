import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { DEFAULT_VERIFY_EMAIL_PATH, VERIFICATION_TOKEN_TTL_MINUTES } from '../constants';
import { buildVerificationLink } from '../iam.utils';
import { VerificationMailer } from '../ports/verification-mailer';

/**
 * EmailService del plan: implementación SMTP de VerificationMailer. En desarrollo apunta a
 * Mailpit (localhost:1025) o Mailtrap por variables de entorno (ADR-003). Nunca registra el token ni el enlace.
 */
@Injectable()
export class EmailService implements VerificationMailer {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('MAIL_USER');
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST') ?? 'localhost',
      port: Number(this.config.get<string>('MAIL_PORT') ?? 1025),
      secure: this.config.get<string>('MAIL_SECURE') === 'true',
      auth: user ? { user, pass: this.config.get<string>('MAIL_PASS') } : undefined,
    });
  }

  async sendVerification(to: string, fullName: string, token: string): Promise<void> {
    const webUrl = this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
    const path = this.config.get<string>('IAM_VERIFY_EMAIL_PATH') ?? DEFAULT_VERIFY_EMAIL_PATH;
    const link = buildVerificationLink(webUrl, path, token);
    const from = this.config.get<string>('MAIL_FROM') ?? 'Nexus <no-reply@nexus.local>';

    await this.transporter.sendMail({
      from,
      to,
      subject: 'Verifica tu correo en Nexus',
      text:
        `Hola ${fullName},\n\nConfirma tu correo con este enlace (vence en ` +
        `${VERIFICATION_TOKEN_TTL_MINUTES} minutos y solo sirve una vez):\n${link}\n\n` +
        `Si no creaste esta cuenta, ignora este mensaje.`,
      html:
        `<p>Hola ${escapeHtml(fullName)},</p>` +
        `<p>Confirma tu correo con este enlace (vence en ${VERIFICATION_TOKEN_TTL_MINUTES} ` +
        `minutos y solo sirve una vez):</p><p><a href="${link}">Verificar correo</a></p>` +
        `<p>Si no creaste esta cuenta, ignora este mensaje.</p>`,
    });
    this.logger.log('Correo de verificación enviado');
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
